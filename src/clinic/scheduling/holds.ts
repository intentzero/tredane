/**
 * Reserva por bloco (decisões do fundador, 27/10/2026).
 *
 * - A atendente define a duração caso a caso.
 * - O bloco ocupa só essa duração, na agenda de UMA profissional, algures
 *   dentro do período (manhã/tarde/outro). Novos agendamentos só são
 *   recusados se impedirem o bloco de caber (`hold_conflict`).
 * - A reserva TEM sempre hora (decisão de 27/10/2026, migração 17): na mesma
 *   transação cria o bloco, o compromisso confirmado — que ocupa a DURAÇÃO
 *   DO BLOCO, não a do serviço — e move o contato para «Agendado».
 * - A resposta do paciente é confirmada manualmente pela atendente.
 * - Mensagens WhatsApp NÃO saem daqui: o cliente usa o envio normal de texto,
 *   e só dentro da janela de 24 h.
 */
import type { Clock } from '../../db/clock'
import { writeOperationalAudit } from '../audit'
import { listWeeklyWindows } from '../config/availability'
import { getResource } from '../config/resources'
import { getService } from '../config/services'
import { ensureClinicSettings } from '../config/settings'
import { SCHEDULE_GRID_MINUTES } from '../constants'
import type { ClinicCaller } from '../envelopes'
import { assertValidCaller } from '../envelopes'
import { NotFoundError, ValidationError } from '../errors'
import { newId } from '../ids'
import { requireConversation } from '../inbox/conversations'
import { assertClinicSchemaReady } from '../migrations'
import { insertOutboxEvent, type OutboxRow } from '../outbox'
import { ensureOpenOpportunity } from '../pipeline/operations'
import type { ClinicDb } from '../store'
import { bindOrAssertTenant } from '../tenant'
import { moveStage } from './stage'
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
  /** Hora exacta (obrigatória) dentro do período. */
  startsAt: number
  roomResourceId?: string | null
  actorClerkUserId: string
  actorDisplayName?: string | null
}

export type CreateHoldResult = {
  hold: ScheduleHoldView
  appointment: AppointmentDetail
}

export type ListHoldsInput = {
  conversationId?: string | null
  professionalId?: string | null
  rangeStartsAt?: number | null
  rangeEndsAt?: number | null
  statuses?: string[] | null
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
): HoldMutationResult<CreateHoldResult> {
  const { tenantId, timezone } = prepare(db, caller, clock)
  const clientRequestId = (input.clientRequestId ?? '').trim()
  if (!clientRequestId || clientRequestId.length > 200) {
    throw new ValidationError('client_request_id_required', 'clientRequestId obrigatório')
  }
  if (!input.actorClerkUserId) {
    throw new ValidationError('actor_required', 'Actor obrigatório para esta operação')
  }
  const appointmentRequestId = `${clientRequestId}:apt`

  return db.transactionSync(() => {
    const prior = db.get<{ id: string }>(
      `SELECT id FROM schedule_holds WHERE tenant_id = ? AND client_request_id = ?`,
      tenantId,
      clientRequestId,
    )
    if (prior) {
      const hold = requireHold(db, tenantId, prior.id)
      const replay = confirmAppointmentInTransaction(
        db,
        caller,
        {
          clientRequestId: appointmentRequestId,
          serviceId: hold.serviceId,
          professionalId: hold.professionalId,
          roomResourceId: input.roomResourceId ?? null,
          startsAt: input.startsAt,
          actorClerkUserId: input.actorClerkUserId,
          excludeHoldId: hold.id,
          durationMinutesOverride: hold.durationMinutes,
        },
        clock,
      )
      return { value: { hold, appointment: replay.value }, outbox: [], idempotentReplay: true }
    }

    const nowMs = clock.nowMs()
    validateWindow(timezone, input, nowMs)
    if (!Number.isFinite(input.startsAt)) {
      throw new ValidationError('hold_start_required', 'Escolha um horário livre dentro do período.')
    }
    if (
      input.startsAt < input.windowStartsAt
      || input.startsAt + input.durationMinutes * 60_000 > input.windowEndsAt
    ) {
      throw new ValidationError(
        'hold_start_outside_window',
        'O horário tem de caber dentro do período escolhido.',
      )
    }
    const conv = requireConversation(db, tenantId, input.conversationId)
    const service = getService(db, tenantId, input.serviceId)
    if (!service || !service.active) {
      throw new NotFoundError('service_not_found', 'Procedimento não encontrado ou inactivo nesta clínica')
    }
    const pro = requireProfessional(db, tenantId, input.professionalId, clock)
    if (service.professionalIds.length > 0 && !service.professionalIds.includes(pro.id)) {
      throw new ValidationError('professional_not_linked', 'Essa profissional não faz este procedimento')
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

    const id = newId('hold')
    db.run(
      `INSERT INTO schedule_holds (
        id, tenant_id, client_request_id, opportunity_id, conversation_id,
        contact_id, service_id, professional_id, duration_minutes,
        window_starts_at, window_ends_at, confirm_by, status,
        responsible_clerk_user_id, responsible_display_name,
        created_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 'active', ?, ?, ?, ?, ?)`,
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
      responsibleId,
      responsibleName,
      input.actorClerkUserId,
      nowMs,
      nowMs,
    )

    // Compromisso confirmado com a duração do BLOCO (re-check dentro da TX;
    // conflito faz rollback de tudo — nada fica reservado).
    const confirmed = confirmAppointmentInTransaction(
      db,
      caller,
      {
        clientRequestId: appointmentRequestId,
        serviceId: service.id,
        professionalId: pro.id,
        roomResourceId: input.roomResourceId ?? null,
        startsAt: input.startsAt,
        contactId: conv.contactId,
        conversationId: conv.id,
        opportunityId: opp.id,
        actorClerkUserId: input.actorClerkUserId,
        excludeHoldId: id,
        durationMinutesOverride: input.durationMinutes,
        skipStageMove: true,
      },
      clock,
    )
    outbox.push(...confirmed.outbox)
    db.run(
      `UPDATE schedule_holds
       SET status = 'resolved', appointment_id = ?, resolved_at = ?, updated_at = ?
       WHERE tenant_id = ? AND id = ?`,
      confirmed.value.id,
      nowMs,
      nowMs,
      tenantId,
      id,
    )
    moveStage(
      db,
      tenantId,
      opp.id,
      'agendado',
      { id: input.actorClerkUserId, name: input.actorDisplayName ?? null },
      'Bloco reservado com hora',
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
          startsAt: input.startsAt,
          appointmentId: confirmed.value.id,
        },
      },
      clock,
    )
    return { value: { hold, appointment: confirmed.value }, outbox }
  })
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
