import type { Clock } from '../../db/clock'
import type { ClinicDb } from '../store'
import { listBlocks } from './blocks'
import { computeConfigReadiness } from './readiness'
import { listResources } from './resources'
import { listServices } from './services'
import { ensureClinicSettings } from './settings'
import { listWeeklyWindows } from './availability'
import type { ConfigSnapshot } from './types'

export function loadConfigSnapshot(
  db: ClinicDb,
  tenantId: string,
  clock: Clock,
): ConfigSnapshot {
  const settings = ensureClinicSettings(db, tenantId, clock)
  return {
    settings,
    services: listServices(db, tenantId),
    resources: listResources(db, tenantId, clock),
    weeklyWindows: listWeeklyWindows(db, tenantId),
    blocks: listBlocks(db, tenantId),
    readiness: computeConfigReadiness(db, tenantId, clock),
  }
}
