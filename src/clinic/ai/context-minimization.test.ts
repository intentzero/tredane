/**
 * S8 / #179 — minimização de contexto, isolamento e retenção de artefactos IA.
 * Dados sintéticos apenas.
 */
import { describe, expect, it } from 'vitest'
import {
  SimulatedAiAdapter,
  redactProhibitedFromText,
} from '../../ai'
import { systemClock } from '../../db/clock'
import { workerCaller } from '../envelopes'
import { upsertService } from '../config/services'
import { setClinicAiAssistEnabled, ensureClinicSettings } from '../config/settings'
import { upsertContact, getContact, listContacts } from '../contacts'
import { createConversation } from '../inbox/conversations'
import { insertMessage } from '../inbox/messages'
import { ensureOpenOpportunity } from '../pipeline/operations'
import { bindOrAssertTenant } from '../tenant'
import { bootClinicDb } from '../test-db'
import { deleteContactOp } from '../retention/contact-delete'
import {
  getClinicPurgeState,
  wipeClinicOperationalData,
} from '../retention/tenant-purge-local'
import {
  assertAiCommandResultMinimized,
  assertContextMinimized,
  buildAiContextPayload,
  suggestReplyOp,
} from './index'

function seedClinic(
  db: ReturnType<typeof bootClinicDb>['db'],
  clock: ReturnType<typeof bootClinicDb>['clock'],
  tenantId: string,
  opts: {
    displayName: string
    waId: string
    inboundBodies: string[]
    services?: Array<{
      name: string
      priceCents: number | null
      clientExplanation: string | null
    }>
    clinicAddress?: string
  },
) {
  const caller = workerCaller(tenantId, 'user_s8_test')
  bindOrAssertTenant(db, caller, clock)
  setClinicAiAssistEnabled(db, tenantId, true, clock)
  if (opts.clinicAddress) {
    ensureClinicSettings(db, tenantId, clock)
    db.run(
      `UPDATE clinic_settings SET clinic_address = ?, updated_at = ? WHERE id = 1 AND tenant_id = ?`,
      opts.clinicAddress,
      clock.nowMs(),
      tenantId,
    )
  }
  for (const s of opts.services ?? [
    { name: 'Limpeza de pele', priceCents: 12000, clientExplanation: null },
  ]) {
    upsertService(
      db,
      tenantId,
      {
        name: s.name,
        durationMinutes: 60,
        bufferMinutes: 15,
        priceCents: s.priceCents,
        clientExplanation: s.clientExplanation,
        active: true,
        professionalIds: [],
        roomRequirement: { mode: 'none' },
      },
      clock,
    )
  }
  const contact = upsertContact(
    db,
    { tenantId, waId: opts.waId, displayName: opts.displayName },
    clock,
  )
  const cnv = createConversation(
    db,
    { tenantId, contactId: contact.id, status: 'open' },
    clock,
  )
  ensureOpenOpportunity(
    db,
    { tenantId, contactId: contact.id, conversationId: cnv.id },
    clock,
  )
  let t = clock.nowMs() - opts.inboundBodies.length * 1000
  for (const body of opts.inboundBodies) {
    insertMessage(
      db,
      {
        tenantId,
        conversationId: cnv.id,
        direction: 'inbound',
        body,
        deliveryState: 'received',
        createdAt: t,
      },
      clock,
    )
    t += 1000
  }
  return { caller, conversationId: cnv.id, contactId: contact.id }
}

describe('S8 minimização de contexto IA (#179)', () => {
  it('redactProhibitedFromText remove telefone, e-mail e tokens', () => {
    expect(redactProhibitedFromText('Liga +55 11 98888-7777')).toContain('[redacted]')
    expect(redactProhibitedFromText('wa.me/5511988887777')).toContain('[redacted]')
    expect(redactProhibitedFromText('manda em ana.ficticia@exemplo.com')).toContain('[redacted]')
    expect(redactProhibitedFromText('token Bearer sk-live-ABCDEFGH1234')).toContain('[redacted]')
    expect(redactProhibitedFromText('api_key=supersecretvalue99')).toContain('[redacted]')
    expect(redactProhibitedFromText('ghp_ABCDEFGHIJKLMNOP')).toContain('[redacted]')
  })

  it('catálogo com telefone no nome/explicação é redigido e assert falha se vazar', async () => {
    const { db, clock, close } = bootClinicDb()
    try {
      const tenantId = 'clinic-demo-s8-catalog'
      const seeded = seedClinic(db, clock, tenantId, {
        displayName: 'Marina Silva',
        waId: '5511987009001',
        inboundBodies: ['Oi'],
        services: [
          {
            name: 'Pacote Ligue 11999998888',
            priceCents: 10000,
            clientExplanation: 'Confirme no 11 98888-1234 antes',
          },
        ],
      })
      const built = await buildAiContextPayload(db, tenantId, seeded.conversationId)
      expect(built.payload.services[0]?.name).toContain('[redacted]')
      expect(built.payload.services[0]?.clientExplanation).toContain('[redacted]')
      assertContextMinimized(built.payload)
      expect(JSON.stringify(built.payload)).not.toMatch(/11999998888|98888-1234/)
    } finally {
      close()
    }
  })

  it('multi-conversa: só a conversa alvo entra no payload', async () => {
    const { db, clock, close } = bootClinicDb()
    try {
      const tenantId = 'clinic-demo-s8-multi'
      const a = seedClinic(db, clock, tenantId, {
        displayName: 'Ana A',
        waId: '5511987009010',
        inboundBodies: ['Segredo conversa A — laser facial'],
      })
      const contactB = upsertContact(
        db,
        { tenantId, waId: '5511987009011', displayName: 'Bia B' },
        clock,
      )
      const cnvB = createConversation(
        db,
        { tenantId, contactId: contactB.id, status: 'open' },
        clock,
      )
      insertMessage(
        db,
        {
          tenantId,
          conversationId: cnvB.id,
          direction: 'inbound',
          body: 'Segredo conversa B — botox',
          deliveryState: 'received',
          createdAt: clock.nowMs(),
        },
        clock,
      )

      const built = await buildAiContextPayload(db, tenantId, a.conversationId, { clock })
      assertContextMinimized(built.payload)
      const json = JSON.stringify(built.payload)
      expect(json).toContain('laser facial')
      expect(json).not.toContain('botox')
      expect(json).not.toContain('Segredo conversa B')
      expect(built._debugExcluded.otherConversationIds).toContain(cnvB.id)
      expect(built.payload.contactFirstName).toBe('Ana')
    } finally {
      close()
    }
  })

  it('duas clínicas: endereço/catálogo/telefone de B não vazam no pedido de A', async () => {
    const a = bootClinicDb()
    const b = bootClinicDb()
    try {
      const seededA = seedClinic(a.db, a.clock, 'clinic-demo-s8-iso-a', {
        displayName: 'Carla A',
        waId: '5511987009020',
        inboundBodies: ['Meu tel 11 97777-6666 e Bearer sk-clinicA-SECRET99'],
        clinicAddress: 'Rua Alfa 100, São Paulo',
        services: [
          { name: 'Limpeza A', priceCents: 9000, clientExplanation: null },
        ],
      })
      seedClinic(b.db, b.clock, 'clinic-demo-s8-iso-b', {
        displayName: 'Diana B',
        waId: '5511987009021',
        inboundBodies: ['Segredo clínica B'],
        clinicAddress: 'Rua Beta Segredo 999, Campinas',
        services: [
          { name: 'Segredo B Premium', priceCents: 50000, clientExplanation: 'Só B' },
        ],
      })

      const result = await suggestReplyOp(
        a.db,
        seededA.caller,
        {
          conversationId: seededA.conversationId,
          clientRequestId: 's8-iso-1',
          actorClerkUserId: 'user_s8_test',
          actorDisplayName: 'Ana',
        },
        a.clock,
        { adapter: new SimulatedAiAdapter(), mode: 'synthetic', clinicName: 'Clínica Alfa' },
      )

      const payload = result.contextInspection.payload
      assertContextMinimized(payload)
      const json = JSON.stringify(payload)
      const sent = JSON.stringify(result.gatewayInspection)
      expect(json).not.toMatch(/5511987009021|Segredo B|Rua Beta|Campinas|sk-clinicA/)
      expect(sent).not.toMatch(/5511987009021|Segredo B|Rua Beta|Campinas|sk-clinicA|97777-6666/)
      expect(payload.messages.every((m) => m.body.includes('[redacted]'))).toBe(true)
      expect(payload.services.map((s) => s.name)).toEqual(['Limpeza A'])
      expect(result.gatewayInspection?.headers['cf-aig-collect-log-payload']).toBe('false')
      expect(result.gatewayInspection?.headers['cf-aig-skip-cache']).toBe('true')
    } finally {
      a.close()
      b.close()
    }
  })

  it('ai_commands não persiste prompts nem contexto; idempotência reidrata sugestão', async () => {
    const { db, clock, close } = bootClinicDb()
    try {
      const tenantId = 'clinic-demo-s8-cmd'
      const seeded = seedClinic(db, clock, tenantId, {
        displayName: 'Elena Costa',
        waId: '5511987009030',
        inboundBodies: ['Quero agendar limpeza'],
      })
      const first = await suggestReplyOp(
        db,
        seeded.caller,
        {
          conversationId: seeded.conversationId,
          clientRequestId: 's8-cmd-1',
          actorClerkUserId: 'user_s8_test',
          actorDisplayName: 'Ana',
        },
        clock,
        { adapter: new SimulatedAiAdapter(), mode: 'synthetic' },
      )
      expect(first.duplicate).toBe(false)

      const row = db.get<{ result_json: string }>(
        `SELECT result_json FROM ai_commands WHERE tenant_id = ? AND client_request_id = ?`,
        tenantId,
        's8-cmd-1',
      )
      expect(row).toBeTruthy()
      assertAiCommandResultMinimized(row!.result_json)
      expect(row!.result_json).not.toMatch(/Quero agendar|systemPrompt|userContent|messages/)
      expect(JSON.parse(row!.result_json)).toMatchObject({
        v: 2,
        suggestionId: first.suggestion.id,
        messageSent: false,
      })

      const second = await suggestReplyOp(
        db,
        seeded.caller,
        {
          conversationId: seeded.conversationId,
          clientRequestId: 's8-cmd-1',
          actorClerkUserId: 'user_s8_test',
          actorDisplayName: 'Ana',
        },
        clock,
        { adapter: new SimulatedAiAdapter(), mode: 'synthetic' },
      )
      expect(second.duplicate).toBe(true)
      expect(second.suggestion.id).toBe(first.suggestion.id)
      assertContextMinimized(second.contextInspection.payload)
    } finally {
      close()
    }
  })

  it('exclusão de contacto apaga suggestions, commands, autodraft e propostas S3', async () => {
    const { db, clock, close } = bootClinicDb()
    try {
      const tenantId = 'clinic-demo-s8-del'
      const seeded = seedClinic(db, clock, tenantId, {
        displayName: 'Fátima Nunes',
        waId: '5511987009040',
        inboundBodies: ['Oi'],
      })
      await suggestReplyOp(
        db,
        seeded.caller,
        {
          conversationId: seeded.conversationId,
          clientRequestId: 's8-del-1',
          actorClerkUserId: 'user_s8_test',
          actorDisplayName: 'Ana',
        },
        clock,
        { adapter: new SimulatedAiAdapter(), mode: 'synthetic' },
      )
      db.run(
        `INSERT INTO ai_autodraft_jobs (
          tenant_id, conversation_id, message_id, due_at, state, created_at, updated_at
        ) VALUES (?, ?, 'msg_s8', ?, 'queued', ?, ?)`,
        tenantId,
        seeded.conversationId,
        clock.nowMs() + 5000,
        clock.nowMs(),
        clock.nowMs(),
      )
      const now = clock.nowMs()
      db.run(
        `INSERT INTO appointment_proposals (
          id, tenant_id, lineage_id, version, contact_id, conversation_id, state,
          clinic_location_text, beneficiary_kind, beneficiary_name,
          service_id, service_name, professional_id, professional_name,
          starts_at, ends_at, duration_minutes, timezone, expires_at,
          created_at, updated_at
        ) VALUES (?, ?, ?, 1, ?, ?, 'preparada', '', 'titular', 'Fátima Nunes',
          'svc_s8', 'Limpeza de pele', 'pro_s8', 'Pro S8',
          ?, ?, 60, 'America/Sao_Paulo', ?, ?, ?)`,
        'prop_s8_1',
        tenantId,
        'lin_s8_1',
        seeded.contactId,
        seeded.conversationId,
        now + 3600_000,
        now + 5400_000,
        now + 1800_000,
        now,
        now,
      )
      // Proposta não entra no payload LLM.
      const built = await buildAiContextPayload(db, tenantId, seeded.conversationId, { clock })
      assertContextMinimized(built.payload)
      expect(JSON.stringify(built.payload)).not.toMatch(/prop_s8_1|lin_s8_1|appointment_proposal/)

      expect(db.get<{ n: number }>('SELECT COUNT(*) AS n FROM ai_suggestions')?.n).toBe(1)
      expect(db.get<{ n: number }>('SELECT COUNT(*) AS n FROM ai_commands')?.n).toBe(1)
      expect(db.get<{ n: number }>('SELECT COUNT(*) AS n FROM ai_autodraft_jobs')?.n).toBe(1)
      expect(db.get<{ n: number }>('SELECT COUNT(*) AS n FROM appointment_proposals')?.n).toBe(1)

      deleteContactOp(db, seeded.caller, seeded.contactId, clock)
      expect(getContact(db, tenantId, seeded.contactId)).toBeUndefined()
      expect(db.get<{ n: number }>('SELECT COUNT(*) AS n FROM ai_suggestions')?.n).toBe(0)
      expect(db.get<{ n: number }>('SELECT COUNT(*) AS n FROM ai_commands')?.n).toBe(0)
      expect(db.get<{ n: number }>('SELECT COUNT(*) AS n FROM ai_autodraft_jobs')?.n).toBe(0)
      expect(db.get<{ n: number }>('SELECT COUNT(*) AS n FROM appointment_proposals')?.n).toBe(0)

      // Reconexão / novo contacto com mesmo wa_id fica bloqueado por tombstone (#43).
      expect(listContacts(db, tenantId)).toHaveLength(0)
    } finally {
      close()
    }
  })

  it('wipe do tenant zera tabelas AI inclusive jobs e usage', () => {
    const { db, close } = bootClinicDb()
    try {
      const clock = systemClock
      const tenantId = 'clinic-demo-s8-wipe'
      const caller = workerCaller(tenantId, 'system')
      bindOrAssertTenant(db, caller, clock)
      const seeded = seedClinic(db, clock, tenantId, {
        displayName: 'Gina Wipe',
        waId: '5511987009050',
        inboundBodies: ['Oi'],
      })
      db.run(
        `INSERT INTO ai_autodraft_jobs (
          tenant_id, conversation_id, message_id, due_at, state, created_at, updated_at
        ) VALUES (?, ?, 'msg_w', ?, 'queued', ?, ?)`,
        tenantId,
        seeded.conversationId,
        clock.nowMs() + 1000,
        clock.nowMs(),
        clock.nowMs(),
      )
      db.run(
        `INSERT INTO ai_daily_usage (tenant_id, day, drafts, cap_reached_at) VALUES (?, '2099-01-01', 3, NULL)`,
        tenantId,
      )

      wipeClinicOperationalData(db, caller, clock)
      expect(getClinicPurgeState(db).status).toBe('wiped')
      expect(db.get<{ n: number }>('SELECT COUNT(*) AS n FROM ai_suggestions')?.n).toBe(0)
      expect(db.get<{ n: number }>('SELECT COUNT(*) AS n FROM ai_commands')?.n).toBe(0)
      expect(db.get<{ n: number }>('SELECT COUNT(*) AS n FROM ai_autodraft_jobs')?.n).toBe(0)
      expect(db.get<{ n: number }>('SELECT COUNT(*) AS n FROM ai_daily_usage')?.n).toBe(0)
      expect(listContacts(db, tenantId)).toHaveLength(0)
    } finally {
      close()
    }
  })

  it('assertContextMinimized rejeita telefone residual e segredos no JSON', () => {
    expect(() =>
      assertContextMinimized({
        contactFirstName: 'Ana',
        stage: null,
        services: [],
        messages: [{ direction: 'inbound', body: 'Liga 11988887777 agora' }],
        hasClinicOutbound: false,
        clinicOutboundCount: 0,
      }),
    ).toThrow(/ai_context_message_contains_phone/)

    expect(() =>
      assertContextMinimized({
        contactFirstName: 'Ana',
        stage: null,
        services: [],
        messages: [{ direction: 'inbound', body: 'ok' }],
        hasClinicOutbound: false,
        clinicOutboundCount: 0,
        phone: '5511999999999',
      } as Parameters<typeof assertContextMinimized>[0] & { phone: string }),
    ).toThrow(/ai_context_contains_prohibited_keys/)
  })
})
