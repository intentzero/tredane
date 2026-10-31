import { loadOpenHoldForOpportunity } from '../scheduling/hold-rows'
import type { Clock } from '../../db/clock'
import {
  OPPORTUNITY_STAGE_LABELS,
  OPPORTUNITY_STAGES,
  TERMINAL_OPPORTUNITY_STAGES,
  type OpportunityStage,
} from '../constants'
import { NotFoundError, ValidationError } from '../errors'
import { newId } from '../ids'
import { loadContactSummary } from '../inbox/conversations'
import type { ClinicDb, SqlValue } from '../store'
import { mapLinkedAppointment, mapOpportunity, mapStageHistory } from './rows'
import type {
  LinkedAppointmentSummary,
  ListOpportunitiesInput,
  OpportunityDetail,
  OpportunityListItem,
  OpportunityRow,
  StageCount,
  StageHistoryRow,
} from './types'

type OppSql = Parameters<typeof mapOpportunity>[0]
type HistSql = Parameters<typeof mapStageHistory>[0]

export function isOpportunityStage(value: string): value is OpportunityStage {
  return (OPPORTUNITY_STAGES as readonly string[]).includes(value)
}

export function isTerminalStage(stage: OpportunityStage): boolean {
  return (TERMINAL_OPPORTUNITY_STAGES as readonly OpportunityStage[]).includes(stage)
}

export function getOpportunity(
  db: ClinicDb,
  tenantId: string,
  opportunityId: string,
): OpportunityRow | null {
  const row = db.get<OppSql>(
    `SELECT * FROM opportunities WHERE tenant_id = ? AND id = ?`,
    tenantId,
    opportunityId,
  )
  return row ? mapOpportunity(row) : null
}

export function requireOpportunity(
  db: ClinicDb,
  tenantId: string,
  opportunityId: string,
): OpportunityRow {
  const row = getOpportunity(db, tenantId, opportunityId)
  if (!row) {
    throw new NotFoundError('opportunity_not_found', 'Contato em andamento não encontrado')
  }
  return row
}

export function findOpenOpportunityForConversation(
  db: ClinicDb,
  tenantId: string,
  conversationId: string,
): OpportunityRow | null {
  const row = db.get<OppSql>(
    `SELECT * FROM opportunities
     WHERE tenant_id = ? AND conversation_id = ? AND status = 'open'
     ORDER BY updated_at DESC, id DESC
     LIMIT 1`,
    tenantId,
    conversationId,
  )
  return row ? mapOpportunity(row) : null
}

export function maxCycleForConversation(
  db: ClinicDb,
  tenantId: string,
  conversationId: string,
): number {
  const row = db.get<{ n: number | null }>(
    `SELECT MAX(cycle_number) AS n FROM opportunities
     WHERE tenant_id = ? AND conversation_id = ?`,
    tenantId,
    conversationId,
  )
  return row?.n ?? 0
}

export function loadLinkedAppointment(
  db: ClinicDb,
  tenantId: string,
  appointmentId: string | null,
): LinkedAppointmentSummary | null {
  if (!appointmentId) return null
  const row = db.get<{
    id: string
    starts_at: number
    ends_at: number
    status: string
    contact_label: string | null
    service_id: string
    professional_id: string
    change_reason: string | null
  }>(
    `SELECT id, starts_at, ends_at, status, contact_label, service_id, professional_id, change_reason
     FROM appointments WHERE tenant_id = ? AND id = ?`,
    tenantId,
    appointmentId,
  )
  return row ? mapLinkedAppointment(row) : null
}

function toListItem(
  db: ClinicDb,
  opp: OpportunityRow,
): OpportunityListItem {
  const contact = loadContactSummary(db, opp.tenantId, opp.contactId)
  if (!contact) {
    throw new NotFoundError('contact_not_found', 'Contacto da oportunidade ausente')
  }
  const linkedAppointment = loadLinkedAppointment(
    db,
    opp.tenantId,
    opp.linkedAppointmentId,
  )
  const missingAppointment =
    opp.stage === 'agendado' && linkedAppointment === null
  return {
    ...opp,
    contact,
    missingAppointment,
    linkedAppointment,
    openHold: loadOpenHoldForOpportunity(db, opp.tenantId, opp.id),
  }
}

export function listOpportunities(
  db: ClinicDb,
  tenantId: string,
  input: ListOpportunitiesInput = {},
): { items: OpportunityListItem[]; counts: StageCount[] } {
  const limit = Math.min(Math.max(input.limit ?? 100, 1), 200)
  const params: SqlValue[] = [tenantId]
  let where = `tenant_id = ?`
  if (!input.includeClosed) {
    where += ` AND status = 'open'`
  }
  if (input.stage) {
    if (!isOpportunityStage(input.stage)) {
      throw new ValidationError('invalid_stage', `Etapa inválida: ${input.stage}`)
    }
    where += ` AND stage = ?`
    params.push(input.stage)
  }
  params.push(limit)
  const rows = db.all<OppSql>(
    `SELECT * FROM opportunities
     WHERE ${where}
     ORDER BY updated_at DESC, id DESC
     LIMIT ?`,
    ...params,
  )
  const items = rows.map((r) => toListItem(db, mapOpportunity(r)))
  return { items, counts: countByStage(db, tenantId) }
}

export function countByStage(db: ClinicDb, tenantId: string): StageCount[] {
  const rows = db.all<{ stage: string; n: number }>(
    `SELECT stage, COUNT(*) AS n FROM opportunities
     WHERE tenant_id = ? AND status = 'open'
     GROUP BY stage`,
    tenantId,
  )
  const map = new Map(rows.map((r) => [r.stage, r.n]))
  return OPPORTUNITY_STAGES.map((stage) => ({
    stage,
    label: OPPORTUNITY_STAGE_LABELS[stage],
    count: map.get(stage) ?? 0,
  }))
}

export function listStageHistory(
  db: ClinicDb,
  tenantId: string,
  opportunityId: string,
): StageHistoryRow[] {
  return db
    .all<HistSql>(
      `SELECT * FROM opportunity_stage_history
       WHERE tenant_id = ? AND opportunity_id = ?
       ORDER BY created_at ASC, id ASC`,
      tenantId,
      opportunityId,
    )
    .map(mapStageHistory)
}

export function getOpportunityDetail(
  db: ClinicDb,
  tenantId: string,
  opportunityId: string,
): OpportunityDetail {
  const opp = requireOpportunity(db, tenantId, opportunityId)
  return {
    ...toListItem(db, opp),
    history: listStageHistory(db, tenantId, opportunityId),
  }
}

export function insertOpportunity(
  db: ClinicDb,
  input: {
    tenantId: string
    contactId: string
    conversationId: string
    stage?: OpportunityStage
    cycleNumber?: number
    assigneeClerkUserId?: string | null
    assigneeDisplayName?: string | null
    lastInteractionAt?: number | null
    linkedAppointmentId?: string | null
    id?: string
  },
  clock: Clock,
): OpportunityRow {
  const stage = input.stage ?? 'novo_contato'
  if (!isOpportunityStage(stage)) {
    throw new ValidationError('invalid_stage', `Etapa inválida: ${stage}`)
  }
  const now = clock.nowMs()
  const id = input.id ?? newId('opp')
  const status = isTerminalStage(stage) ? 'closed' : 'open'
  db.run(
    `INSERT INTO opportunities (
      id, tenant_id, contact_id, conversation_id, stage, status, cycle_number,
      assignee_clerk_user_id, assignee_display_name, last_interaction_at,
      linked_appointment_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    input.tenantId,
    input.contactId,
    input.conversationId,
    stage,
    status,
    input.cycleNumber ?? 1,
    input.assigneeClerkUserId ?? null,
    input.assigneeDisplayName ?? null,
    input.lastInteractionAt ?? now,
    input.linkedAppointmentId ?? null,
    now,
    now,
  )
  return getOpportunity(db, input.tenantId, id)!
}

export function insertStageHistory(
  db: ClinicDb,
  input: {
    tenantId: string
    opportunityId: string
    fromStage: OpportunityStage | null
    toStage: OpportunityStage
    actorClerkUserId?: string | null
    actorDisplayName?: string | null
    note?: string | null
    id?: string
    createdAt?: number
  },
  clock: Clock,
): StageHistoryRow {
  const id = input.id ?? newId('osh')
  const createdAt = input.createdAt ?? clock.nowMs()
  db.run(
    `INSERT INTO opportunity_stage_history (
      id, tenant_id, opportunity_id, from_stage, to_stage,
      actor_clerk_user_id, actor_display_name, note, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    input.tenantId,
    input.opportunityId,
    input.fromStage,
    input.toStage,
    input.actorClerkUserId ?? null,
    input.actorDisplayName ?? null,
    input.note ?? null,
    createdAt,
  )
  return listStageHistory(db, input.tenantId, input.opportunityId).find((h) => h.id === id)!
}

export function updateOpportunityStage(
  db: ClinicDb,
  input: {
    tenantId: string
    opportunityId: string
    stage: OpportunityStage
    status: 'open' | 'closed'
    updatedAt: number
    lastInteractionAt?: number
  },
): OpportunityRow {
  db.run(
    `UPDATE opportunities SET
      stage = ?,
      status = ?,
      updated_at = ?,
      last_interaction_at = COALESCE(?, last_interaction_at)
     WHERE tenant_id = ? AND id = ?`,
    input.stage,
    input.status,
    input.updatedAt,
    input.lastInteractionAt ?? null,
    input.tenantId,
    input.opportunityId,
  )
  return requireOpportunity(db, input.tenantId, input.opportunityId)
}

export function setLinkedAppointment(
  db: ClinicDb,
  input: {
    tenantId: string
    opportunityId: string
    appointmentId: string | null
    updatedAt: number
  },
): OpportunityRow {
  db.run(
    `UPDATE opportunities SET linked_appointment_id = ?, updated_at = ?
     WHERE tenant_id = ? AND id = ?`,
    input.appointmentId,
    input.updatedAt,
    input.tenantId,
    input.opportunityId,
  )
  return requireOpportunity(db, input.tenantId, input.opportunityId)
}

export function touchLastInteraction(
  db: ClinicDb,
  tenantId: string,
  opportunityId: string,
  at: number,
): void {
  db.run(
    `UPDATE opportunities SET last_interaction_at = ?, updated_at = ?
     WHERE tenant_id = ? AND id = ?`,
    at,
    at,
    tenantId,
    opportunityId,
  )
}
