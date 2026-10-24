import { DEFAULT_CLINIC_TIMEZONE } from '../constants'
import { DEFAULT_SIGNAL_DEADLINE_SECONDS } from '../../pix/money'
import type { Clock } from '../../db/clock'
import type { ClinicDb } from '../store'
import type { ClinicSettingsRow } from './types'
import { normalizeTimezone } from './validation'

type SettingsSql = {
  tenant_id: string
  timezone: string
  signal_deadline_seconds?: number
  signal_cancellation_policy?: string
  updated_at: number
}

function mapSettings(row: SettingsSql): ClinicSettingsRow {
  return {
    tenantId: row.tenant_id,
    timezone: row.timezone,
    signalDeadlineSeconds:
      row.signal_deadline_seconds ?? DEFAULT_SIGNAL_DEADLINE_SECONDS,
    signalCancellationPolicy: row.signal_cancellation_policy ?? '',
    updatedAt: row.updated_at,
  }
}

export function ensureClinicSettings(
  db: ClinicDb,
  tenantId: string,
  clock: Clock,
): ClinicSettingsRow {
  const existing = db.get<SettingsSql>(
    `SELECT tenant_id, timezone, signal_deadline_seconds, signal_cancellation_policy, updated_at
     FROM clinic_settings WHERE id = 1`,
  )
  if (existing) {
    if (existing.tenant_id !== tenantId) {
      // Meta já vinculou o tenant; settings deve coincidir.
      throw new Error(`clinic_settings tenant mismatch: ${existing.tenant_id}`)
    }
    return mapSettings(existing)
  }
  const now = clock.nowMs()
  db.run(
    `INSERT INTO clinic_settings (
      id, tenant_id, timezone, signal_deadline_seconds, signal_cancellation_policy, updated_at
    ) VALUES (1, ?, ?, ?, '', ?)`,
    tenantId,
    DEFAULT_CLINIC_TIMEZONE,
    DEFAULT_SIGNAL_DEADLINE_SECONDS,
    now,
  )
  return {
    tenantId,
    timezone: DEFAULT_CLINIC_TIMEZONE,
    signalDeadlineSeconds: DEFAULT_SIGNAL_DEADLINE_SECONDS,
    signalCancellationPolicy: '',
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
  return ensureClinicSettings(db, tenantId, clock)
}
