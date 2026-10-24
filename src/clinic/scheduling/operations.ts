import type { Clock } from '../../db/clock'
import type { ClinicCaller } from '../envelopes'
import { assertValidCaller } from '../envelopes'
import { assertClinicSchemaReady } from '../migrations'
import type { ClinicDb } from '../store'
import { bindOrAssertTenant } from '../tenant'
import { ensureClinicSettings } from '../config/settings'
import { checkSlotAvailability } from './check'
import { queryAvailability } from './query'
import type {
  AvailabilityQueryInput,
  AvailabilityQueryResult,
  CheckSlotInput,
  CheckSlotResult,
} from './types'

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
