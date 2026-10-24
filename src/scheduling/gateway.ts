import type { Clock } from '../db/clock'
import {
  clinicConfig,
  clinicScheduling,
  type ClinicCaller,
  type ClinicDb,
  workerCaller,
} from '../clinic'
import type {
  AvailabilityQueryInput,
  AvailabilityQueryResult,
  CheckSlotInput,
  CheckSlotResult,
} from '../clinic/scheduling'

export type SchedulingGateway = {
  queryAvailability(
    caller: ClinicCaller,
    input: AvailabilityQueryInput,
  ): Promise<AvailabilityQueryResult>
  checkSlot(
    caller: ClinicCaller,
    input: CheckSlotInput,
  ): Promise<CheckSlotResult>
}

export function createMemorySchedulingGateway(
  db: ClinicDb,
  clock: Clock,
): SchedulingGateway {
  return {
    async queryAvailability(caller, input) {
      return clinicScheduling.queryAvailabilityOp(db, caller, input, clock)
    },
    async checkSlot(caller, input) {
      return clinicScheduling.checkSlotAvailabilityOp(db, caller, input, clock)
    },
  }
}

/** Mapa tenantId → gateway em memória para testes multi-clínica. */
export function createMemorySchedulingRegistry(
  getDb: (tenantId: string) => { db: ClinicDb; clock: Clock },
): (tenantId: string) => SchedulingGateway {
  const cache = new Map<string, SchedulingGateway>()
  return (tenantId: string) => {
    let gw = cache.get(tenantId)
    if (!gw) {
      const { db, clock } = getDb(tenantId)
      clinicConfig.getConfigSnapshotOp(db, workerCaller(tenantId), clock)
      gw = createMemorySchedulingGateway(db, clock)
      cache.set(tenantId, gw)
    }
    return gw
  }
}
