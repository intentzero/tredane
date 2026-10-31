import type { Clock } from '../db/clock'
import {
  clinicConfig,
  clinicScheduling,
  type ClinicCaller,
  type ClinicDb,
  workerCaller,
} from '../clinic'
import type {
  AbuseLimitsView,
  ConfigReadiness,
  ConfigSnapshot,
  CreateBlockInput,
  CreateBlockResult,
  ResourceRow,
  ServiceRow,
  ServiceComboInput,
  ServiceZoneInput,
  SetWeeklyWindowsInput,
  UpdateAbuseLimitsInput,
  UpsertResourceInput,
  UpsertServiceInput,
  WeeklyWindowRow,
  ClinicSettingsRow,
  ForecastPlaceInput,
  AppointmentRow,
  DeactivateResourceInput,
  DeactivateResourceResult,
  FutureAppointmentForResource,
} from '../clinic/config'
import type { AbuseLimits } from '../clinic/ai/abuse-limits'
import type {
  AllowBothSexesInput,
  AllowBothSexesResult,
} from '../clinic/scheduling'

/**
 * Gateway de configuração da clínica — abstrai DO vs SQLite em memória (testes HTTP).
 */
export type ClinicConfigGateway = {
  getSnapshot(caller: ClinicCaller): Promise<ConfigSnapshot>
  getReadiness(caller: ClinicCaller): Promise<ConfigReadiness>
  reviewServices(caller: ClinicCaller): Promise<clinicConfig.ServiceReviewResult>
  updateTimezone(caller: ClinicCaller, timezone: string): Promise<ClinicSettingsRow>
  setAiAssistEnabled(caller: ClinicCaller, enabled: boolean): Promise<ClinicSettingsRow>
  setAiProfile(
    caller: ClinicCaller,
    input: {
      clinicAddress?: string | null
      googleBusinessUrl?: string | null
      reschedulePolicy?: string | null
      virtualAttendantName?: string | null
      virtualAttendantGender?: 'masculino' | 'feminino' | '' | null
    },
  ): Promise<ClinicSettingsRow>
  setForecastPlace(caller: ClinicCaller, input: ForecastPlaceInput): Promise<ClinicSettingsRow>
  getAbuseLimits(caller: ClinicCaller, platform?: AbuseLimits): Promise<AbuseLimitsView>
  updateAbuseLimits(
    caller: ClinicCaller,
    input: UpdateAbuseLimitsInput,
    platform?: AbuseLimits,
  ): Promise<AbuseLimitsView>
  upsertService(caller: ClinicCaller, input: UpsertServiceInput): Promise<ServiceRow>
  replaceServiceZones(
    caller: ClinicCaller,
    serviceId: string,
    zones: ServiceZoneInput[],
  ): Promise<ServiceRow>
  replaceServiceCombos(
    caller: ClinicCaller,
    serviceId: string,
    combos: ServiceComboInput[],
  ): Promise<ServiceRow>
  setServiceActive(
    caller: ClinicCaller,
    serviceId: string,
    active: boolean,
  ): Promise<ServiceRow>
  deleteService(caller: ClinicCaller, serviceId: string): Promise<{ ok: true; id: string }>
  upsertResource(
    caller: ClinicCaller,
    input: UpsertResourceInput,
  ): Promise<ResourceRow & { servicesWithoutResource?: string[] }>
  setResourceActive(
    caller: ClinicCaller,
    resourceId: string,
    active: boolean,
  ): Promise<ResourceRow & { servicesWithoutResource?: string[] }>
  listResourceFutureAppointments(
    caller: ClinicCaller,
    resourceId: string,
  ): Promise<{ resource: ResourceRow; appointments: FutureAppointmentForResource[] }>
  deactivateResource(
    caller: ClinicCaller,
    input: DeactivateResourceInput,
  ): Promise<DeactivateResourceResult>
  deleteResource(caller: ClinicCaller, resourceId: string): Promise<{ ok: true; id: string }>
  setWeeklyWindows(
    caller: ClinicCaller,
    input: SetWeeklyWindowsInput,
  ): Promise<WeeklyWindowRow[]>
  createBlock(caller: ClinicCaller, input: CreateBlockInput): Promise<CreateBlockResult>
  deleteBlock(caller: ClinicCaller, blockId: string): Promise<{ ok: true }>
  /** DEC-075 / S5 — «Permitir os dois» no bloco (só responsável). */
  allowBothSexesInBlock(
    caller: ClinicCaller,
    input: AllowBothSexesInput,
  ): Promise<AllowBothSexesResult>
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
    async reviewServices(caller) {
      return clinicConfig.reviewClinicServicesOp(db, caller, clock)
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
    async setForecastPlace(caller, input) {
      return clinicConfig.setForecastPlaceOp(db, caller, input, clock)
    },
    async getAbuseLimits(caller, platform) {
      return clinicConfig.getAbuseLimitsOp(db, caller, clock, platform)
    },
    async updateAbuseLimits(caller, input, platform) {
      return clinicConfig.updateAbuseLimitsOp(db, caller, input, clock, platform)
    },
    async upsertService(caller, input) {
      return clinicConfig.upsertServiceOp(db, caller, input, clock)
    },
    async replaceServiceCombos(caller, serviceId, combos) {
      clinicConfig.replaceServiceCombosOp(db, caller, serviceId, combos, clock)
      const row = clinicConfig.getService(db, caller.tenantId, serviceId)
      if (!row) throw new Error('service_not_found')
      return row
    },
    async replaceServiceZones(caller, serviceId, zones) {
      clinicConfig.replaceServiceZonesOp(db, caller, serviceId, zones, clock)
      const row = clinicConfig.getService(db, caller.tenantId, serviceId)
      if (!row) throw new Error('service_not_found')
      return row
    },
    async setServiceActive(caller, serviceId, active) {
      return clinicConfig.setServiceActiveOp(db, caller, serviceId, active, clock)
    },
    async deleteService(caller, serviceId) {
      return clinicConfig.deleteServiceOp(db, caller, serviceId, clock)
    },
    async upsertResource(caller, input) {
      return clinicConfig.upsertResourceOp(db, caller, input, clock)
    },
    async setResourceActive(caller, resourceId, active) {
      return clinicConfig.setResourceActiveOp(db, caller, resourceId, active, clock)
    },
    async listResourceFutureAppointments(caller, resourceId) {
      return clinicConfig.listResourceFutureAppointmentsOp(db, caller, resourceId, clock)
    },
    async deactivateResource(caller, input) {
      return clinicConfig.deactivateResourceOp(db, caller, input, clock)
    },
    async deleteResource(caller, resourceId) {
      return clinicConfig.deleteResourceOp(db, caller, resourceId, clock)
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
    async allowBothSexesInBlock(caller, input) {
      return clinicScheduling.allowBothSexesInBlockOp(db, caller, input, clock)
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
