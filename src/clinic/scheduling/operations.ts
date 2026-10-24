import type { Clock } from '../../db/clock'
import type { ClinicCaller } from '../envelopes'
import { assertValidCaller } from '../envelopes'
import { assertClinicSchemaReady } from '../migrations'
import type { ClinicDb } from '../store'
import { bindOrAssertTenant } from '../tenant'
import { ensureClinicSettings } from '../config/settings'
import {
  cancelAppointmentOp,
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

export {
  confirmAppointmentOp,
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
