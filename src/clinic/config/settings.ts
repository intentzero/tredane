import { DEFAULT_CLINIC_TIMEZONE } from '../constants'
import type { Clock } from '../../db/clock'
import type { ClinicDb } from '../store'
import type { ClinicSettingsRow } from './types'
import { normalizeTimezone } from './validation'

export function ensureClinicSettings(
  db: ClinicDb,
  tenantId: string,
  clock: Clock,
): ClinicSettingsRow {
  const existing = db.get<{
    tenant_id: string
    timezone: string
    updated_at: number
  }>('SELECT tenant_id, timezone, updated_at FROM clinic_settings WHERE id = 1')
  if (existing) {
    if (existing.tenant_id !== tenantId) {
      // Meta já vinculou o tenant; settings deve coincidir.
      throw new Error(`clinic_settings tenant mismatch: ${existing.tenant_id}`)
    }
    return {
      tenantId: existing.tenant_id,
      timezone: existing.timezone,
      updatedAt: existing.updated_at,
    }
  }
  const now = clock.nowMs()
  db.run(
    `INSERT INTO clinic_settings (id, tenant_id, timezone, updated_at)
     VALUES (1, ?, ?, ?)`,
    tenantId,
    DEFAULT_CLINIC_TIMEZONE,
    now,
  )
  return {
    tenantId,
    timezone: DEFAULT_CLINIC_TIMEZONE,
    updatedAt: now,
  }
}

export function updateClinicTimezone(
  db: ClinicDb,
  tenantId: string,
  timezone: string,
  clock: Clock,
): ClinicSettingsRow {
  ensureClinicSettings(db, tenantId, clock)
  const tz = normalizeTimezone(timezone)
  const now = clock.nowMs()
  db.run(
    `UPDATE clinic_settings SET timezone = ?, updated_at = ? WHERE id = 1 AND tenant_id = ?`,
    tz,
    now,
    tenantId,
  )
  return { tenantId, timezone: tz, updatedAt: now }
}
