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
  ai_assist_enabled?: number
  clinic_address?: string
  reschedule_policy?: string
  updated_at: number
}

function mapSettings(row: SettingsSql): ClinicSettingsRow {
  return {
    tenantId: row.tenant_id,
    timezone: row.timezone,
    signalDeadlineSeconds:
      row.signal_deadline_seconds ?? DEFAULT_SIGNAL_DEADLINE_SECONDS,
    signalCancellationPolicy: row.signal_cancellation_policy ?? '',
    aiAssistEnabled: row.ai_assist_enabled === 1,
    clinicAddress: row.clinic_address ?? '',
    reschedulePolicy: row.reschedule_policy ?? '',
    updatedAt: row.updated_at,
  }
}

export function ensureClinicSettings(
  db: ClinicDb,
  tenantId: string,
  clock: Clock,
): ClinicSettingsRow {
  const existing = db.get<SettingsSql>(
    `SELECT tenant_id, timezone, signal_deadline_seconds, signal_cancellation_policy, ai_assist_enabled,
       clinic_address, reschedule_policy, updated_at
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
    aiAssistEnabled: false,
    clinicAddress: '',
    reschedulePolicy: '',
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

/** Liga/desliga a IA assistiva da clínica (só o responsável; ver rota). */
export function setClinicAiAssistEnabled(
  db: ClinicDb,
  tenantId: string,
  enabled: boolean,
  clock: Clock,
): ClinicSettingsRow {
  ensureClinicSettings(db, tenantId, clock)
  db.run(
    `UPDATE clinic_settings SET ai_assist_enabled = ?, updated_at = ? WHERE id = 1 AND tenant_id = ?`,
    enabled ? 1 : 0,
    clock.nowMs(),
    tenantId,
  )
  return ensureClinicSettings(db, tenantId, clock)
}

/** Lido no servidor antes de qualquer chamada ao modelo. Sem linha = desligado. */
export function isClinicAiAssistEnabled(db: ClinicDb, tenantId: string): boolean {
  const row = db.get<{ ai_assist_enabled: number }>(
    `SELECT ai_assist_enabled FROM clinic_settings WHERE id = 1 AND tenant_id = ?`,
    tenantId,
  )
  return row?.ai_assist_enabled === 1
}

/** Endereço e regras de remarcação/cancelamento usados no contexto da IA (só o responsável). */
export function setClinicAiProfile(
  db: ClinicDb,
  tenantId: string,
  input: { clinicAddress?: string | null; reschedulePolicy?: string | null },
  clock: Clock,
): ClinicSettingsRow {
  const cur = ensureClinicSettings(db, tenantId, clock)
  const address =
    input.clinicAddress == null ? cur.clinicAddress : input.clinicAddress.trim().slice(0, 300)
  const policy =
    input.reschedulePolicy == null
      ? cur.reschedulePolicy
      : input.reschedulePolicy.trim().slice(0, 1000)
  db.run(
    `UPDATE clinic_settings SET clinic_address = ?, reschedule_policy = ?, updated_at = ?
     WHERE id = 1 AND tenant_id = ?`,
    address,
    policy,
    clock.nowMs(),
    tenantId,
  )
  return ensureClinicSettings(db, tenantId, clock)
}
