import { describe, expect, it } from 'vitest'
import { ingestContactMessage, workerCaller } from '../index'
import { bootClinicDb } from '../test-db'
import { ConflictError } from '../errors'
import {
  ensureOpenOpportunity,
  getOpportunityOp,
  listOpportunitiesOp,
  moveOpportunityStageOp,
  reopenOpportunityCycleOp,
  seedSyntheticPipelineOp,
} from './index'
import { findOpenOpportunityForConversation } from './opportunities'

describe('Pipeline / Acompanhamento (#30)', () => {
  it('migração 5 cria oportunidades e histórico; schema v5', () => {
    const { db, close } = bootClinicDb()
    try {
      const state = db.get<{ version: number; status: string }>(
        'SELECT version, status FROM clinic_schema_state WHERE id = 1',
      )
      expect(state).toEqual({ version: 5, status: 'ready' })
      const tables = db.all<{ name: string }>(
        `SELECT name FROM sqlite_master WHERE type='table' AND name IN ('opportunities','opportunity_stage_history')`,
      )
      expect(tables.map((t) => t.name).sort()).toEqual([
        'opportunities',
        'opportunity_stage_history',
      ])
    } finally {
      close()
    }
  })

  it('ingest cria oportunidade (AC-04); isolamento A/B', () => {
    const a = bootClinicDb()
    const b = bootClinicDb()
    try {
      const ra = ingestContactMessage(
        a.db,
        workerCaller('clinic-demo-a'),
        {
          providerEventKey: 'wa:a:1',
          waId: '5511999990001',
          displayName: 'Marina A',
          body: 'Oi',
        },
        a.clock,
      )
      const rb = ingestContactMessage(
        b.db,
        workerCaller('clinic-demo-b'),
        {
          providerEventKey: 'wa:b:1',
          waId: '5511999990001',
          displayName: 'Marina B',
          body: 'Oi',
        },
        b.clock,
      )
      expect(ra.conversation).not.toBeNull()
      const oppA = findOpenOpportunityForConversation(
        a.db,
        'clinic-demo-a',
        ra.conversation!.id,
      )
      const oppB = findOpenOpportunityForConversation(
        b.db,
        'clinic-demo-b',
        rb.conversation!.id,
      )
      expect(oppA?.stage).toBe('novo_contato')
      expect(oppB?.id).not.toBe(oppA?.id)
      expect(oppA?.contactId).not.toBe(oppB?.contactId)

      const listB = listOpportunitiesOp(
        b.db,
        workerCaller('clinic-demo-b'),
        {},
        b.clock,
      )
      expect(listB.items.every((o) => o.tenantId === 'clinic-demo-b')).toBe(true)
      expect(listB.items.some((o) => o.id === oppA!.id)).toBe(false)
    } finally {
      a.close()
      b.close()
    }
  })

  it('mover etapa atualiza histórico; Agendado sem compromisso; não altera agenda', () => {
    const { db, clock, close } = bootClinicDb()
    try {
      const ingested = ingestContactMessage(
        db,
        workerCaller('clinic-demo-a', 'user_synth_attendant_a'),
        {
          providerEventKey: 'wa:move:1',
          waId: '5511987002001',
          displayName: 'Beatriz',
          body: 'Quero horário',
        },
        clock,
      )
      const opp = findOpenOpportunityForConversation(
        db,
        'clinic-demo-a',
        ingested.conversation!.id,
      )!
      const beforeAptCount = db.get<{ n: number }>(
        `SELECT COUNT(*) AS n FROM appointments WHERE tenant_id = ?`,
        'clinic-demo-a',
      )!.n

      const moved = moveOpportunityStageOp(
        db,
        workerCaller('clinic-demo-a', 'user_synth_attendant_a'),
        {
          opportunityId: opp.id,
          toStage: 'agendado',
          actorClerkUserId: 'user_synth_attendant_a',
          actorDisplayName: 'Atendente',
        },
        clock,
      )
      expect(moved.value.stage).toBe('agendado')
      expect(moved.value.missingAppointment).toBe(true)
      expect(moved.value.linkedAppointmentId).toBeNull()
      expect(moved.value.history.length).toBeGreaterThanOrEqual(2)
      expect(moved.outbox[0]?.type).toBe('opportunity.stage_changed')

      const afterAptCount = db.get<{ n: number }>(
        `SELECT COUNT(*) AS n FROM appointments WHERE tenant_id = ?`,
        'clinic-demo-a',
      )!.n
      expect(afterAptCount).toBe(beforeAptCount)

      // Horário proposto também não cria compromisso
      moveOpportunityStageOp(
        db,
        workerCaller('clinic-demo-a', 'user_synth_attendant_a'),
        {
          opportunityId: opp.id,
          toStage: 'horario_proposto',
          actorClerkUserId: 'user_synth_attendant_a',
          actorDisplayName: 'Atendente',
        },
        clock,
      )
      expect(
        db.get<{ n: number }>(
          `SELECT COUNT(*) AS n FROM appointments WHERE tenant_id = ?`,
          'clinic-demo-a',
        )!.n,
      ).toBe(beforeAptCount)
    } finally {
      close()
    }
  })

  it('falha de concorrência preserva estado anterior (AC)', () => {
    const { db, clock, close } = bootClinicDb()
    try {
      const ingested = ingestContactMessage(
        db,
        workerCaller('clinic-demo-a', 'user_a'),
        {
          providerEventKey: 'wa:stale:1',
          waId: '5511987002002',
          displayName: 'Carla',
          body: 'Oi',
        },
        clock,
      )
      const opp = findOpenOpportunityForConversation(
        db,
        'clinic-demo-a',
        ingested.conversation!.id,
      )!
      expect(() =>
        moveOpportunityStageOp(
          db,
          workerCaller('clinic-demo-a', 'user_a'),
          {
            opportunityId: opp.id,
            toStage: 'em_atendimento',
            actorClerkUserId: 'user_a',
            actorDisplayName: 'A',
            expectedUpdatedAt: opp.updatedAt - 1,
          },
          clock,
        ),
      ).toThrow(ConflictError)

      const still = getOpportunityOp(
        db,
        workerCaller('clinic-demo-a'),
        opp.id,
        clock,
      )
      expect(still.stage).toBe('novo_contato')
      expect(still.history.filter((h) => h.toStage === 'em_atendimento')).toHaveLength(0)
    } finally {
      close()
    }
  })

  it('VAL-02 fixtures: uma open por conversa; reabertura cria ciclo; Concluído fecha', () => {
    const { db, clock, close } = bootClinicDb()
    try {
      const seeded = seedSyntheticPipelineOp(
        db,
        workerCaller('clinic-demo-a', 'user_synth_owner_a'),
        clock,
      )
      expect(seeded.seeded).toBe(true)
      expect(seeded.val02Fixtures.hypothesis).toBe('VAL-02')
      expect(seeded.opportunityCount).toBeGreaterThanOrEqual(5)

      const listed = listOpportunitiesOp(
        db,
        workerCaller('clinic-demo-a'),
        { includeClosed: true },
        clock,
      )
      const byConv = new Map<string, number>()
      for (const o of listed.items.filter((x) => x.status === 'open')) {
        byConv.set(o.conversationId, (byConv.get(o.conversationId) ?? 0) + 1)
      }
      for (const n of byConv.values()) expect(n).toBe(1)

      const beatriz = listed.items.find((o) => o.id === 'opp_seed_beatriz')
      expect(beatriz?.stage).toBe('agendado')
      expect(beatriz?.missingAppointment).toBe(true)

      const carla = listed.items.find((o) => o.id === 'opp_seed_carla')
      expect(carla?.linkedAppointmentId).toBe('apt_seed_carla')
      expect(carla?.missingAppointment).toBe(false)

      const renata = listed.items.find((o) => o.id === 'opp_seed_renata_c1')
      expect(renata?.stage).toBe('concluido')
      expect(renata?.status).toBe('closed')

      const reopened = reopenOpportunityCycleOp(
        db,
        workerCaller('clinic-demo-a', 'user_synth_owner_a'),
        {
          conversationId: 'cnv_seed_renata',
          actorClerkUserId: 'user_synth_owner_a',
          actorDisplayName: 'Responsável',
        },
        clock,
      )
      expect(reopened.value.status).toBe('open')
      expect(reopened.value.cycleNumber).toBe(2)
      expect(reopened.value.stage).toBe('novo_contato')

      // Segunda open na mesma conversa é rejeitada
      expect(() =>
        reopenOpportunityCycleOp(
          db,
          workerCaller('clinic-demo-a', 'user_synth_owner_a'),
          {
            conversationId: 'cnv_seed_renata',
            actorClerkUserId: 'user_synth_owner_a',
            actorDisplayName: 'Responsável',
          },
          clock,
        ),
      ).toThrow(ConflictError)
    } finally {
      close()
    }
  })

  it('ensureOpenOpportunity é idempotente', () => {
    const { db, clock, close } = bootClinicDb()
    try {
      const ingested = ingestContactMessage(
        db,
        workerCaller('clinic-demo-a'),
        {
          providerEventKey: 'wa:ens:1',
          waId: '5511987002003',
          displayName: 'Pat',
          body: 'Oi',
        },
        clock,
      )
      const first = ensureOpenOpportunity(
        db,
        {
          tenantId: 'clinic-demo-a',
          contactId: ingested.contact.id,
          conversationId: ingested.conversation!.id,
        },
        clock,
      )
      const second = ensureOpenOpportunity(
        db,
        {
          tenantId: 'clinic-demo-a',
          contactId: ingested.contact.id,
          conversationId: ingested.conversation!.id,
        },
        clock,
      )
      expect(first.created).toBe(false) // já criada no ingest
      expect(second.created).toBe(false)
      expect(second.opportunity.id).toBe(first.opportunity.id)
    } finally {
      close()
    }
  })
})
