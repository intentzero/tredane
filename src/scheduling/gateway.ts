import type { Clock } from '../db/clock'
import {
  clinicConfig,
  clinicScheduling,
  type ClinicCaller,
  type ClinicDb,
  workerCaller,
} from '../clinic'
import type {
  AgendaViewInput,
  AgendaViewResult,
  AppointmentDetail,
  AppointmentMutationResult,
  AvailabilityQueryInput,
  AvailabilityQueryResult,
  CancelAppointmentInput,
  CheckSlotInput,
  CheckSlotResult,
  ConfirmAppointmentInput,
  RescheduleAppointmentInput,
  CreateHoldInput,
  CreateHoldResult,
  HoldPreviewInput,
  HoldPreviewResult,
  HoldMutationResult,
  ListHoldsInput,
  ScheduleHoldView,
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
  confirmAppointment(
    caller: ClinicCaller,
    input: ConfirmAppointmentInput,
  ): Promise<AppointmentMutationResult<AppointmentDetail>>
  cancelAppointment(
    caller: ClinicCaller,
    input: CancelAppointmentInput,
  ): Promise<AppointmentMutationResult<AppointmentDetail>>
  rescheduleAppointment(
    caller: ClinicCaller,
    input: RescheduleAppointmentInput,
  ): Promise<AppointmentMutationResult<AppointmentDetail>>
  getAppointment(
    caller: ClinicCaller,
    appointmentId: string,
  ): Promise<AppointmentDetail>
  queryAgenda(
    caller: ClinicCaller,
    input: AgendaViewInput,
  ): Promise<AgendaViewResult>
  previewHold(caller: ClinicCaller, input: HoldPreviewInput): Promise<HoldPreviewResult>
  createHold(
    caller: ClinicCaller,
    input: CreateHoldInput,
  ): Promise<HoldMutationResult<CreateHoldResult>>
  listHolds(caller: ClinicCaller, input: ListHoldsInput): Promise<ScheduleHoldView[]>
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
    async confirmAppointment(caller, input) {
      return clinicScheduling.confirmAppointmentOp(db, caller, input, clock)
    },
    async cancelAppointment(caller, input) {
      return clinicScheduling.cancelAppointmentOp(db, caller, input, clock)
    },
    async rescheduleAppointment(caller, input) {
      return clinicScheduling.rescheduleAppointmentOp(db, caller, input, clock)
    },
    async getAppointment(caller, appointmentId) {
      return clinicScheduling.getAppointmentDetailOp(
        db,
        caller,
        appointmentId,
        clock,
      )
    },
    async queryAgenda(caller, input) {
      return clinicScheduling.queryAgendaViewOp(db, caller, input, clock)
    },
    async previewHold(caller, input) {
      return clinicScheduling.previewHoldOp(db, caller, input, clock)
    },
    async createHold(caller, input) {
      return clinicScheduling.createHoldOp(db, caller, input, clock)
    },
    async listHolds(caller, input) {
      return clinicScheduling.listHoldsOp(db, caller, input, clock)
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
