import type { Clock } from '../../db/clock'
import { insertSyntheticAppointment } from '../config/appointments'
import { upsertResource } from '../config/resources'
import { upsertService } from '../config/services'
import { upsertContact } from '../contacts'
import type { OpportunityStage } from '../constants'
import type { ClinicCaller } from '../envelopes'
import { assertValidCaller } from '../envelopes'
import {
  createConversation,
  listConversations,
  touchConversationMessage,
} from '../inbox/conversations'
import { insertMessage } from '../inbox/messages'
import { seedSyntheticInboxOp } from '../inbox/seed'
import type { ConversationListItem } from '../inbox/types'
import { assertClinicSchemaReady } from '../migrations'
import type { ClinicDb } from '../store'
import { bindOrAssertTenant } from '../tenant'
import {
  findOpenOpportunityForConversation,
  insertOpportunity,
  insertStageHistory,
  setLinkedAppointment,
  updateOpportunityStage,
} from './opportunities'

const VAL02_FIXTURES = {
  openPerConversation: 'at_most_one' as const,
  reopenCreatesNewCycle: true as const,
  concluidoClosesCycle: true as const,
  hypothesis: 'VAL-02' as const,
}

/**
 * Dados sintéticos do Acompanhamento (#30).
 * Depende do seed da inbox; cria oportunidades em várias etapas + 1 compromisso
 * vinculado e 1 Agendado sem compromisso (DEC-040). Documenta VAL-02.
 */
export function seedSyntheticPipelineOp(
  db: ClinicDb,
  caller: ClinicCaller,
  clock: Clock,
  opts: { force?: boolean } = {},
): {
  seeded: boolean
  opportunityCount: number
  val02Fixtures: typeof VAL02_FIXTURES
} {
  assertClinicSchemaReady(db)
  assertValidCaller(caller)
  const meta = bindOrAssertTenant(db, caller, clock)

  seedSyntheticInboxOp(db, caller, clock, opts)

  const existingOpen = db.get<{ n: number }>(
    `SELECT COUNT(*) AS n FROM opportunities WHERE tenant_id = ? AND status = 'open'`,
    meta.tenantId,
  )
  if ((existingOpen?.n ?? 0) > 0 && !opts.force) {
    return {
      seeded: false,
      opportunityCount: existingOpen!.n,
      val02Fixtures: VAL02_FIXTURES,
    }
  }

  if (opts.force) {
    db.run(`DELETE FROM opportunity_stage_history WHERE tenant_id = ?`, meta.tenantId)
    db.run(`DELETE FROM opportunities WHERE tenant_id = ?`, meta.tenantId)
    db.run(
      `DELETE FROM appointments WHERE tenant_id = ? AND id LIKE 'apt_seed_%'`,
      meta.tenantId,
    )
  }

  return db.transactionSync(() => {
    const t0 = clock.nowMs()
    ensureExtraConversations(db, meta.tenantId, clock, t0)

    const listed = listConversations(db, meta.tenantId, { filter: 'all', limit: 50 })
    const byId = new Map(listed.items.map((c) => [c.id, c]))

    const pro = upsertResource(
      db,
      meta.tenantId,
      {
        kind: 'professional',
        name: 'Dra. Paula Reis (seed)',
        active: true,
      },
      clock,
    )
    const svc = upsertService(
      db,
      meta.tenantId,
      {
        name: 'Limpeza de pele (seed)',
        durationMinutes: 45,
        bufferMinutes: 15,
        active: true,
        professionalIds: [pro.id],
        roomRequirement: { mode: 'none' },
      },
      clock,
    )

    const carla = byId.get('cnv_seed_carla')
    const apt = insertSyntheticAppointment(
      db,
      meta.tenantId,
      {
        id: 'apt_seed_carla',
        serviceId: svc.id,
        professionalId: pro.id,
        startsAt: t0 + 2 * 86_400_000,
        endsAt: t0 + 2 * 86_400_000 + 45 * 60_000,
        contactLabel: carla?.contact.displayName ?? 'Carla Mendes',
        contactId: carla?.contactId ?? null,
        conversationId: carla?.id ?? null,
        status: 'confirmed',
      },
      clock,
    )

    placeStage(db, byId, meta.tenantId, clock, t0, 'cnv_seed_marina', 'novo_contato', {
      id: 'opp_seed_marina',
    })
    placeStage(db, byId, meta.tenantId, clock, t0, 'cnv_seed_juliana', 'em_atendimento', {
      id: 'opp_seed_juliana',
      historyNote: 'Assumiu atendimento',
    })
    placeStage(db, byId, meta.tenantId, clock, t0, 'cnv_seed_carla', 'agendado', {
      id: 'opp_seed_carla',
      linkedAppointmentId: apt.id,
      historyNote: 'Horário confirmado (seed)',
    })
    placeStage(db, byId, meta.tenantId, clock, t0, 'cnv_seed_renata', 'concluido', {
      id: 'opp_seed_renata_c1',
      historyNote: 'Atendimento concluído (ciclo 1 / VAL-02)',
    })
    // DEC-040: Agendado sem compromisso vinculado
    placeStage(db, byId, meta.tenantId, clock, t0, 'cnv_seed_beatriz', 'agendado', {
      id: 'opp_seed_beatriz',
      historyNote: 'Agendado sem compromisso (DEC-040)',
    })
    // Horário proposto não reserva recursos (DEC-008)
    placeStage(db, byId, meta.tenantId, clock, t0, 'cnv_seed_patricia', 'horario_proposto', {
      id: 'opp_seed_patricia',
      historyNote: 'Horário proposto — não reserva (DEC-008)',
    })

    const count = db.get<{ n: number }>(
      `SELECT COUNT(*) AS n FROM opportunities WHERE tenant_id = ?`,
      meta.tenantId,
    )

    return {
      seeded: true,
      opportunityCount: count?.n ?? 0,
      val02Fixtures: VAL02_FIXTURES,
    }
  })
}

function ensureExtraConversations(
  db: ClinicDb,
  tenantId: string,
  clock: Clock,
  t0: number,
): void {
  ensureOne(
    db,
    tenantId,
    clock,
    t0,
    {
      contactId: 'ctc_seed_beatriz',
      waId: '5511987001005',
      displayName: 'Beatriz Rocha',
      conversationId: 'cnv_seed_beatriz',
      messageId: 'msg_seed_beatriz_1',
      body: 'Prefiro na sexta à tarde.',
      externalId: 'seed:beatriz:1',
      assigneeClerkUserId: 'user_synth_ana',
      assigneeDisplayName: 'Ana',
      ageMs: 3_600_000,
    },
  )
  ensureOne(
    db,
    tenantId,
    clock,
    t0,
    {
      contactId: 'ctc_seed_patricia',
      waId: '5511987001006',
      displayName: 'Patrícia Nogueira',
      conversationId: 'cnv_seed_patricia',
      messageId: 'msg_seed_patricia_1',
      body: 'Esse horário às 16h serve?',
      externalId: 'seed:patricia:1',
      assigneeClerkUserId: 'user_synth_bruno',
      assigneeDisplayName: 'Bruno',
      ageMs: 7_200_000,
    },
  )
}

function ensureOne(
  db: ClinicDb,
  tenantId: string,
  clock: Clock,
  t0: number,
  spec: {
    contactId: string
    waId: string
    displayName: string
    conversationId: string
    messageId: string
    body: string
    externalId: string
    assigneeClerkUserId: string
    assigneeDisplayName: string
    ageMs: number
  },
): void {
  const existing = db.get<{ id: string }>(
    `SELECT id FROM conversations WHERE tenant_id = ? AND id = ?`,
    tenantId,
    spec.conversationId,
  )
  if (existing) return

  const contact = upsertContact(
    db,
    {
      tenantId,
      waId: spec.waId,
      displayName: spec.displayName,
      id: spec.contactId,
    },
    clock,
  )
  const cnv = createConversation(
    db,
    {
      tenantId,
      contactId: contact.id,
      status: 'open',
      id: spec.conversationId,
    },
    clock,
  )
  db.run(
    `UPDATE conversations SET
      assignee_clerk_user_id = ?, assignee_display_name = ?, assignment_version = 1
     WHERE tenant_id = ? AND id = ?`,
    spec.assigneeClerkUserId,
    spec.assigneeDisplayName,
    tenantId,
    cnv.id,
  )
  const msg = insertMessage(
    db,
    {
      tenantId,
      conversationId: cnv.id,
      direction: 'inbound',
      body: spec.body,
      externalMessageId: spec.externalId,
      deliveryState: 'received',
      createdAt: t0 - spec.ageMs,
      id: spec.messageId,
    },
    clock,
  )
  touchConversationMessage(db, {
    tenantId,
    conversationId: cnv.id,
    preview: msg.body,
    direction: 'inbound',
    at: msg.createdAt,
    bumpUnread: false,
    reopenIfClosed: false,
  })
}

function placeStage(
  db: ClinicDb,
  byId: Map<string, ConversationListItem>,
  tenantId: string,
  clock: Clock,
  t0: number,
  conversationId: string,
  stage: OpportunityStage,
  opts: {
    id: string
    linkedAppointmentId?: string
    historyNote?: string
  },
): void {
  const cnv = byId.get(conversationId)
  if (!cnv) return
  if (findOpenOpportunityForConversation(db, tenantId, conversationId)) return
  // Renata está closed — ainda assim criamos oportunidade closed (ciclo 1)
  const already = db.get<{ id: string }>(
    `SELECT id FROM opportunities WHERE tenant_id = ? AND id = ?`,
    tenantId,
    opts.id,
  )
  if (already) return

  const opp = insertOpportunity(
    db,
    {
      id: opts.id,
      tenantId,
      contactId: cnv.contactId,
      conversationId,
      stage: 'novo_contato',
      cycleNumber: 1,
      assigneeClerkUserId: cnv.assigneeClerkUserId,
      assigneeDisplayName: cnv.assigneeDisplayName,
      lastInteractionAt: cnv.lastMessageAt ?? t0,
    },
    clock,
  )
  insertStageHistory(
    db,
    {
      tenantId,
      opportunityId: opp.id,
      fromStage: null,
      toStage: 'novo_contato',
      note: 'Seed sintético',
      createdAt: t0 - 10_000,
    },
    clock,
  )

  if (stage !== 'novo_contato') {
    const now = t0 - 5_000
    const status = stage === 'concluido' || stage === 'perdido' ? 'closed' : 'open'
    updateOpportunityStage(db, {
      tenantId,
      opportunityId: opp.id,
      stage,
      status,
      updatedAt: now,
      lastInteractionAt: now,
    })
    insertStageHistory(
      db,
      {
        tenantId,
        opportunityId: opp.id,
        fromStage: 'novo_contato',
        toStage: stage,
        actorClerkUserId: cnv.assigneeClerkUserId ?? 'user_synth_ana',
        actorDisplayName: cnv.assigneeDisplayName ?? 'Ana',
        note: opts.historyNote ?? null,
        createdAt: now,
      },
      clock,
    )
  }

  if (opts.linkedAppointmentId) {
    setLinkedAppointment(db, {
      tenantId,
      opportunityId: opp.id,
      appointmentId: opts.linkedAppointmentId,
      updatedAt: t0,
    })
    db.run(
      `UPDATE appointments SET opportunity_id = ?, contact_id = ?, conversation_id = ?
       WHERE tenant_id = ? AND id = ?`,
      opp.id,
      cnv.contactId,
      conversationId,
      tenantId,
      opts.linkedAppointmentId,
    )
  }
}
