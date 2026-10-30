import { DEFAULT_CLINIC_TIMEZONE } from '../constants'
import { DEFAULT_SIGNAL_DEADLINE_SECONDS } from '../../pix/money'
import { DEFAULT_ABUSE_LIMIT_NUMBERS } from '../ai/abuse-limits'
import type { Clock } from '../../db/clock'
import type { ClinicDb } from '../store'
import type { ClinicSettingsRow, ForecastPlaceInput } from './types'
import { normalizeTimezone } from './validation'
import { checkGoogleBusinessUrl } from './google-business-link'
import { ValidationError } from '../errors'

type SettingsSql = {
  tenant_id: string
  timezone: string
  signal_deadline_seconds?: number
  signal_cancellation_policy?: string
  ai_assist_enabled?: number
  clinic_address?: string
  google_business_url?: string
  reschedule_policy?: string
  tempo_local?: string
  tempo_cidade?: string | null
  tempo_latitude?: number | null
  tempo_longitude?: number | null
  abuse_limits_enabled?: number
  auto_book_paused?: number
  abuse_window_hours?: number
  abuse_auto_drafts_per_contact?: number
  abuse_ai_bookings_per_contact?: number
  abuse_ai_bookings_per_clinic?: number
  abuse_future_appointments_per_contact?: number
  abuse_pending_pix_per_contact?: number
  abuse_pending_proposals_per_contact?: number
  abuse_proposals_per_contact?: number
  abuse_proposals_per_clinic?: number
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
    googleBusinessUrl: row.google_business_url ?? '',
    reschedulePolicy: row.reschedule_policy ?? '',
    forecastMode:
      row.tempo_local === 'cidade' || row.tempo_local === 'coordenadas'
        ? row.tempo_local
        : 'nenhum',
    forecastCity: row.tempo_cidade ?? null,
    forecastLatitude: row.tempo_latitude ?? null,
    forecastLongitude: row.tempo_longitude ?? null,
    abuseLimitsEnabled: row.abuse_limits_enabled === 1,
    autoBookPaused: row.auto_book_paused === 1,
    abuseWindowHours: row.abuse_window_hours ?? DEFAULT_ABUSE_LIMIT_NUMBERS.windowHours,
    abuseAutoDraftsPerContact:
      row.abuse_auto_drafts_per_contact ?? DEFAULT_ABUSE_LIMIT_NUMBERS.autoDraftsPerContact,
    abuseAiBookingsPerContact:
      row.abuse_ai_bookings_per_contact ?? DEFAULT_ABUSE_LIMIT_NUMBERS.aiBookingsPerContact,
    abuseAiBookingsPerClinic:
      row.abuse_ai_bookings_per_clinic ?? DEFAULT_ABUSE_LIMIT_NUMBERS.aiBookingsPerClinic,
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
       clinic_address, google_business_url, reschedule_policy,
       tempo_local, tempo_cidade, tempo_latitude, tempo_longitude,
       abuse_limits_enabled, auto_book_paused, abuse_window_hours,
       abuse_auto_drafts_per_contact, abuse_ai_bookings_per_contact, abuse_ai_bookings_per_clinic,
       abuse_future_appointments_per_contact, abuse_pending_pix_per_contact,
       abuse_pending_proposals_per_contact, abuse_proposals_per_contact, abuse_proposals_per_clinic,
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
    googleBusinessUrl: '',
    reschedulePolicy: '',
    forecastMode: 'nenhum',
    forecastCity: null,
    forecastLatitude: null,
    forecastLongitude: null,
    abuseLimitsEnabled: false,
    autoBookPaused: false,
    abuseWindowHours: DEFAULT_ABUSE_LIMIT_NUMBERS.windowHours,
    abuseAutoDraftsPerContact: DEFAULT_ABUSE_LIMIT_NUMBERS.autoDraftsPerContact,
    abuseAiBookingsPerContact: DEFAULT_ABUSE_LIMIT_NUMBERS.aiBookingsPerContact,
    abuseAiBookingsPerClinic: DEFAULT_ABUSE_LIMIT_NUMBERS.aiBookingsPerClinic,
    abuseFutureAppointmentsPerContact: DEFAULT_ABUSE_LIMIT_NUMBERS.futureAppointmentsPerContact,
    abusePendingPixPerContact: DEFAULT_ABUSE_LIMIT_NUMBERS.pendingPixPerContact,
    abusePendingProposalsPerContact: DEFAULT_ABUSE_LIMIT_NUMBERS.pendingProposalsPerContact,
    abuseProposalsPerContact: DEFAULT_ABUSE_LIMIT_NUMBERS.proposalsPerContact,
    abuseProposalsPerClinic: DEFAULT_ABUSE_LIMIT_NUMBERS.proposalsPerClinic,
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

/** Endereço, link do Google Business e regras de remarcação/cancelamento usados no contexto da IA (só o responsável). */
export function setClinicAiProfile(
  db: ClinicDb,
  tenantId: string,
  input: {
    clinicAddress?: string | null
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
  const address =
    input.clinicAddress == null ? cur.clinicAddress : input.clinicAddress.trim().slice(0, 300)
  const policy =
    input.reschedulePolicy == null
      ? cur.reschedulePolicy
      : input.reschedulePolicy.trim().slice(0, 1000)
  db.run(
    `UPDATE clinic_settings SET clinic_address = ?, google_business_url = ?, reschedule_policy = ?, updated_at = ?
     WHERE id = 1 AND tenant_id = ?`,
    address,
    googleBusinessUrl,
    policy,
    clock.nowMs(),
    tenantId,
  )
  return ensureClinicSettings(db, tenantId, clock)
}

const FORECAST_CITY_MAX = 80

/** Local da previsão (DEC-077). Não altera `clinic_address`. Um modo apaga o outro. */
export function setForecastPlace(
  db: ClinicDb,
  tenantId: string,
  input: ForecastPlaceInput,
  clock: Clock,
): ClinicSettingsRow {
  ensureClinicSettings(db, tenantId, clock)
  const now = clock.nowMs()
  if (input.mode === 'cidade') {
    const city = input.city.trim()
    if (!city) {
      throw new ValidationError('invalid_forecast_place', 'Informe a cidade.')
    }
    if (city.length > FORECAST_CITY_MAX) {
      throw new ValidationError(
        'invalid_forecast_place',
        `A cidade pode ter até ${FORECAST_CITY_MAX} caracteres.`,
      )
    }
    db.run(
      `UPDATE clinic_settings
         SET tempo_local = 'cidade', tempo_cidade = ?, tempo_latitude = NULL, tempo_longitude = NULL,
             updated_at = ?
       WHERE id = 1 AND tenant_id = ?`,
      city,
      now,
      tenantId,
    )
    return ensureClinicSettings(db, tenantId, clock)
  }
  if (!Number.isFinite(input.latitude) || input.latitude < -90 || input.latitude > 90) {
    throw new ValidationError(
      'invalid_forecast_place',
      'Latitude tem de estar entre −90 e 90.',
    )
  }
  if (!Number.isFinite(input.longitude) || input.longitude < -180 || input.longitude > 180) {
    throw new ValidationError(
      'invalid_forecast_place',
      'Longitude tem de estar entre −180 e 180.',
    )
  }
  db.run(
    `UPDATE clinic_settings
       SET tempo_local = 'coordenadas', tempo_cidade = NULL, tempo_latitude = ?, tempo_longitude = ?,
           updated_at = ?
     WHERE id = 1 AND tenant_id = ?`,
    input.latitude,
    input.longitude,
    now,
    tenantId,
  )
  return ensureClinicSettings(db, tenantId, clock)
}
