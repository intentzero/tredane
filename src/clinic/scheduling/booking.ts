/**
 * Confirmação / cancelamento / reagendamento atómicos (#36).
 * Uma transactionSync: valida recursos, grava compromisso + alocações +
 * histórico + outbox. Sem I/O externo na TX (REQ-033 / ADR-0005).
 */
import type { Clock } from '../../db/clock'
import {
  APPOINTMENT_CHANGE_REASONS,
  type AppointmentChangeReason,
} from '../constants'
import { toAppointment } from '../config/appointments'
import { getResource } from '../config/resources'
import { getService } from '../config/services'
import type { AppointmentRow } from '../config/types'
import { writeOperationalAudit } from '../audit'
import type { ClinicCaller } from '../envelopes'
import { assertValidCaller } from '../envelopes'
import { ConflictError, NotFoundError, ValidationError } from '../errors'
import { newId } from '../ids'
import { assertClinicSchemaReady } from '../migrations'
import { insertOutboxEvent, type OutboxRow } from '../outbox'
import type { ClinicDb } from '../store'
import { bindOrAssertTenant } from '../tenant'
import { deleteAllocationsForAppointment, insertAllocations } from './allocations'
import { checkSlotAvailability } from './check'
import { findAppointmentCommand, saveAppointmentCommand } from './commands'
import { insertAppointmentEvent, listAppointmentEvents } from './events'
import type {
  AppointmentDetail,
  AppointmentMutationResult,
  CancelAppointmentInput,
  ConfirmAppointmentInput,
  RescheduleAppointmentInput,
  SlotConflictDetails,
} from './booking-types'

type AptSql = {
  id: string
  tenant_id: string
  service_id: string
  professional_id: string
  room_resource_id: string | null
  starts_at: number
  ends_at: number
  status: string
  contact_label: string | null
  created_at: number
  contact_id: string | null
  conversation_id: string | null
  opportunity_id: string | null
  version: number
  updated_at: number | null
  confirmed_by: string | null
  confirmed_at: number | null
  change_reason: string | null
  cancelled_by: string | null
  cancelled_at: number | null
  occupies_until: number | null
}

function requireActor(caller: ClinicCaller, actorId: string): string {
  if (!caller.actorId && !actorId.trim()) {
    throw new ValidationError('actor_required', 'Actor obrigatório')
  }
  return actorId.trim() || caller.actorId!
}

function assertChangeReason(reason: string): AppointmentChangeReason {
  if (
    !(APPOINTMENT_CHANGE_REASONS as readonly string[]).includes(reason)
  ) {
    throw new ValidationError(
      'invalid_change_reason',
      'Motivo obrigatório da lista (REQ-032 / DEC-008)',
      { reason, allowed: [...APPOINTMENT_CHANGE_REASONS] },
    )
  }
  return reason as AppointmentChangeReason
}

function requireClientRequestId(id: string): string {
  const trimmed = id?.trim()
  if (!trimmed) {
    throw new ValidationError(
      'client_request_id_required',
      'clientRequestId obrigatório para idempotência',
    )
  }
  return trimmed
}

function loadAppointment(
  db: ClinicDb,
  tenantId: string,
  appointmentId: string,
): AppointmentRow {
  const row = db.get<AptSql>(
    `SELECT * FROM appointments WHERE tenant_id = ? AND id = ?`,
    tenantId,
    appointmentId,
  )
  if (!row) {
    throw new NotFoundError(
      'appointment_not_found',
      `compromisso ${appointmentId} não encontrado nesta clínica`,
    )
  }
  return toAppointment(row)
}

function snapshot(apt: AppointmentRow): Record<string, unknown> {
  return {
    id: apt.id,
    serviceId: apt.serviceId,
    professionalId: apt.professionalId,
    roomResourceId: apt.roomResourceId,
    startsAt: apt.startsAt,
    endsAt: apt.endsAt,
    occupiesUntil: apt.occupiesUntil,
    status: apt.status,
    version: apt.version,
    changeReason: apt.changeReason,
  }
}

function enrichDetail(
  db: ClinicDb,
  tenantId: string,
  apt: AppointmentRow,
  clock: Clock,
): AppointmentDetail {
  const svc = getService(db, tenantId, apt.serviceId)
  const pro = getResource(db, tenantId, apt.professionalId, clock)
  const room = apt.roomResourceId
    ? getResource(db, tenantId, apt.roomResourceId, clock)
    : null
  return {
    ...apt,
    serviceName: svc?.name ?? apt.serviceId,
    professionalName: pro?.name ?? apt.professionalId,
    roomResourceName: room?.name ?? null,
    events: listAppointmentEvents(db, tenantId, apt.id),
  }
}

function throwSlotConflict(
  details: SlotConflictDetails,
  message: string,
): never {
  throw new ConflictError('appointment_conflict', message, details)
}

function linkOpportunityIfPresent(
  db: ClinicDb,
  tenantId: string,
  appointmentId: string,
  opportunityId: string | null,
  contactId: string | null,
  conversationId: string | null,
  now: number,
  outbox: OutboxRow[],
  clock: Clock,
): void {
  if (!opportunityId) return
  const opp = db.get<{ id: string; contact_id: string; conversation_id: string | null }>(
    `SELECT id, contact_id, conversation_id FROM opportunities
     WHERE tenant_id = ? AND id = ?`,
    tenantId,
    opportunityId,
  )
  if (!opp) {
    throw new NotFoundError(
      'opportunity_not_found',
      `oportunidade ${opportunityId} não encontrada nesta clínica`,
    )
  }
  db.run(
    `UPDATE opportunities SET linked_appointment_id = ?, updated_at = ?
     WHERE tenant_id = ? AND id = ?`,
    appointmentId,
    now,
    tenantId,
    opportunityId,
  )
  // Garantir vínculos no compromisso alinhados à oportunidade.
  db.run(
    `UPDATE appointments
     SET opportunity_id = ?, contact_id = COALESCE(?, contact_id),
         conversation_id = COALESCE(?, conversation_id)
     WHERE tenant_id = ? AND id = ?`,
    opportunityId,
    contactId ?? opp.contact_id,
    conversationId ?? opp.conversation_id,
    tenantId,
    appointmentId,
  )
  outbox.push(
    insertOutboxEvent(
      db,
      {
        tenantId,
        type: 'opportunity.appointment_linked',
        aggregateType: 'opportunity',
        aggregateId: opportunityId,
        idempotencyKey: `opportunity.appointment_linked:${opportunityId}:${appointmentId}`,
        payload: {
          opportunityId,
          appointmentId,
          conversationId: conversationId ?? opp.conversation_id,
          contactId: contactId ?? opp.contact_id,
        },
      },
      clock,
    ),
  )
}

/**
 * Corpo de confirmação — assume TX já aberta (ex.: pagamento Pix #39).
 * Não chama `transactionSync` (Node SQLite não aninha BEGIN).
 */
export function confirmAppointmentInTransaction(
  db: ClinicDb,
  caller: ClinicCaller,
  input: ConfirmAppointmentInput,
  clock: Clock,
): AppointmentMutationResult<AppointmentDetail> {
  assertClinicSchemaReady(db)
  assertValidCaller(caller)
  const meta = bindOrAssertTenant(db, caller, clock)
  const clientRequestId = requireClientRequestId(input.clientRequestId)
  const actorId = requireActor(caller, input.actorClerkUserId)

  const existing = findAppointmentCommand(db, meta.tenantId, clientRequestId)
  if (existing) {
    if (existing.command !== 'confirm') {
      throw new ConflictError(
        'client_request_id_reuse',
        'clientRequestId já usado noutra operação',
      )
    }
    const apt = loadAppointment(db, meta.tenantId, existing.appointmentId)
    return {
      value: enrichDetail(db, meta.tenantId, apt, clock),
      outbox: [],
      idempotentReplay: true,
    }
  }

  // Re-check dentro da TX (ADR-0005) — SELECT+INSERT separados não bastam.
  const check = checkSlotAvailability(
    db,
    meta.tenantId,
    {
      serviceId: input.serviceId,
      professionalId: input.professionalId,
      roomResourceId: input.roomResourceId,
      startsAt: input.startsAt,
      excludeHoldId: input.excludeHoldId,
      durationMinutesOverride: input.durationMinutesOverride,
    },
    clock,
  )
  if (!check.available || !check.slot) {
    throwSlotConflict(
      {
        reasons: check.reasons,
        conflictingAppointmentIds: [],
      },
      'Esse horário acabou de ser ocupado. Nada foi reservado. Escolha outro horário.',
    )
  }

  const service = getService(db, meta.tenantId, input.serviceId)!
  const room = check.slot.roomResourceId
    ? getResource(db, meta.tenantId, check.slot.roomResourceId, clock)
    : null
  const now = clock.nowMs()
  const id = newId('apt')
  const endsAt = check.slot.endsAt
  const occupiesUntil = check.slot.occupiesUntil

  db.run(
    `INSERT INTO appointments (
      id, tenant_id, service_id, professional_id, room_resource_id,
      starts_at, ends_at, status, contact_label, created_at,
      contact_id, conversation_id, opportunity_id,
      version, updated_at, confirmed_by, confirmed_at, occupies_until
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'confirmed', ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`,
    id,
    meta.tenantId,
    input.serviceId,
    check.slot.professionalId,
    check.slot.roomResourceId,
    check.slot.startsAt,
    endsAt,
    input.contactLabel ?? null,
    now,
    input.contactId ?? null,
    input.conversationId ?? null,
    input.opportunityId ?? null,
    now,
    actorId,
    now,
    occupiesUntil,
  )

  insertAllocations(db, {
    tenantId: meta.tenantId,
    appointmentId: id,
    professionalId: check.slot.professionalId,
    roomResourceId: check.slot.roomResourceId,
    roomKind:
      room && (room.kind === 'room' || room.kind === 'equipment')
        ? room.kind
        : null,
    occupiedFrom: check.slot.startsAt,
    occupiedUntil: occupiesUntil,
  })

  const apt = loadAppointment(db, meta.tenantId, id)
  insertAppointmentEvent(db, {
    tenantId: meta.tenantId,
    appointmentId: id,
    operation: 'confirmed',
    actorId,
    previous: null,
    next: snapshot(apt),
    occurredAt: now,
  })

  const outbox: OutboxRow[] = []
  linkOpportunityIfPresent(
    db,
    meta.tenantId,
    id,
    input.opportunityId ?? null,
    input.contactId ?? null,
    input.conversationId ?? null,
    now,
    outbox,
    clock,
  )

  const confirmedOutbox = insertOutboxEvent(
    db,
    {
      tenantId: meta.tenantId,
      type: 'appointment.confirmed',
      aggregateType: 'appointment',
      aggregateId: id,
      idempotencyKey: `appointment.confirmed:${clientRequestId}`,
      payload: {
        appointmentId: id,
        serviceId: service.id,
        professionalId: apt.professionalId,
        roomResourceId: apt.roomResourceId,
        startsAt: apt.startsAt,
        endsAt: apt.endsAt,
        occupiesUntil,
        contactId: apt.contactId,
        conversationId: apt.conversationId,
        opportunityId: apt.opportunityId,
        actorClerkUserId: actorId,
        version: apt.version,
      },
    },
    clock,
  )
  outbox.push(confirmedOutbox)

  writeOperationalAudit(
    db,
    {
      tenantId: meta.tenantId,
      actor: actorId,
      action: 'appointment.confirmed',
      objectType: 'appointment',
      objectId: id,
      detail: {
        startsAt: apt.startsAt,
        professionalId: apt.professionalId,
        roomResourceId: apt.roomResourceId,
        occupiedMinutes: Math.round((occupiesUntil - apt.startsAt) / 60_000),
      },
    },
    clock,
  )

  const detail = enrichDetail(db, meta.tenantId, apt, clock)
  saveAppointmentCommand(db, {
    tenantId: meta.tenantId,
    clientRequestId,
    command: 'confirm',
    appointmentId: id,
    result: detail,
    createdAt: now,
  })

  return { value: detail, outbox, idempotentReplay: false }
}

/**
 * Confirma compromisso se recursos livres.
 * Idempotente por clientRequestId (clique/retry).
 */
export function confirmAppointmentOp(
  db: ClinicDb,
  caller: ClinicCaller,
  input: ConfirmAppointmentInput,
  clock: Clock,
): AppointmentMutationResult<AppointmentDetail> {
  assertClinicSchemaReady(db)
  assertValidCaller(caller)
  const meta = bindOrAssertTenant(db, caller, clock)
  const clientRequestId = requireClientRequestId(input.clientRequestId)

  const existing = findAppointmentCommand(db, meta.tenantId, clientRequestId)
  if (existing) {
    if (existing.command !== 'confirm') {
      throw new ConflictError(
        'client_request_id_reuse',
        'clientRequestId já usado noutra operação',
      )
    }
    const apt = loadAppointment(db, meta.tenantId, existing.appointmentId)
    return {
      value: enrichDetail(db, meta.tenantId, apt, clock),
      outbox: [],
      idempotentReplay: true,
    }
  }

  return db.transactionSync(() =>
    confirmAppointmentInTransaction(db, caller, input, clock),
  )
}

export function cancelAppointmentOp(
  db: ClinicDb,
  caller: ClinicCaller,
  input: CancelAppointmentInput,
  clock: Clock,
): AppointmentMutationResult<AppointmentDetail> {
  assertClinicSchemaReady(db)
  assertValidCaller(caller)
  const meta = bindOrAssertTenant(db, caller, clock)
  const clientRequestId = requireClientRequestId(input.clientRequestId)
  const actorId = requireActor(caller, input.actorClerkUserId)
  const reason = assertChangeReason(input.reason)

  const existing = findAppointmentCommand(db, meta.tenantId, clientRequestId)
  if (existing) {
    if (existing.command !== 'cancel') {
      throw new ConflictError(
        'client_request_id_reuse',
        'clientRequestId já usado noutra operação',
      )
    }
    const apt = loadAppointment(db, meta.tenantId, existing.appointmentId)
    return {
      value: enrichDetail(db, meta.tenantId, apt, clock),
      outbox: [],
      idempotentReplay: true,
    }
  }

  return db.transactionSync(() => {
    const before = loadAppointment(db, meta.tenantId, input.appointmentId)
    if (before.status !== 'confirmed') {
      throw new ConflictError(
        'appointment_not_confirmed',
        'Só é possível cancelar compromissos confirmados',
        { status: before.status, version: before.version },
      )
    }
    if (
      input.expectedVersion != null
      && input.expectedVersion !== before.version
    ) {
      throw new ConflictError(
        'appointment_version_conflict',
        'Este compromisso foi alterado por outra sessão. Recarregue o detalhe.',
        {
          expectedVersion: input.expectedVersion,
          currentVersion: before.version,
        },
      )
    }

    const now = clock.nowMs()
    db.run(
      `UPDATE appointments SET
        status = 'cancelled',
        change_reason = ?,
        cancelled_by = ?,
        cancelled_at = ?,
        updated_at = ?,
        version = version + 1
       WHERE tenant_id = ? AND id = ? AND status = 'confirmed'`,
      reason,
      actorId,
      now,
      now,
      meta.tenantId,
      before.id,
    )
    deleteAllocationsForAppointment(db, meta.tenantId, before.id)

    const after = loadAppointment(db, meta.tenantId, before.id)
    insertAppointmentEvent(db, {
      tenantId: meta.tenantId,
      appointmentId: before.id,
      operation: 'cancelled',
      actorId,
      reason,
      previous: snapshot(before),
      next: snapshot(after),
      occurredAt: now,
    })

    const outbox = [
      insertOutboxEvent(
        db,
        {
          tenantId: meta.tenantId,
          type: 'appointment.cancelled',
          aggregateType: 'appointment',
          aggregateId: before.id,
          idempotencyKey: `appointment.cancelled:${clientRequestId}`,
          payload: {
            appointmentId: before.id,
            reason,
            actorClerkUserId: actorId,
            previousStartsAt: before.startsAt,
            version: after.version,
            contactId: after.contactId,
            conversationId: after.conversationId,
            opportunityId: after.opportunityId,
          },
        },
        clock,
      ),
    ]

    writeOperationalAudit(
      db,
      {
        tenantId: meta.tenantId,
        actor: actorId,
        action: 'appointment.cancelled',
        objectType: 'appointment',
        objectId: before.id,
        detail: { reason, previousVersion: before.version },
      },
      clock,
    )

    const detail = enrichDetail(db, meta.tenantId, after, clock)
    saveAppointmentCommand(db, {
      tenantId: meta.tenantId,
      clientRequestId,
      command: 'cancel',
      appointmentId: before.id,
      result: detail,
      createdAt: now,
    })

    return { value: detail, outbox, idempotentReplay: false }
  })
}

/**
 * Reagenda atomicamente: mantém reserva anterior até sucesso do novo intervalo.
 * Conflito → rollback da TX; compromisso original intacto (AC-10).
 */
export function rescheduleAppointmentOp(
  db: ClinicDb,
  caller: ClinicCaller,
  input: RescheduleAppointmentInput,
  clock: Clock,
): AppointmentMutationResult<AppointmentDetail> {
  assertClinicSchemaReady(db)
  assertValidCaller(caller)
  const meta = bindOrAssertTenant(db, caller, clock)
  const clientRequestId = requireClientRequestId(input.clientRequestId)
  const actorId = requireActor(caller, input.actorClerkUserId)
  const reason = assertChangeReason(input.reason)

  const existing = findAppointmentCommand(db, meta.tenantId, clientRequestId)
  if (existing) {
    if (existing.command !== 'reschedule') {
      throw new ConflictError(
        'client_request_id_reuse',
        'clientRequestId já usado noutra operação',
      )
    }
    const apt = loadAppointment(db, meta.tenantId, existing.appointmentId)
    return {
      value: enrichDetail(db, meta.tenantId, apt, clock),
      outbox: [],
      idempotentReplay: true,
    }
  }

  return db.transactionSync(() => {
    const before = loadAppointment(db, meta.tenantId, input.appointmentId)
    if (before.status !== 'confirmed') {
      throw new ConflictError(
        'appointment_not_confirmed',
        'Só é possível reagendar compromissos confirmados',
        { status: before.status },
      )
    }
    if (
      input.expectedVersion != null
      && input.expectedVersion !== before.version
    ) {
      throw new ConflictError(
        'appointment_version_conflict',
        'Este compromisso foi alterado por outra sessão. Recarregue o detalhe.',
        {
          expectedVersion: input.expectedVersion,
          currentVersion: before.version,
          preservedAppointmentId: before.id,
          preservedStartsAt: before.startsAt,
          preservedEndsAt: before.endsAt,
        },
      )
    }

    const serviceId = input.serviceId ?? before.serviceId
    const check = checkSlotAvailability(
      db,
      meta.tenantId,
      {
        serviceId,
        professionalId: input.professionalId,
        roomResourceId: input.roomResourceId,
        startsAt: input.startsAt,
        excludeAppointmentId: before.id,
      },
      clock,
    )
    if (!check.available || !check.slot) {
      throwSlotConflict(
        {
          reasons: check.reasons,
          conflictingAppointmentIds: [],
          preservedAppointmentId: before.id,
          preservedStartsAt: before.startsAt,
          preservedEndsAt: before.endsAt,
        },
        `O compromisso anterior continua mantido (${new Date(before.startsAt).toISOString()}). Escolha outro horário.`,
      )
    }

    const room = check.slot.roomResourceId
      ? getResource(db, meta.tenantId, check.slot.roomResourceId, clock)
      : null
    const now = clock.nowMs()

    // Liberta alocações antigas e grava as novas na mesma TX.
    deleteAllocationsForAppointment(db, meta.tenantId, before.id)
    db.run(
      `UPDATE appointments SET
        service_id = ?,
        professional_id = ?,
        room_resource_id = ?,
        starts_at = ?,
        ends_at = ?,
        occupies_until = ?,
        change_reason = ?,
        updated_at = ?,
        version = version + 1
       WHERE tenant_id = ? AND id = ? AND status = 'confirmed'`,
      serviceId,
      check.slot.professionalId,
      check.slot.roomResourceId,
      check.slot.startsAt,
      check.slot.endsAt,
      check.slot.occupiesUntil,
      reason,
      now,
      meta.tenantId,
      before.id,
    )
    insertAllocations(db, {
      tenantId: meta.tenantId,
      appointmentId: before.id,
      professionalId: check.slot.professionalId,
      roomResourceId: check.slot.roomResourceId,
      roomKind:
        room && (room.kind === 'room' || room.kind === 'equipment')
          ? room.kind
          : null,
      occupiedFrom: check.slot.startsAt,
      occupiedUntil: check.slot.occupiesUntil,
    })

    const after = loadAppointment(db, meta.tenantId, before.id)
    insertAppointmentEvent(db, {
      tenantId: meta.tenantId,
      appointmentId: before.id,
      operation: 'rescheduled',
      actorId,
      reason,
      previous: snapshot(before),
      next: snapshot(after),
      occurredAt: now,
    })

    const outbox = [
      insertOutboxEvent(
        db,
        {
          tenantId: meta.tenantId,
          type: 'appointment.rescheduled',
          aggregateType: 'appointment',
          aggregateId: before.id,
          idempotencyKey: `appointment.rescheduled:${clientRequestId}`,
          payload: {
            appointmentId: before.id,
            reason,
            actorClerkUserId: actorId,
            previousStartsAt: before.startsAt,
            previousEndsAt: before.endsAt,
            startsAt: after.startsAt,
            endsAt: after.endsAt,
            occupiesUntil: after.occupiesUntil,
            professionalId: after.professionalId,
            roomResourceId: after.roomResourceId,
            version: after.version,
            contactId: after.contactId,
            conversationId: after.conversationId,
            opportunityId: after.opportunityId,
          },
        },
        clock,
      ),
    ]

    writeOperationalAudit(
      db,
      {
        tenantId: meta.tenantId,
        actor: actorId,
        action: 'appointment.rescheduled',
        objectType: 'appointment',
        objectId: before.id,
        detail: {
          reason,
          from: before.startsAt,
          to: after.startsAt,
        },
      },
      clock,
    )

    const detail = enrichDetail(db, meta.tenantId, after, clock)
    saveAppointmentCommand(db, {
      tenantId: meta.tenantId,
      clientRequestId,
      command: 'reschedule',
      appointmentId: before.id,
      result: detail,
      createdAt: now,
    })

    return { value: detail, outbox, idempotentReplay: false }
  })
}

export function getAppointmentDetailOp(
  db: ClinicDb,
  caller: ClinicCaller,
  appointmentId: string,
  clock: Clock,
): AppointmentDetail {
  assertClinicSchemaReady(db)
  assertValidCaller(caller)
  const meta = bindOrAssertTenant(db, caller, clock)
  const apt = loadAppointment(db, meta.tenantId, appointmentId)
  return enrichDetail(db, meta.tenantId, apt, clock)
}
