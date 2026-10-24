import type { Clock } from '../../db/clock'
import {
  DEFAULT_SIGNAL_DEADLINE_SECONDS,
  MAX_SIGNAL_DEADLINE_SECONDS,
  MIN_SIGNAL_DEADLINE_SECONDS,
} from '../../pix/money'
import { ValidationError } from '../errors'
import type { ClinicDb } from '../store'
import { ensureClinicSettings } from '../config/settings'
import type { PixSignalSettings, UpdateSignalSettingsInput } from './types'

export function getPixSignalSettings(
  db: ClinicDb,
  tenantId: string,
  clock: Clock,
): PixSignalSettings {
  ensureClinicSettings(db, tenantId, clock)
  const row = db.get<{
    tenant_id: string
    signal_deadline_seconds: number
    signal_cancellation_policy: string
    updated_at: number
  }>(
    `SELECT tenant_id, signal_deadline_seconds, signal_cancellation_policy, updated_at
     FROM clinic_settings WHERE id = 1 AND tenant_id = ?`,
    tenantId,
  )
  if (!row) {
    return {
      tenantId,
      deadlineSeconds: DEFAULT_SIGNAL_DEADLINE_SECONDS,
      cancellationPolicy: '',
      updatedAt: clock.nowMs(),
    }
  }
  return {
    tenantId: row.tenant_id,
    deadlineSeconds: row.signal_deadline_seconds ?? DEFAULT_SIGNAL_DEADLINE_SECONDS,
    cancellationPolicy: row.signal_cancellation_policy ?? '',
    updatedAt: row.updated_at,
  }
}

export function updatePixSignalSettings(
  db: ClinicDb,
  tenantId: string,
  input: UpdateSignalSettingsInput,
  clock: Clock,
): PixSignalSettings {
  ensureClinicSettings(db, tenantId, clock)
  const current = getPixSignalSettings(db, tenantId, clock)
  let deadline = current.deadlineSeconds
  let policy = current.cancellationPolicy

  if (input.deadlineSeconds !== undefined) {
    if (
      !Number.isInteger(input.deadlineSeconds)
      || input.deadlineSeconds < MIN_SIGNAL_DEADLINE_SECONDS
      || input.deadlineSeconds > MAX_SIGNAL_DEADLINE_SECONDS
    ) {
      throw new ValidationError(
        'invalid_signal_deadline',
        `prazo deve ser inteiro entre ${MIN_SIGNAL_DEADLINE_SECONDS} e ${MAX_SIGNAL_DEADLINE_SECONDS} segundos`,
        { deadlineSeconds: input.deadlineSeconds },
      )
    }
    deadline = input.deadlineSeconds
  }

  if (input.cancellationPolicy !== undefined) {
    policy = input.cancellationPolicy.trim().slice(0, 4000)
  }

  const now = clock.nowMs()
  db.run(
    `UPDATE clinic_settings
     SET signal_deadline_seconds = ?, signal_cancellation_policy = ?, updated_at = ?
     WHERE id = 1 AND tenant_id = ?`,
    deadline,
    policy,
    now,
    tenantId,
  )
  return {
    tenantId,
    deadlineSeconds: deadline,
    cancellationPolicy: policy,
    updatedAt: now,
  }
}
