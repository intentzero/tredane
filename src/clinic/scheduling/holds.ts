/**
 * Reserva por bloco (decisões do fundador, 27/10/2026).
 *
 * - A atendente define a duração caso a caso.
 * - O bloco ocupa só essa duração, na agenda de UMA profissional, algures
 *   dentro do período (manhã/tarde/outro). Novos agendamentos só são
 *   recusados se impedirem o bloco de caber (`hold_conflict`).
 * - Ao reservar, o contato vai para «A definir». Ao definir a hora, vira
 *   compromisso confirmado e o contato vai para «Agendado».
 * - Se o período passar sem hora, o bloco vence, o contato fica em
 *   «A definir» e a atendente responsável recebe aviso in-app. Blocos que
 *   começam em menos de 48 h também geram aviso.
 * - Mensagens WhatsApp NÃO saem daqui: o cliente usa o envio normal de texto,
 *   e só dentro da janela de 24 h.
 */
import type { Clock } from '../../db/clock'
import { writeOperationalAudit } from '../audit'
import { listWeeklyWindows } from '../config/availability'
import { getResource } from '../config/resources'
import { getService } from '../config/services'
import { ensureClinicSettings } from '../config/settings'
import {
  SCHEDULE_GRID_MINUTES,
  SCHEDULE_HOLD_ALERT_LEAD_MS,
  type OpportunityStage,
} from '../constants'
import type { ClinicCaller } from '../envelopes'
import { assertValidCaller } from '../envelopes'
import { ConflictError, NotFoundError, ValidationError } from '../errors'
import { newId } from '../ids'
import { requireConversation } from '../inbox/conversations'
import { assertClinicSchemaReady } from '../migrations'
import { insertOutboxEvent, type OutboxRow } from '../outbox'
import { ensureOpenOpportunity } from '../pipeline/operations'
import {
  getOpportunity,
  insertStageHistory,
  isTerminalStage,
  updateOpportunityStage,
} from '../pipeline/opportunities'
import type { ClinicDb } from '../store'
import { bindOrAssertTenant } from '../tenant'
import { confirmAppointmentInTransaction } from './booking'
import type { AppointmentDetail } from './booking-types'
import {
  collectHoldCluster,
  freeMinutesInWindow,
  holdsFeasible,
  listFirmBusy,
  type FitContext,
} from './hold-fit'
import {
  getHold,
  HOLD_SELECT,
  mapHold,
  type HoldSql,
  type ScheduleHoldView,
} from './hold-rows'
import { clinicCivilDateFromUtc, clinicMinuteOfDay } from './timezone'

export type { ScheduleHoldView } from './hold-rows'

export type HoldMutationResult<T> = {
  value: T
  outbox: OutboxRow[]
  idempotentReplay?: boolean
}

export type HoldPreviewInput = {
  professionalId: string
  windowStartsAt: number
  windowEndsAt: number
  durationMinutes: number
}

export type HoldPreviewResult = {
  freeMinutes: number
  fits: boolean
  asOf: number
}

export type CreateHoldInput = HoldPreviewInput & {
  clientRequestId: string
  conversationId: string
  serviceId: string
  confirmBy?: number | null
  actorClerkUserId: string
  actorDisplayName?: string | null
}

export type ResolveHoldInput = {
  holdId: string
  clientRequestId: string
  startsAt: number
  roomResourceId?: string | null
  actorClerkUserId: string
  actorDisplayName?: string | null
}

export type CancelHoldInput = {
  holdId: string
  actorClerkUserId: string
  actorDisplayName?: string | null
}

export type ListHoldsInput = {
  conversationId?: string | null
  professionalId?: string | null
  rangeStartsAt?: number | null
  rangeEndsAt?: number | null
  statuses?: string[] | null
}

export type HoldAlert = {
  kind: 'starts_soon' | 'expired'
  hold: ScheduleHoldView
}

const MAX_HOLD_MINUTES = 12 * 60

function prepare(db: ClinicDb, caller: ClinicCaller, clock: Clock) {
  assertClinicSchemaReady(db)
  assertValidCaller(caller)
  const meta = bindOrAssertTenant(db, caller, clock)
  const settings = ensureClinicSettings(db, meta.tenantId, clock)
  return { tenantId: meta.tenantId, timezone: settings.timezone }
}

function fitContext(
  db: ClinicDb,
  tenantId: string,
  timezone: string,
  professionalId: string,
  nowMs: number,
): FitContext {
  return {
    timezone,
    windows: listWeeklyWindows(db, tenantId).filter((w) => w.resourceId === professionalId),
    nowMs,
  }
}

function validateWindow(
  timezone: string,
  input: HoldPreviewInput,
  nowMs: number,
): void {
  const { windowStartsAt: ws, windowEndsAt: we, durationMinutes: d } = input
  if (!Number.isFinite(ws) || !Number.isFinite(we) || we <= ws) {
    throw new ValidationError('invalid_hold_window', 'Período inválido')
  }
  if (
    clinicMinuteOfDay(timezone, ws) % SCHEDULE_GRID_MINUTES !== 0
    || clinicMinuteOfDay(timezone, we) % SCHEDULE_GRID_MINUTES !== 0
  ) {
    throw new ValidationError('invalid_hold_window', 'O período deve começar e terminar em múltiplos de 15 min')
  }
  if (clinicCivilDateFromUtc(timezone, ws) !== clinicCivilDateFromUtc(timezone, we - 1)) {
    throw new ValidationError('invalid_hold_window', 'O período deve ficar dentro de um só dia')
  }
  if (we <= nowMs) {
    throw new ValidationError('hold_window_past', 'Esse período já passou')
  }
  if (
    !Number.isInteger(d)
    || d < SCHEDULE_GRID_MINUTES
    || d > MAX_HOLD_MINUTES
    || d % SCHEDULE_GRID_MINUTES !== 0
  ) {
    throw new ValidationError('invalid_hold_duration', 'Duração deve ser múltiplo de 15 min (15 min a 12 h)')
  }
  if (d * 60_000 > we - ws) {
    throw new ValidationError('invalid_hold_duration', 'A duração é maior que o período')
  }
}

function requireProfessional(db: ClinicDb, tenantId: string, id: string, clock: Clock) {
  const pro = getResource(db, tenantId, id, clock)
  if (!pro || pro.kind !== 'professional' || !pro.active) {
    throw new NotFoundError('professional_not_found', 'Profissional não encontrada nesta clínica')
  }
  return pro
}

function evaluate(
  db: ClinicDb,
  tenantId: string,
  timezone: string,
  input: HoldPreviewInput,
  nowMs: number,
  excludeHoldId?: string | null,
): HoldPreviewResult {
  const ctx = fitContext(db, tenantId, timezone, input.professionalId, nowMs)
  const window = { startsAt: input.windowStartsAt, endsAt: input.windowEndsAt }
  const { needs, span } = collectHoldCluster(
    db,
    tenantId,
    input.professionalId,
    window,
    nowMs,
    excludeHoldId,
  )
  const firm = listFirmBusy(db, tenantId, input.professionalId, span)
  const newNeed = {
    id: '~new',
    windowStartsAt: input.windowStartsAt,
    windowEndsAt: input.windowEndsAt,
    durationMinutes: input.durationMinutes,
  }
  const fits = holdsFeasible([...needs, newNeed], firm, ctx)
  // Minutos livres: desconta ocupação firme e a parte dos outros blocos que
  // não pode sair deste período (conservador: duração inteira se o bloco
  // fica todo dentro do período).
  let free = freeMinutesInWindow(window, firm, ctx)
  for (const n of needs) {
    if (n.windowStartsAt >= window.startsAt && n.windowEndsAt <= window.endsAt) {
      free -= n.durationMinutes
    }
  }
  return { freeMinutes: Math.max(0, free), fits, asOf: nowMs }
}

export function previewHoldOp(
  db: ClinicDb,
  caller: ClinicCaller,
  input: HoldPreviewInput,
  clock: Clock,
): HoldPreviewResult {
  const { tenantId, timezone } = prepare(db, caller, clock)
  const nowMs = clock.nowMs()
  validateWindow(timezone, input, nowMs)
  requireProfessional(db, tenantId, input.professionalId, clock)
  return evaluate(db, tenantId, timezone, input, nowMs)
}

function moveStage(
  db: ClinicDb,
  tenantId: string,
  opportunityId: string,
  toStage: OpportunityStage,
  actor: { id: string; name: string | null },
  note: string,
  clock: Clock,
  outbox: OutboxRow[],
  onlyFrom?: OpportunityStage[],
): void {
  const before = getOpportunity(db, tenantId, opportunityId)
  if (!before || before.status !== 'open') return
  if (before.stage === toStage) return
  if (onlyFrom && !onlyFrom.includes(before.stage)) return
  const now = clock.nowMs()
  const nextStatus = isTerminalStage(toStage) ? 'closed' : 'open'
  updateOpportunityStage(db, {
    tenantId,
    opportunityId,
    stage: toStage,
    status: nextStatus,
    updatedAt: now,
    lastInteractionAt: now,
  })
  insertStageHistory(
    db,
    {
      tenantId,
      opportunityId,
      fromStage: before.stage,
      toStage,
      actorClerkUserId: actor.id,
      actorDisplayName: actor.name,
      note,
      createdAt: now,
    },
    clock,
  )
  outbox.push(
    insertOutboxEvent(
      db,
      {
        tenantId,
        type: 'opportunity.stage_changed',
        aggregateType: 'opportunity',
        aggregateId: opportunityId,
        idempotencyKey: `opportunity.stage_changed:${opportunityId}:${now}:${toStage}`,
        payload: {
          opportunityId,
          conversationId: before.conversationId,
          contactId: before.contactId,
          fromStage: before.stage,
          toStage,
          status: nextStatus,
          actorClerkUserId: actor.id,
          linkedAppointmentId: before.linkedAppointmentId,
          missingAppointment: false,
        },
      },
      clock,
    ),
  )
}

function holdEvent(
  db: ClinicDb,
  tenantId: string,
  type: string,
  hold: ScheduleHoldView,
  clock: Clock,
): OutboxRow {
  return insertOutboxEvent(
    db,
    {
      tenantId,
      type,
      aggregateType: 'schedule_hold',
      aggregateId: hold.id,
      idempotencyKey: `${type}:${hold.id}:${hold.updatedAt}`,
      payload: {
        holdId: hold.id,
        status: hold.status,
        conversationId: hold.conversationId,
        contactId: hold.contactId,
        opportunityId: hold.opportunityId,
        professionalId: hold.professionalId,
        windowStartsAt: hold.windowStartsAt,
        windowEndsAt: hold.windowEndsAt,
        durationMinutes: hold.durationMinutes,
        appointmentId: hold.appointmentId,
        responsibleClerkUserId: hold.responsibleClerkUserId,
      },
    },
    clock,
  )
}

function requireHold(db: ClinicDb, tenantId: string, holdId: string): ScheduleHoldView {
  const hold = getHold(db, tenantId, holdId)
  if (!hold) throw new NotFoundError('hold_not_found', 'Bloco não encontrado nesta clínica')
  return hold
}

export function createHoldOp(
  db: ClinicDb,
  caller: ClinicCaller,
  input: CreateHoldInput,
  clock: Clock,
): HoldMutationResult<ScheduleHoldView> {
  const { tenantId, timezone } = prepare(db, caller, clock)
  const clientRequestId = (input.clientRequestId ?? '').trim()
  if (!clientRequestId || clientRequestId.length > 200) {
    throw new ValidationError('client_request_id_required', 'clientRequestId obrigatório')
  }
  if (!input.actorClerkUserId) {
    throw new ValidationError('actor_required', 'Actor obrigatório para esta operação')
  }

  return db.transactionSync(() => {
    const prior = db.get<{ id: string }>(
      `SELECT id FROM schedule_holds WHERE tenant_id = ? AND client_request_id = ?`,
      tenantId,
      clientRequestId,
    )
    if (prior) {
      return { value: requireHold(db, tenantId, prior.id), outbox: [], idempotentReplay: true }
    }

    const nowMs = clock.nowMs()
    validateWindow(timezone, input, nowMs)
    const conv = requireConversation(db, tenantId, input.conversationId)
    const service = getService(db, tenantId, input.serviceId)
    if (!service || !service.active) {
      throw new NotFoundError('service_not_found', 'Procedimento não encontrado ou inactivo nesta clínica')
    }
    const pro = requireProfessional(db, tenantId, input.professionalId, clock)
    if (service.professionalIds.length > 0 && !service.professionalIds.includes(pro.id)) {
      throw new ValidationError('professional_not_linked', 'Essa profissional não faz este procedimento')
    }
    if (input.confirmBy != null && (!Number.isFinite(input.confirmBy) || input.confirmBy > input.windowEndsAt)) {
      throw new ValidationError('invalid_confirm_by', '«Confirmar até» deve ser antes do fim do período')
    }

    const active = db.get<{ id: string }>(
      `SELECT id FROM schedule_holds
       WHERE tenant_id = ? AND conversation_id = ? AND status = 'active' AND window_ends_at > ?`,
      tenantId,
      conv.id,
      nowMs,
    )
    if (active) {
      throw new ConflictError(
        'hold_already_active',
        'Esta conversa já tem um bloco reservado. Defina a hora ou cancele-o antes.',
        { holdId: active.id },
      )
    }

    const evaluation = evaluate(db, tenantId, timezone, input, nowMs)
    if (!evaluation.fits) {
      throw new ConflictError(
        'hold_no_fit',
        'Não cabe: a profissional não tem esse tempo livre no período. Nada foi reservado.',
        { freeMinutes: evaluation.freeMinutes },
      )
    }

    const outbox: OutboxRow[] = []
    const ensured = ensureOpenOpportunity(
      db,
      {
        tenantId,
        contactId: conv.contactId,
        conversationId: conv.id,
        assigneeClerkUserId: conv.assigneeClerkUserId,
        assigneeDisplayName: conv.assigneeDisplayName,
        lastInteractionAt: nowMs,
      },
      clock,
    )
    outbox.push(...ensured.outbox)
    const opp = ensured.opportunity

    const responsibleId =
      conv.assigneeClerkUserId ?? opp.assigneeClerkUserId ?? input.actorClerkUserId
    const responsibleName =
      conv.assigneeClerkUserId
        ? conv.assigneeDisplayName
        : opp.assigneeClerkUserId
          ? opp.assigneeDisplayName
          : (input.actorDisplayName ?? null)

    // Vencidos anteriores desta conversa deixam de alertar.
    db.run(
      `UPDATE schedule_holds SET alert_dismissed_at = ?, updated_at = ?
       WHERE tenant_id = ? AND conversation_id = ? AND status = 'expired'
         AND alert_dismissed_at IS NULL`,
      nowMs,
      nowMs,
      tenantId,
      conv.id,
    )

    const id = newId('hold')
    db.run(
      `INSERT INTO schedule_holds (
        id, tenant_id, client_request_id, opportunity_id, conversation_id,
        contact_id, service_id, professional_id, duration_minutes,
        window_starts_at, window_ends_at, confirm_by, status,
        responsible_clerk_user_id, responsible_display_name,
        created_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?)`,
      id,
      tenantId,
      clientRequestId,
      opp.id,
      conv.id,
      conv.contactId,
      service.id,
      pro.id,
      input.durationMinutes,
      input.windowStartsAt,
      input.windowEndsAt,
      input.confirmBy ?? null,
      responsibleId,
      responsibleName,
      input.actorClerkUserId,
      nowMs,
      nowMs,
    )

    moveStage(
      db,
      tenantId,
      opp.id,
      'a_definir',
      { id: input.actorClerkUserId, name: input.actorDisplayName ?? null },
      'Bloco reservado — hora a definir',
      clock,
      outbox,
    )

    const hold = requireHold(db, tenantId, id)
    outbox.push(holdEvent(db, tenantId, 'schedule_hold.created', hold, clock))
    writeOperationalAudit(
      db,
      {
        tenantId,
        actor: input.actorClerkUserId,
        action: 'schedule_hold.created',
        objectType: 'schedule_hold',
        objectId: id,
        detail: {
          professionalId: pro.id,
          serviceId: service.id,
          windowStartsAt: hold.windowStartsAt,
          windowEndsAt: hold.windowEndsAt,
          durationMinutes: hold.durationMinutes,
        },
      },
      clock,
    )
    return { value: hold, outbox }
  })
}

export function resolveHoldOp(
  db: ClinicDb,
  caller: ClinicCaller,
  input: ResolveHoldInput,
  clock: Clock,
): HoldMutationResult<{ hold: ScheduleHoldView; appointment: AppointmentDetail }> {
  const { tenantId } = prepare(db, caller, clock)
  if (!input.actorClerkUserId) {
    throw new ValidationError('actor_required', 'Actor obrigatório para esta operação')
  }
  return db.transactionSync(() => {
    const hold = requireHold(db, tenantId, input.holdId)
    if (hold.status === 'resolved' && hold.appointmentId) {
      const replay = confirmAppointmentInTransaction(
        db,
        caller,
        {
          clientRequestId: input.clientRequestId,
          serviceId: hold.serviceId,
          professionalId: hold.professionalId,
          roomResourceId: input.roomResourceId ?? null,
          startsAt: input.startsAt,
          actorClerkUserId: input.actorClerkUserId,
          excludeHoldId: hold.id,
        },
        clock,
      )
      if (replay.idempotentReplay && replay.value.id === hold.appointmentId) {
        return { value: { hold, appointment: replay.value }, outbox: [], idempotentReplay: true }
      }
      throw new ConflictError('hold_not_active', 'Este bloco já tem hora definida.')
    }
    // Vencido também pode receber hora (dentro do período original não dá,
    // mas a atendente pode definir uma hora qualquer — vira compromisso).
    if (hold.status !== 'active' && hold.status !== 'expired') {
      throw new ConflictError('hold_not_active', 'Este bloco já não está activo.')
    }
    if (hold.status === 'active') {
      const durMs = hold.durationMinutes * 60_000
      if (input.startsAt < hold.windowStartsAt || input.startsAt + durMs > hold.windowEndsAt) {
        throw new ValidationError(
          'hold_start_outside_window',
          'A hora tem de ficar dentro do período reservado.',
        )
      }
    }

    const confirmed = confirmAppointmentInTransaction(
      db,
      caller,
      {
        clientRequestId: input.clientRequestId,
        serviceId: hold.serviceId,
        professionalId: hold.professionalId,
        roomResourceId: input.roomResourceId ?? null,
        startsAt: input.startsAt,
        contactId: hold.contactId,
        conversationId: hold.conversationId,
        opportunityId: hold.opportunityId,
        actorClerkUserId: input.actorClerkUserId,
        excludeHoldId: hold.id,
      },
      clock,
    )
    const outbox = [...confirmed.outbox]
    const now = clock.nowMs()
    db.run(
      `UPDATE schedule_holds
       SET status = 'resolved', appointment_id = ?, resolved_at = ?, updated_at = ?,
           alert_dismissed_at = COALESCE(alert_dismissed_at, ?)
       WHERE tenant_id = ? AND id = ?`,
      confirmed.value.id,
      now,
      now,
      now,
      tenantId,
      hold.id,
    )
    if (hold.opportunityId) {
      moveStage(
        db,
        tenantId,
        hold.opportunityId,
        'agendado',
        { id: input.actorClerkUserId, name: input.actorDisplayName ?? null },
        'Hora do bloco definida',
        clock,
        outbox,
      )
    }
    const next = requireHold(db, tenantId, hold.id)
    outbox.push(holdEvent(db, tenantId, 'schedule_hold.resolved', next, clock))
    writeOperationalAudit(
      db,
      {
        tenantId,
        actor: input.actorClerkUserId,
        action: 'schedule_hold.resolved',
        objectType: 'schedule_hold',
        objectId: hold.id,
        detail: { appointmentId: confirmed.value.id, startsAt: input.startsAt },
      },
      clock,
    )
    return { value: { hold: next, appointment: confirmed.value }, outbox }
  })
}

/** Cancela sem transação própria (usado também ao fechar a oportunidade). */
export function cancelActiveHoldsInTransaction(
  db: ClinicDb,
  tenantId: string,
  where: { holdId?: string; opportunityId?: string },
  actor: { id: string; name: string | null },
  clock: Clock,
  outbox: OutboxRow[],
  opts: { moveStageBack: boolean },
): ScheduleHoldView[] {
  const rows = where.holdId
    ? db.all<HoldSql>(`${HOLD_SELECT} WHERE h.tenant_id = ? AND h.id = ? AND h.status IN ('active', 'expired')`, tenantId, where.holdId)
    : db.all<HoldSql>(
        `${HOLD_SELECT} WHERE h.tenant_id = ? AND h.opportunity_id = ? AND h.status IN ('active', 'expired')`,
        tenantId,
        where.opportunityId ?? '',
      )
  const now = clock.nowMs()
  const out: ScheduleHoldView[] = []
  for (const row of rows) {
    db.run(
      `UPDATE schedule_holds
       SET status = 'cancelled', cancelled_at = ?, updated_at = ?,
           alert_dismissed_at = COALESCE(alert_dismissed_at, ?)
       WHERE tenant_id = ? AND id = ?`,
      now,
      now,
      now,
      tenantId,
      row.id,
    )
    if (opts.moveStageBack && row.opportunity_id) {
      moveStage(
        db,
        tenantId,
        row.opportunity_id,
        'em_atendimento',
        actor,
        'Bloco cancelado',
        clock,
        outbox,
        ['a_definir'],
      )
    }
    const next = requireHold(db, tenantId, row.id)
    outbox.push(holdEvent(db, tenantId, 'schedule_hold.cancelled', next, clock))
    out.push(next)
  }
  return out
}

export function cancelHoldOp(
  db: ClinicDb,
  caller: ClinicCaller,
  input: CancelHoldInput,
  clock: Clock,
): HoldMutationResult<ScheduleHoldView> {
  const { tenantId } = prepare(db, caller, clock)
  if (!input.actorClerkUserId) {
    throw new ValidationError('actor_required', 'Actor obrigatório para esta operação')
  }
  return db.transactionSync(() => {
    const hold = requireHold(db, tenantId, input.holdId)
    if (hold.status !== 'active' && hold.status !== 'expired') {
      throw new ConflictError('hold_not_active', 'Este bloco já não está activo.')
    }
    const outbox: OutboxRow[] = []
    const [next] = cancelActiveHoldsInTransaction(
      db,
      tenantId,
      { holdId: hold.id },
      { id: input.actorClerkUserId, name: input.actorDisplayName ?? null },
      clock,
      outbox,
      { moveStageBack: true },
    )
    writeOperationalAudit(
      db,
      {
        tenantId,
        actor: input.actorClerkUserId,
        action: 'schedule_hold.cancelled',
        objectType: 'schedule_hold',
        objectId: hold.id,
      },
      clock,
    )
    return { value: next ?? requireHold(db, tenantId, hold.id), outbox }
  })
}

/**
 * Vence blocos cujo período acabou sem hora. Idempotente; chamado pelo
 * alarme do DO e antes das leituras de blocos/avisos.
 */
export function sweepExpiredHoldsOp(
  db: ClinicDb,
  caller: ClinicCaller,
  clock: Clock,
): HoldMutationResult<ScheduleHoldView[]> {
  const { tenantId } = prepare(db, caller, clock)
  const nowMs = clock.nowMs()
  const due = db.all<{ id: string }>(
    `SELECT id FROM schedule_holds
     WHERE tenant_id = ? AND status = 'active' AND window_ends_at <= ?
     ORDER BY window_ends_at, id`,
    tenantId,
    nowMs,
  )
  if (due.length === 0) return { value: [], outbox: [] }
  return db.transactionSync(() => {
    const outbox: OutboxRow[] = []
    const expired: ScheduleHoldView[] = []
    for (const { id } of due) {
      const hold = requireHold(db, tenantId, id)
      if (hold.status !== 'active') continue
      db.run(
        `UPDATE schedule_holds SET status = 'expired', expired_at = ?, updated_at = ?
         WHERE tenant_id = ? AND id = ? AND status = 'active'`,
        nowMs,
        nowMs,
        tenantId,
        id,
      )
      if (hold.opportunityId) {
        // Volta a «A definir» (se a etapa mudou entretanto), excepto se já
        // está agendado ou fechado.
        moveStage(
          db,
          tenantId,
          hold.opportunityId,
          'a_definir',
          { id: 'system:schedule_holds', name: 'Sistema' },
          'Período do bloco passou sem hora definida',
          clock,
          outbox,
          ['novo_contato', 'em_atendimento', 'horario_proposto'],
        )
      }
      const next = requireHold(db, tenantId, id)
      outbox.push(holdEvent(db, tenantId, 'schedule_hold.expired', next, clock))
      expired.push(next)
    }
    return { value: expired, outbox }
  })
}

/** Próximo fim de período de bloco activo (para o alarme do DO). */
export function nextHoldExpiryAt(db: ClinicDb, tenantId: string): number | null {
  const row = db.get<{ t: number | null }>(
    `SELECT MIN(window_ends_at) AS t FROM schedule_holds WHERE tenant_id = ? AND status = 'active'`,
    tenantId,
  )
  return row?.t ?? null
}

export function listHoldsOp(
  db: ClinicDb,
  caller: ClinicCaller,
  input: ListHoldsInput,
  clock: Clock,
): ScheduleHoldView[] {
  const { tenantId } = prepare(db, caller, clock)
  const where: string[] = ['h.tenant_id = ?']
  const params: Array<string | number> = [tenantId]
  if (input.conversationId) {
    where.push('h.conversation_id = ?')
    params.push(input.conversationId)
  }
  if (input.professionalId && input.professionalId !== 'any') {
    where.push('h.professional_id = ?')
    params.push(input.professionalId)
  }
  if (input.rangeStartsAt != null && input.rangeEndsAt != null) {
    where.push('h.window_starts_at < ? AND h.window_ends_at > ?')
    params.push(input.rangeEndsAt, input.rangeStartsAt)
  }
  const statuses = (input.statuses ?? ['active']).filter((s) =>
    ['active', 'resolved', 'expired', 'cancelled'].includes(s),
  )
  if (statuses.length === 0) statuses.push('active')
  where.push(`h.status IN (${statuses.map(() => '?').join(', ')})`)
  params.push(...statuses)
  const rows = db.all<HoldSql>(
    `${HOLD_SELECT} WHERE ${where.join(' AND ')}
     ORDER BY h.window_starts_at, h.id LIMIT 200`,
    ...params,
  )
  return rows.map(mapHold)
}

/**
 * Avisos in-app: blocos activos que começam em < 48 h (ou já começaram) e
 * blocos vencidos sem hora ainda não dispensados. Devolve todos — a UI
 * destaca os da atendente responsável.
 */
export function listHoldAlertsOp(
  db: ClinicDb,
  caller: ClinicCaller,
  clock: Clock,
): HoldAlert[] {
  const { tenantId } = prepare(db, caller, clock)
  const nowMs = clock.nowMs()
  const rows = db.all<HoldSql>(
    `${HOLD_SELECT}
     WHERE h.tenant_id = ?
       AND (
         (h.status = 'active' AND h.window_starts_at < ?)
         OR (h.status = 'expired' AND h.alert_dismissed_at IS NULL)
       )
     ORDER BY h.window_starts_at, h.id LIMIT 200`,
    tenantId,
    nowMs + SCHEDULE_HOLD_ALERT_LEAD_MS,
  )
  return rows.map((r) => {
    const hold = mapHold(r)
    const kind: HoldAlert['kind'] =
      hold.status === 'expired' || hold.windowEndsAt <= nowMs ? 'expired' : 'starts_soon'
    return { kind, hold }
  })
}

export function dismissHoldAlertOp(
  db: ClinicDb,
  caller: ClinicCaller,
  input: { holdId: string; actorClerkUserId: string },
  clock: Clock,
): HoldMutationResult<ScheduleHoldView> {
  const { tenantId } = prepare(db, caller, clock)
  return db.transactionSync(() => {
    const hold = requireHold(db, tenantId, input.holdId)
    if (hold.status !== 'expired') {
      throw new ConflictError(
        'hold_alert_not_dismissable',
        'Só avisos de blocos vencidos podem ser dispensados — defina a hora ou cancele o bloco.',
      )
    }
    if (hold.alertDismissedAt != null) return { value: hold, outbox: [] }
    const now = clock.nowMs()
    db.run(
      `UPDATE schedule_holds SET alert_dismissed_at = ?, updated_at = ? WHERE tenant_id = ? AND id = ?`,
      now,
      now,
      tenantId,
      hold.id,
    )
    const next = requireHold(db, tenantId, hold.id)
    return {
      value: next,
      outbox: [holdEvent(db, tenantId, 'schedule_hold.alert_dismissed', next, clock)],
    }
  })
}
