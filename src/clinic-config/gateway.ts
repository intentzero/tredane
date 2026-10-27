import type { Clock } from '../db/clock'
import {
  clinicConfig,
  type ClinicCaller,
  type ClinicDb,
  workerCaller,
} from '../clinic'
import type {
  ConfigReadiness,
  ConfigSnapshot,
  CreateBlockInput,
  CreateBlockResult,
  ResourceRow,
  ServiceRow,
  SetWeeklyWindowsInput,
  UpsertResourceInput,
  UpsertServiceInput,
  WeeklyWindowRow,
  ClinicSettingsRow,
  AppointmentRow,
} from '../clinic/config'

/**
 * Gateway de configuração da clínica — abstrai DO vs SQLite em memória (testes HTTP).
 */
export type ClinicConfigGateway = {
  getSnapshot(caller: ClinicCaller): Promise<ConfigSnapshot>
  getReadiness(caller: ClinicCaller): Promise<ConfigReadiness>
  updateTimezone(caller: ClinicCaller, timezone: string): Promise<ClinicSettingsRow>
  setAiAssistEnabled(caller: ClinicCaller, enabled: boolean): Promise<ClinicSettingsRow>
  setAiProfile(
    caller: ClinicCaller,
    input: { clinicAddress?: string | null; reschedulePolicy?: string | null },
  ): Promise<ClinicSettingsRow>
  upsertService(caller: ClinicCaller, input: UpsertServiceInput): Promise<ServiceRow>
  setServiceActive(
    caller: ClinicCaller,
    serviceId: string,
    active: boolean,
  ): Promise<ServiceRow>
  upsertResource(
    caller: ClinicCaller,
    input: UpsertResourceInput,
  ): Promise<ResourceRow & { servicesWithoutResource?: string[] }>
  setResourceActive(
    caller: ClinicCaller,
    resourceId: string,
    active: boolean,
  ): Promise<ResourceRow & { servicesWithoutResource?: string[] }>
  setWeeklyWindows(
    caller: ClinicCaller,
    input: SetWeeklyWindowsInput,
  ): Promise<WeeklyWindowRow[]>
  createBlock(caller: ClinicCaller, input: CreateBlockInput): Promise<CreateBlockResult>
  deleteBlock(caller: ClinicCaller, blockId: string): Promise<{ ok: true }>
  /** Só testes / seeds. */
  insertAppointment?(
    caller: ClinicCaller,
    input: {
      serviceId: string
      professionalId: string
      roomResourceId?: string | null
      startsAt: number
      endsAt: number
      contactLabel?: string | null
    },
  ): Promise<AppointmentRow>
}

export function createMemoryClinicConfigGateway(
  db: ClinicDb,
  clock: Clock,
): ClinicConfigGateway {
  return {
    async getSnapshot(caller) {
      return clinicConfig.getConfigSnapshotOp(db, caller, clock)
    },
    async getReadiness(caller) {
      return clinicConfig.getReadinessOp(db, caller, clock)
    },
    async updateTimezone(caller, timezone) {
      return clinicConfig.updateTimezoneOp(db, caller, timezone, clock)
    },
    async setAiAssistEnabled(caller, enabled) {
      return clinicConfig.setAiAssistEnabledOp(db, caller, enabled, clock)
    },
    async setAiProfile(caller, input) {
      return clinicConfig.setAiProfileOp(db, caller, input, clock)
    },
    async upsertService(caller, input) {
      return clinicConfig.upsertServiceOp(db, caller, input, clock)
    },
    async setServiceActive(caller, serviceId, active) {
      return clinicConfig.setServiceActiveOp(db, caller, serviceId, active, clock)
    },
    async upsertResource(caller, input) {
      return clinicConfig.upsertResourceOp(db, caller, input, clock)
    },
    async setResourceActive(caller, resourceId, active) {
      return clinicConfig.setResourceActiveOp(db, caller, resourceId, active, clock)
    },
    async setWeeklyWindows(caller, input) {
      return clinicConfig.setWeeklyWindowsOp(db, caller, input, clock)
    },
    async createBlock(caller, input) {
      return clinicConfig.createBlockOp(db, caller, input, clock)
    },
    async deleteBlock(caller, blockId) {
      return clinicConfig.deleteBlockOp(db, caller, blockId, clock)
    },
    async insertAppointment(caller, input) {
      clinicConfig.getConfigSnapshotOp(db, caller, clock)
      return clinicConfig.insertSyntheticAppointment(db, caller.tenantId, input, clock)
    },
  }
}

/** Mapa tenantId → gateway em memória para testes multi-clínica. */
export function createMemoryClinicConfigRegistry(
  getDb: (tenantId: string) => { db: ClinicDb; clock: Clock },
): (tenantId: string) => ClinicConfigGateway {
  const cache = new Map<string, ClinicConfigGateway>()
  return (tenantId: string) => {
    let gw = cache.get(tenantId)
    if (!gw) {
      const { db, clock } = getDb(tenantId)
      // Garante vínculo do tenant na primeira criação.
      clinicConfig.getConfigSnapshotOp(db, workerCaller(tenantId), clock)
      gw = createMemoryClinicConfigGateway(db, clock)
      cache.set(tenantId, gw)
    }
    return gw
  }
}
