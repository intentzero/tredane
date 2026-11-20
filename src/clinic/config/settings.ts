import { DEFAULT_BOOKING_LEAD_MINUTES, DEFAULT_CLINIC_TIMEZONE } from '../constants'
import { DEFAULT_SIGNAL_DEADLINE_SECONDS } from '../../pix/money'
import { DEFAULT_ABUSE_LIMIT_NUMBERS } from '../ai/abuse-limits'
import type { Clock } from '../../db/clock'
import type { ClinicDb } from '../store'
import type { ClinicSettingsRow } from './types'
import { normalizeTimezone } from './validation'
import { checkGoogleBusinessUrl } from './google-business-link'
import { ValidationError } from '../errors'
import {
  analyzeGeneralPolicyConflict,
  formatPolicyConflictMessage,
} from '../ai/policy-conflict'

type SettingsSql = {
  tenant_id: string
  timezone: string
  signal_deadline_seconds?: number
  signal_cancellation_policy?: string
  ai_assist_enabled?: number
  google_business_url?: string
  reschedule_policy?: string
  abuse_limits_enabled?: number
  auto_book_paused?: number
  abuse_window_hours?: number
  abuse_auto_drafts_per_contact?: number
  abuse_future_appointments_per_contact?: number
  abuse_pending_pix_per_contact?: number
  abuse_pending_proposals_per_contact?: number
  abuse_proposals_per_contact?: number
  abuse_proposals_per_clinic?: number
  booking_lead_minutes?: number
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
    googleBusinessUrl: row.google_business_url ?? '',
    reschedulePolicy: row.reschedule_policy ?? '',
    abuseLimitsEnabled: row.abuse_limits_enabled === 1,
    autoBookPaused: row.auto_book_paused === 1,
    abuseWindowHours: row.abuse_window_hours ?? DEFAULT_ABUSE_LIMIT_NUMBERS.windowHours,
    abuseAutoDraftsPerContact:
      row.abuse_auto_drafts_per_contact ?? DEFAULT_ABUSE_LIMIT_NUMBERS.autoDraftsPerContact,
    abuseFutureAppointmentsPerContact:
      row.abuse_future_appointments_per_contact ??
      DEFAULT_ABUSE_LIMIT_NUMBERS.futureAppointmentsPerContact,
    abusePendingPixPerContact:
      row.abuse_pending_pix_per_contact ?? DEFAULT_ABUSE_LIMIT_NUMBERS.pendingPixPerContact,
    abusePendingProposalsPerContact:
      row.abuse_pending_proposals_per_contact ??
      DEFAULT_ABUSE_LIMIT_NUMBERS.pendingProposalsPerContact,
    abuseProposalsPerContact:
      row.abuse_proposals_per_contact ?? DEFAULT_ABUSE_LIMIT_NUMBERS.proposalsPerContact,
    abuseProposalsPerClinic:
      row.abuse_proposals_per_clinic ?? DEFAULT_ABUSE_LIMIT_NUMBERS.proposalsPerClinic,
    bookingLeadMinutes: row.booking_lead_minutes ?? DEFAULT_BOOKING_LEAD_MINUTES,
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
       google_business_url, reschedule_policy,
       abuse_limits_enabled, auto_book_paused, abuse_window_hours,
       abuse_auto_drafts_per_contact,
       abuse_future_appointments_per_contact, abuse_pending_pix_per_contact,
       abuse_pending_proposals_per_contact, abuse_proposals_per_contact, abuse_proposals_per_clinic,
       booking_lead_minutes,
       updated_at
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
      id, tenant_id, timezone, signal_deadline_seconds, signal_cancellation_policy,
      booking_lead_minutes, abuse_limits_enabled, updated_at
    ) VALUES (1, ?, ?, ?, '', ?, 1, ?)`,
    tenantId,
    DEFAULT_CLINIC_TIMEZONE,
    DEFAULT_SIGNAL_DEADLINE_SECONDS,
    DEFAULT_BOOKING_LEAD_MINUTES,
    now,
  )
  return {
    tenantId,
    timezone: DEFAULT_CLINIC_TIMEZONE,
    signalDeadlineSeconds: DEFAULT_SIGNAL_DEADLINE_SECONDS,
    signalCancellationPolicy: '',
    aiAssistEnabled: false,
    googleBusinessUrl: '',
    reschedulePolicy: '',
    // DEC-214: clínica nova nasce com «Limitar excessos» ligado (recomendado).
    abuseLimitsEnabled: true,
    autoBookPaused: false,
    abuseWindowHours: DEFAULT_ABUSE_LIMIT_NUMBERS.windowHours,
    abuseAutoDraftsPerContact: DEFAULT_ABUSE_LIMIT_NUMBERS.autoDraftsPerContact,
    abuseFutureAppointmentsPerContact: DEFAULT_ABUSE_LIMIT_NUMBERS.futureAppointmentsPerContact,
    abusePendingPixPerContact: DEFAULT_ABUSE_LIMIT_NUMBERS.pendingPixPerContact,
    abusePendingProposalsPerContact: DEFAULT_ABUSE_LIMIT_NUMBERS.pendingProposalsPerContact,
    abuseProposalsPerContact: DEFAULT_ABUSE_LIMIT_NUMBERS.proposalsPerContact,
    abuseProposalsPerClinic: DEFAULT_ABUSE_LIMIT_NUMBERS.proposalsPerClinic,
    bookingLeadMinutes: DEFAULT_BOOKING_LEAD_MINUTES,
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

/** Link do Google Business (DEC-211) e regras gerais — só o responsável. */
export function setClinicAiProfile(
  db: ClinicDb,
  tenantId: string,
  input: {
    googleBusinessUrl?: string | null
    reschedulePolicy?: string | null
  },
  clock: Clock,
): ClinicSettingsRow {
  const cur = ensureClinicSettings(db, tenantId, clock)
  let googleBusinessUrl = cur.googleBusinessUrl
  if (input.googleBusinessUrl != null) {
    const check = checkGoogleBusinessUrl(input.googleBusinessUrl)
    if (!check.ok) {
      throw new ValidationError('invalid_google_business_url', check.message, {
        field: 'googleBusinessUrl',
      })
    }
    googleBusinessUrl = check.value
  }
  const policy =
    input.reschedulePolicy == null
      ? cur.reschedulePolicy
      : input.reschedulePolicy.trim().slice(0, 500)

  // DEC-210 revisão (Q1/Q2): com o sinal ligado, B não pode trazer prazos/dinheiro do Recebimento.
  // Legado conflituoso já gravado só é barrado se a owner gravar de novo esse texto.
  if (input.reschedulePolicy != null) {
    const signalOn =
      (db.get<{ signal_enabled: number | null }>(
        `SELECT signal_enabled FROM clinic_settings WHERE id = 1 AND tenant_id = ?`,
        tenantId,
      )?.signal_enabled ?? 0) === 1
    const conflict = analyzeGeneralPolicyConflict(policy, { signalOn })
    if (conflict.blocksSave) {
      throw new ValidationError(
        'reschedule_policy_conflicts_with_signal',
        formatPolicyConflictMessage(conflict),
        { field: 'reschedulePolicy', kinds: conflict.conflicts.map((c) => c.kind) },
      )
    }
  }

  db.run(
    `UPDATE clinic_settings
       SET google_business_url = ?, reschedule_policy = ?, updated_at = ?
     WHERE id = 1 AND tenant_id = ?`,
    googleBusinessUrl,
    policy,
    clock.nowMs(),
    tenantId,
  )
  return ensureClinicSettings(db, tenantId, clock)
}
