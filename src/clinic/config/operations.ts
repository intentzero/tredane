import type { Clock } from '../../db/clock'
import { writeOperationalAudit } from '../audit'
import type { ClinicCaller } from '../envelopes'
import { assertValidCaller } from '../envelopes'
import { assertClinicSchemaReady } from '../migrations'
import type { ClinicDb } from '../store'
import { bindOrAssertTenant } from '../tenant'
import { createResourceBlock, deleteResourceBlock } from './blocks'
import { computeConfigReadiness } from './readiness'
import {
  getResource,
  setResourceActive,
  upsertResource,
  servicesLeftWithoutCategoryResource,
} from './resources'
import { deleteService, setServiceActive, upsertService } from './services'
import { listOverCapacitySlots } from '../scheduling/occupancy'
import {
  ensureClinicSettings,
  setClinicAiAssistEnabled,
  setClinicAiProfile,
  updateClinicTimezone,
} from './settings'
import { setWeeklyWindows } from './availability'
import { loadConfigSnapshot } from './snapshot'
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
} from './types'

function prepare(db: ClinicDb, caller: ClinicCaller, clock: Clock) {
  assertClinicSchemaReady(db)
  assertValidCaller(caller)
  const meta = bindOrAssertTenant(db, caller, clock)
  ensureClinicSettings(db, meta.tenantId, clock)
  return meta
}

export function getConfigSnapshotOp(
  db: ClinicDb,
  caller: ClinicCaller,
  clock: Clock,
): ConfigSnapshot {
  const meta = prepare(db, caller, clock)
  return loadConfigSnapshot(db, meta.tenantId, clock)
}

export function getReadinessOp(
  db: ClinicDb,
  caller: ClinicCaller,
  clock: Clock,
): ConfigReadiness {
  const meta = prepare(db, caller, clock)
  return computeConfigReadiness(db, meta.tenantId, clock)
}

export function updateTimezoneOp(
  db: ClinicDb,
  caller: ClinicCaller,
  timezone: string,
  clock: Clock,
) {
  const meta = prepare(db, caller, clock)
  return db.transactionSync(() => {
    const settings = updateClinicTimezone(db, meta.tenantId, timezone, clock)
    writeOperationalAudit(
      db,
      {
        tenantId: meta.tenantId,
        actor: caller.actorId ?? caller.kind,
        action: 'config.timezone_updated',
        objectType: 'clinic_settings',
        objectId: '1',
        detail: { timezone: settings.timezone },
      },
      clock,
    )
    return settings
  })
}

export function upsertServiceOp(
  db: ClinicDb,
  caller: ClinicCaller,
  input: UpsertServiceInput,
  clock: Clock,
): ServiceRow {
  const meta = prepare(db, caller, clock)
  return db.transactionSync(() => {
    const row = upsertService(db, meta.tenantId, input, clock)
    writeOperationalAudit(
      db,
      {
        tenantId: meta.tenantId,
        actor: caller.actorId ?? caller.kind,
        action: input.id ? 'config.service_updated' : 'config.service_created',
        objectType: 'service',
        objectId: row.id,
        detail: { name: row.name, active: row.active },
      },
      clock,
    )
    return row
  })
}

export function deleteServiceOp(
  db: ClinicDb,
  caller: ClinicCaller,
  serviceId: string,
  clock: Clock,
): { ok: true; id: string } {
  const meta = prepare(db, caller, clock)
  return db.transactionSync(() => {
    const row = deleteService(db, meta.tenantId, serviceId)
    writeOperationalAudit(
      db,
      {
        tenantId: meta.tenantId,
        actor: caller.actorId ?? caller.kind,
        action: 'config.service_deleted',
        objectType: 'service',
        objectId: row.id,
        detail: { name: row.name },
      },
      clock,
    )
    return { ok: true as const, id: row.id }
  })
}

export function setServiceActiveOp(
  db: ClinicDb,
  caller: ClinicCaller,
  serviceId: string,
  active: boolean,
  clock: Clock,
): ServiceRow {
  const meta = prepare(db, caller, clock)
  return db.transactionSync(() => {
    const row = setServiceActive(db, meta.tenantId, serviceId, active, clock)
    writeOperationalAudit(
      db,
      {
        tenantId: meta.tenantId,
        actor: caller.actorId ?? caller.kind,
        action: active ? 'config.service_activated' : 'config.service_deactivated',
        objectType: 'service',
        objectId: row.id,
        detail: { active: row.active },
      },
      clock,
    )
    return row
  })
}

export function upsertResourceOp(
  db: ClinicDb,
  caller: ClinicCaller,
  input: UpsertResourceInput,
  clock: Clock,
): ResourceRow & {
  servicesWithoutResource?: string[]
  overCapacity?: Array<{ startsAt: number; endsAt: number; count: number }>
} {
  const meta = prepare(db, caller, clock)
  return db.transactionSync(() => {
    const before = input.id ? getResource(db, meta.tenantId, input.id, clock) : null
    const row = upsertResource(db, meta.tenantId, input, clock)
    // Card t1892s7600 (Q7): reduzir a capacidade abaixo do já marcado é
    // permitido; nada é apagado e a resposta lista os horários acima do limite.
    let overCapacity: Array<{ startsAt: number; endsAt: number; count: number }> | undefined
    if (before && row.kind === 'room' && row.capacity < before.capacity) {
      overCapacity = listOverCapacitySlots(db, meta.tenantId, row.id, row.capacity, clock.nowMs())
    }
    let servicesWithoutResource: string[] | undefined
    if (row.active === false && row.category) {
      servicesWithoutResource = servicesLeftWithoutCategoryResource(
        db,
        meta.tenantId,
        row.category,
        row.id,
      )
    }
    writeOperationalAudit(
      db,
      {
        tenantId: meta.tenantId,
        actor: caller.actorId ?? caller.kind,
        action: input.id ? 'config.resource_updated' : 'config.resource_created',
        objectType: 'resource',
        objectId: row.id,
        detail: {
          kind: row.kind,
          name: row.name,
          active: row.active,
          futureAppointmentCount: row.futureAppointmentCount,
          servicesWithoutResource,
          capacity: row.capacity,
          overCapacityCount: overCapacity?.length,
        },
      },
      clock,
    )
    return { ...row, servicesWithoutResource, overCapacity }
  })
}

export function setResourceActiveOp(
  db: ClinicDb,
  caller: ClinicCaller,
  resourceId: string,
  active: boolean,
  clock: Clock,
): ResourceRow & { servicesWithoutResource?: string[] } {
  const meta = prepare(db, caller, clock)
  return db.transactionSync(() => {
    const row = setResourceActive(db, meta.tenantId, resourceId, active, clock)
    let servicesWithoutResource: string[] | undefined
    if (!active && row.category) {
      servicesWithoutResource = servicesLeftWithoutCategoryResource(
        db,
        meta.tenantId,
        row.category,
        row.id,
      )
    }
    writeOperationalAudit(
      db,
      {
        tenantId: meta.tenantId,
        actor: caller.actorId ?? caller.kind,
        action: active ? 'config.resource_activated' : 'config.resource_deactivated',
        objectType: 'resource',
        objectId: row.id,
        detail: {
          active: row.active,
          futureAppointmentCount: row.futureAppointmentCount,
          servicesWithoutResource,
        },
      },
      clock,
    )
    return { ...row, servicesWithoutResource }
  })
}

export function setWeeklyWindowsOp(
  db: ClinicDb,
  caller: ClinicCaller,
  input: SetWeeklyWindowsInput,
  clock: Clock,
): WeeklyWindowRow[] {
  const meta = prepare(db, caller, clock)
  return db.transactionSync(() => {
    const windows = setWeeklyWindows(db, meta.tenantId, input, clock)
    writeOperationalAudit(
      db,
      {
        tenantId: meta.tenantId,
        actor: caller.actorId ?? caller.kind,
        action: 'config.weekly_updated',
        objectType: 'resource',
        objectId: input.resourceId,
        detail: { windowCount: windows.length },
      },
      clock,
    )
    return windows
  })
}

export function createBlockOp(
  db: ClinicDb,
  caller: ClinicCaller,
  input: CreateBlockInput,
  clock: Clock,
): CreateBlockResult {
  const meta = prepare(db, caller, clock)
  return db.transactionSync(() => {
    const result = createResourceBlock(db, meta.tenantId, input, clock)
    if (result.created && result.block) {
      writeOperationalAudit(
        db,
        {
          tenantId: meta.tenantId,
          actor: caller.actorId ?? caller.kind,
          action: 'config.block_created',
          objectType: 'resource_block',
          objectId: result.block.id,
          detail: {
            resourceId: result.block.resourceId,
            affectedCount: result.affectedAppointments.length,
            reason: result.block.reason,
          },
        },
        clock,
      )
    }
    return result
  })
}

export function deleteBlockOp(
  db: ClinicDb,
  caller: ClinicCaller,
  blockId: string,
  clock: Clock,
): { ok: true } {
  const meta = prepare(db, caller, clock)
  return db.transactionSync(() => {
    deleteResourceBlock(db, meta.tenantId, blockId)
    writeOperationalAudit(
      db,
      {
        tenantId: meta.tenantId,
        actor: caller.actorId ?? caller.kind,
        action: 'config.block_deleted',
        objectType: 'resource_block',
        objectId: blockId,
        detail: {},
      },
      clock,
    )
    return { ok: true as const }
  })
}

export function setAiAssistEnabledOp(
  db: ClinicDb,
  caller: ClinicCaller,
  enabled: boolean,
  clock: Clock,
) {
  const meta = prepare(db, caller, clock)
  return db.transactionSync(() => {
    const settings = setClinicAiAssistEnabled(db, meta.tenantId, enabled, clock)
    writeOperationalAudit(
      db,
      {
        tenantId: meta.tenantId,
        actor: caller.actorId ?? caller.kind,
        action: enabled ? 'config.ai_assist_enabled' : 'config.ai_assist_disabled',
        objectType: 'clinic_settings',
        objectId: '1',
        detail: { aiAssistEnabled: settings.aiAssistEnabled },
      },
      clock,
    )
    return settings
  })
}

export function setAiProfileOp(
  db: ClinicDb,
  caller: ClinicCaller,
  input: { clinicAddress?: string | null; reschedulePolicy?: string | null },
  clock: Clock,
) {
  const meta = prepare(db, caller, clock)
  return db.transactionSync(() => {
    const settings = setClinicAiProfile(db, meta.tenantId, input, clock)
    writeOperationalAudit(
      db,
      {
        tenantId: meta.tenantId,
        actor: caller.actorId ?? caller.kind,
        action: 'config.ai_profile_updated',
        objectType: 'clinic_settings',
        objectId: '1',
        detail: {},
      },
      clock,
    )
    return settings
  })
}
