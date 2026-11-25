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
import { conversationNeedsPerson, loadContactSummary } from '../inbox/conversations'
import { contactHasPendingPix } from '../inbox/pending-pix'
import type { ClinicDb, SqlValue } from '../store'
import {
  boardKeyFor,
  countFutureConfirmedAppointmentsForContact,
  hasOpenAttendance,
  openAttendanceBoardStage,
  shouldProjectOpenAttendance,
  toOpenAttendanceCard,
} from './board-cards'
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
  clock: Clock,
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
  const now = clock.nowMs()
  const futureAppointmentCount = countFutureConfirmedAppointmentsForContact(
    db,
    opp.tenantId,
    opp.contactId,
    now,
  )
  const openAtt = hasOpenAttendance(db, opp.tenantId, opp.conversationId, clock)
  const needsPerson = conversationNeedsPerson(db, opp.tenantId, opp.conversationId)
  const hasPendingPix = contactHasPendingPix(db, opp.tenantId, opp.contactId, now)
  // DEC-228: `horario_proposto` permanece no schema/histórico, mas a leitura
  // operacional projecta esses registos legados em Em atendimento.
  const viewStage: OpportunityStage =
    opp.stage === 'horario_proposto' ? 'em_atendimento' : opp.stage
  const base: OpportunityListItem = {
    ...opp,
    stage: viewStage,
    contact,
    missingAppointment,
    linkedAppointment,
    openHold: loadOpenHoldForOpportunity(db, opp.tenantId, opp.id),
    cardKind: 'cycle',
    boardKey: boardKeyFor({ id: opp.id, cardKind: 'cycle' }),
    futureAppointmentCount,
    hasOpenAttendance: openAtt,
    needsPerson,
    hasPendingPix,
  }
  return base
}

function loadOpenAgendado(
  db: ClinicDb,
  tenantId: string,
  clock: Clock,
): OpportunityListItem[] {
  const rows = db.all<OppSql>(
    `SELECT * FROM opportunities
     WHERE tenant_id = ? AND status = 'open' AND stage = 'agendado'
     ORDER BY updated_at DESC, id DESC`,
    tenantId,
  )
  return rows.map((r) => toListItem(db, mapOpportunity(r), clock))
}

/**
 * DEC-229: Perdido é a situação comercial actual do contacto, não o arquivo
 * de todos os ciclos que terminaram sem marcação.
 *
 * Conservamos cada ciclo no histórico, mas projectamos no quadro apenas o
 * último ciclo do contacto, desde que ainda seja Perdido, não exista outro
 * ciclo aberto e não haja compromisso futuro confirmado.
 */
const VISIBLE_LOST_WHERE = `
  lost.tenant_id = ?
  AND lost.status = 'closed'
  AND lost.stage = 'perdido'
  AND NOT EXISTS (
    SELECT 1
    FROM opportunities active
    WHERE active.tenant_id = lost.tenant_id
      AND active.contact_id = lost.contact_id
      AND active.status = 'open'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM opportunities newer
    WHERE newer.tenant_id = lost.tenant_id
      AND newer.contact_id = lost.contact_id
      AND (
        newer.updated_at > lost.updated_at
        OR (newer.updated_at = lost.updated_at AND newer.id > lost.id)
      )
  )
  AND NOT EXISTS (
    SELECT 1
    FROM appointments future
    WHERE future.tenant_id = lost.tenant_id
      AND future.contact_id = lost.contact_id
      AND future.status = 'confirmed'
      AND future.ends_at > ?
  )`

function loadVisibleLost(
  db: ClinicDb,
  tenantId: string,
  limit: number,
  clock: Clock,
): OpportunityListItem[] {
  const rows = db.all<OppSql>(
    `SELECT lost.*
     FROM opportunities lost
     WHERE ${VISIBLE_LOST_WHERE}
     ORDER BY lost.updated_at DESC, lost.id DESC
     LIMIT ?`,
    tenantId,
    clock.nowMs(),
    limit,
  )
  return rows.map((row) => toListItem(db, mapOpportunity(row), clock))
}

function countVisibleLost(db: ClinicDb, tenantId: string, clock: Clock): number {
  const row = db.get<{ n: number }>(
    `SELECT COUNT(*) AS n
     FROM opportunities lost
     WHERE ${VISIBLE_LOST_WHERE}`,
    tenantId,
    clock.nowMs(),
  )
  return row?.n ?? 0
}

/**
 * DEC-187: com Agendado + horários futuros + atendimento aberto (sessão,
 * proposta, quadro, handoff ou inbound pós-confirmação), projecta cartão
 * gémeo em Em atendimento. Ao confirmar a nova marcação
 * o gémeo some (merge no Agendado).
 */
function expandBoardCards(
  db: ClinicDb,
  tenantId: string,
  items: OpportunityListItem[],
  input: ListOpportunitiesInput,
  clock: Clock,
): OpportunityListItem[] {
  const wantAttendance = !input.stage || input.stage === 'em_atendimento'
  if (!wantAttendance) return items

  const agendadoSources =
    input.stage === 'agendado' || !input.stage
      ? items.filter((i) => i.stage === 'agendado')
      : loadOpenAgendado(db, tenantId, clock)

  const twins: OpportunityListItem[] = []
  for (const cycle of agendadoSources) {
    if (!shouldProjectOpenAttendance(cycle)) continue
    const stage = openAttendanceBoardStage()
    if (input.stage && input.stage !== stage) continue
    twins.push(toOpenAttendanceCard(cycle, stage))
  }

  if (twins.length === 0) return items
  // Gémeos à frente na coluna de atendimento (actividade recente primeiro).
  if (input.stage === 'em_atendimento') {
    return [...twins, ...items]
  }
  return [...items, ...twins]
}

export function listOpportunities(
  db: ClinicDb,
  tenantId: string,
  input: ListOpportunitiesInput = {},
  clock: Clock = { nowMs: () => Date.now() },
): { items: OpportunityListItem[]; counts: StageCount[] } {
  const limit = Math.min(Math.max(input.limit ?? 100, 1), 200)
  // Alias de compatibilidade para clientes antigos que ainda peçam a coluna removida.
  const viewInput: ListOpportunitiesInput =
    input.stage === 'horario_proposto'
      ? { ...input, stage: 'em_atendimento' }
      : input
  if (viewInput.stage === 'perdido' && viewInput.includeClosed) {
    return {
      items: loadVisibleLost(db, tenantId, limit, clock),
      counts: countByStage(db, tenantId, clock),
    }
  }
  const params: SqlValue[] = [tenantId]
  let where = `tenant_id = ?`
  if (!viewInput.includeClosed) {
    where += ` AND status = 'open'`
  }
  if (viewInput.stage) {
    if (!isOpportunityStage(viewInput.stage)) {
      throw new ValidationError('invalid_stage', `Etapa inválida: ${viewInput.stage}`)
    }
    if (viewInput.stage === 'em_atendimento') {
      where += ` AND stage IN ('em_atendimento', 'horario_proposto')`
    } else {
      where += ` AND stage = ?`
      params.push(viewInput.stage)
    }
  }
  params.push(limit)
  const rows = db.all<OppSql>(
    `SELECT * FROM opportunities
     WHERE ${where}
     ORDER BY updated_at DESC, id DESC
     LIMIT ?`,
    ...params,
  )
  const items = expandBoardCards(
    db,
    tenantId,
    rows.map((r) => toListItem(db, mapOpportunity(r), clock)),
    viewInput,
    clock,
  )
  return { items, counts: countByStage(db, tenantId, clock) }
}

export function countByStage(
  db: ClinicDb,
  tenantId: string,
  clock: Clock = { nowMs: () => Date.now() },
): StageCount[] {
  const rows = db.all<{ stage: string; n: number }>(
    `SELECT stage, COUNT(*) AS n FROM opportunities
     WHERE tenant_id = ? AND status = 'open'
     GROUP BY stage`,
    tenantId,
  )
  const map = new Map(rows.map((r) => [r.stage, r.n]))
  map.set(
    'em_atendimento',
    (map.get('em_atendimento') ?? 0) + (map.get('horario_proposto') ?? 0),
  )
  map.set('horario_proposto', 0)
  map.set('perdido', countVisibleLost(db, tenantId, clock))
  // DEC-187: gémeos de atendimento entram nas contagens das colunas cedo.
  for (const cycle of loadOpenAgendado(db, tenantId, clock)) {
    if (!shouldProjectOpenAttendance(cycle)) continue
    const stage = openAttendanceBoardStage()
    map.set(stage, (map.get(stage) ?? 0) + 1)
  }
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
  clock: Clock = { nowMs: () => Date.now() },
): OpportunityDetail {
  const opp = requireOpportunity(db, tenantId, opportunityId)
  return {
    ...toListItem(db, opp, clock),
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
