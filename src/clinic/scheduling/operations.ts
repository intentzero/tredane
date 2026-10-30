import type { Clock } from '../../db/clock'
import type { ClinicCaller } from '../envelopes'
import { assertValidCaller } from '../envelopes'
import { assertClinicSchemaReady } from '../migrations'
import type { ClinicDb } from '../store'
import { bindOrAssertTenant } from '../tenant'
import { ensureClinicSettings } from '../config/settings'
import {
  cancelAppointmentOp,
  confirmAppointmentInTransaction,
  confirmAppointmentOp,
  getAppointmentDetailOp,
  rescheduleAppointmentOp,
} from './booking'
import type {
  AgendaViewInput,
  AgendaViewResult,
  AppointmentDetail,
  AppointmentMutationResult,
  CancelAppointmentInput,
  ConfirmAppointmentInput,
  RescheduleAppointmentInput,
} from './booking-types'
import { checkSlotAvailability } from './check'
import { queryAvailability } from './query'
import {
  allowBothSexesInBlock,
  type AllowBothSexesResult,
} from './sex-block'
import type {
  AvailabilityQueryInput,
  AvailabilityQueryResult,
  CheckSlotInput,
  CheckSlotResult,
} from './types'
import { queryAgendaViewOp } from './views'

function prepare(db: ClinicDb, caller: ClinicCaller, clock: Clock) {
  assertClinicSchemaReady(db)
  assertValidCaller(caller)
  const meta = bindOrAssertTenant(db, caller, clock)
  ensureClinicSettings(db, meta.tenantId, clock)
  return meta
}

export function queryAvailabilityOp(
  db: ClinicDb,
  caller: ClinicCaller,
  input: AvailabilityQueryInput,
  clock: Clock,
): AvailabilityQueryResult {
  const meta = prepare(db, caller, clock)
  return queryAvailability(db, meta.tenantId, input, clock)
}

export function checkSlotAvailabilityOp(
  db: ClinicDb,
  caller: ClinicCaller,
  input: CheckSlotInput,
  clock: Clock,
): CheckSlotResult {
  const meta = prepare(db, caller, clock)
  return checkSlotAvailability(db, meta.tenantId, input, clock)
}

export type AllowBothSexesInput = {
  roomResourceId: string
  startsAt: number
  endsAt?: number
}

/** «Permitir os dois» — HTTP exige clinic.config.write; aqui valida o ator. */
export function allowBothSexesInBlockOp(
  db: ClinicDb,
  caller: ClinicCaller,
  input: AllowBothSexesInput,
  clock: Clock,
): AllowBothSexesResult {
  const meta = prepare(db, caller, clock)
  return db.transactionSync(() =>
    allowBothSexesInBlock(
      db,
      meta.tenantId,
      {
        roomResourceId: input.roomResourceId,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        actorClerkUserId: caller.actorId ?? '',
      },
      clock,
    ),
  )
}

export {
  confirmAppointmentOp,
  confirmAppointmentInTransaction,
  cancelAppointmentOp,
  rescheduleAppointmentOp,
  getAppointmentDetailOp,
  queryAgendaViewOp,
}

export type {
  AgendaViewInput,
  AgendaViewResult,
  AppointmentDetail,
  AppointmentMutationResult,
  CancelAppointmentInput,
  ConfirmAppointmentInput,
  RescheduleAppointmentInput,
}
