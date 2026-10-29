/**
 * Persistência e vista API dos limites de abuso por clínica (owner-only).
 */
import type { Clock } from '../../db/clock'
import {
  ABUSE_LIMIT_HARD_CAPS,
  DEFAULT_ABUSE_LIMIT_NUMBERS,
  abuseLimitsFromEnv,
  platformAbuseCeilings,
  resolveAbuseLimits,
  type AbuseLimitNumbers,
  type AbuseLimits,
  type ClinicAbuseLimitsRow,
} from '../ai/abuse-limits'
import { ValidationError } from '../errors'
import type { ClinicDb } from '../store'
import { ensureClinicSettings } from './settings'
import type { ClinicSettingsRow, UpdateAbuseLimitsInput } from './types'

const NUMBER_KEYS = [
  'windowHours',
  'autoDraftsPerContact',
  'aiBookingsPerContact',
  'aiBookingsPerClinic',
  'futureAppointmentsPerContact',
  'pendingPixPerContact',
  'pendingProposalsPerContact',
  'proposalsPerContact',
  'proposalsPerClinic',
] as const satisfies ReadonlyArray<keyof AbuseLimitNumbers>

export function clinicAbuseRowFromSettings(settings: ClinicSettingsRow): ClinicAbuseLimitsRow {
  return {
    enabled: settings.abuseLimitsEnabled,
    autoBookPaused: settings.autoBookPaused,
    windowHours: settings.abuseWindowHours,
    autoDraftsPerContact: settings.abuseAutoDraftsPerContact,
    aiBookingsPerContact: settings.abuseAiBookingsPerContact,
    aiBookingsPerClinic: settings.abuseAiBookingsPerClinic,
    futureAppointmentsPerContact: settings.abuseFutureAppointmentsPerContact,
    pendingPixPerContact: settings.abusePendingPixPerContact,
    pendingProposalsPerContact: settings.abusePendingProposalsPerContact,
    proposalsPerContact: settings.abuseProposalsPerContact,
    proposalsPerClinic: settings.abuseProposalsPerClinic,
    updatedAt: settings.updatedAt,
  }
}

export function effectiveAbuseLimitsForClinic(
  db: ClinicDb,
  tenantId: string,
  clock: Clock,
  platform: AbuseLimits = abuseLimitsFromEnv({}),
  env: Record<string, string | undefined> = {},
): AbuseLimits {
  const settings = ensureClinicSettings(db, tenantId, clock)
  return resolveAbuseLimits(platform, clinicAbuseRowFromSettings(settings), env)
}

export function isClinicAutoBookPaused(db: ClinicDb, tenantId: string, clock: Clock): boolean {
  return ensureClinicSettings(db, tenantId, clock).autoBookPaused === true
}

export type AbuseLimitsView = {
  enabled: boolean
  autoBookPaused: boolean
  limits: AbuseLimitNumbers
  defaults: AbuseLimitNumbers
  caps: AbuseLimitNumbers
  platformCeilings: AbuseLimitNumbers
  effective: AbuseLimits
  updatedAt: number
}

export function buildAbuseLimitsView(
  settings: ClinicSettingsRow,
  platform: AbuseLimits,
  env: Record<string, string | undefined> = {},
): AbuseLimitsView {
  const clinic = clinicAbuseRowFromSettings(settings)
  const ceilings = platformAbuseCeilings(platform, env)
  const effective = resolveAbuseLimits(platform, clinic, env)
  return {
    enabled: clinic.enabled,
    autoBookPaused: clinic.autoBookPaused,
    limits: {
      windowHours: clinic.windowHours,
      autoDraftsPerContact: clinic.autoDraftsPerContact,
      aiBookingsPerContact: clinic.aiBookingsPerContact,
      aiBookingsPerClinic: clinic.aiBookingsPerClinic,
      futureAppointmentsPerContact: clinic.futureAppointmentsPerContact,
      pendingPixPerContact: clinic.pendingPixPerContact,
      pendingProposalsPerContact: clinic.pendingProposalsPerContact,
      proposalsPerContact: clinic.proposalsPerContact,
      proposalsPerClinic: clinic.proposalsPerClinic,
    },
    defaults: { ...DEFAULT_ABUSE_LIMIT_NUMBERS },
    caps: { ...ABUSE_LIMIT_HARD_CAPS },
    platformCeilings: ceilings,
    effective,
    updatedAt: clinic.updatedAt,
  }
}

function parsePositiveInt(raw: unknown, field: string): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw) || !Number.isInteger(raw) || raw < 1) {
    throw new ValidationError('invalid_abuse_limit', `Valor inválido para ${field}: use um inteiro ≥ 1.`, {
      field,
    })
  }
  return raw
}

/**
 * Valida e aplica PATCH. Números limitados a min(1, teto plataforma/hard).
 * `resetToDefaults` restaura números Confirmados (ainda sujeitos ao teto).
 */
export function updateClinicAbuseLimits(
  db: ClinicDb,
  tenantId: string,
  input: UpdateAbuseLimitsInput,
  clock: Clock,
  platform: AbuseLimits = abuseLimitsFromEnv({}),
  env: Record<string, string | undefined> = {},
): ClinicSettingsRow {
  const cur = ensureClinicSettings(db, tenantId, clock)
  const ceilings = platformAbuseCeilings(platform, env)
  let next = clinicAbuseRowFromSettings(cur)

  if (input.resetToDefaults === true) {
    next = {
      ...next,
      windowHours: Math.min(DEFAULT_ABUSE_LIMIT_NUMBERS.windowHours, ceilings.windowHours),
      autoDraftsPerContact: Math.min(
        DEFAULT_ABUSE_LIMIT_NUMBERS.autoDraftsPerContact,
        ceilings.autoDraftsPerContact,
      ),
      aiBookingsPerContact: Math.min(
        DEFAULT_ABUSE_LIMIT_NUMBERS.aiBookingsPerContact,
        ceilings.aiBookingsPerContact,
      ),
      aiBookingsPerClinic: Math.min(
        DEFAULT_ABUSE_LIMIT_NUMBERS.aiBookingsPerClinic,
        ceilings.aiBookingsPerClinic,
      ),
      futureAppointmentsPerContact: Math.min(
        DEFAULT_ABUSE_LIMIT_NUMBERS.futureAppointmentsPerContact,
        ceilings.futureAppointmentsPerContact,
      ),
      pendingPixPerContact: Math.min(
        DEFAULT_ABUSE_LIMIT_NUMBERS.pendingPixPerContact,
        ceilings.pendingPixPerContact,
      ),
      pendingProposalsPerContact: Math.min(
        DEFAULT_ABUSE_LIMIT_NUMBERS.pendingProposalsPerContact,
        ceilings.pendingProposalsPerContact,
      ),
      proposalsPerContact: Math.min(
        DEFAULT_ABUSE_LIMIT_NUMBERS.proposalsPerContact,
        ceilings.proposalsPerContact,
      ),
      proposalsPerClinic: Math.min(
        DEFAULT_ABUSE_LIMIT_NUMBERS.proposalsPerClinic,
        ceilings.proposalsPerClinic,
      ),
    }
  }

  if (typeof input.enabled === 'boolean') next.enabled = input.enabled
  if (typeof input.autoBookPaused === 'boolean') next.autoBookPaused = input.autoBookPaused

  for (const key of NUMBER_KEYS) {
    const raw = input[key]
    if (raw === undefined) continue
    const value = parsePositiveInt(raw, key)
    const max = ceilings[key]
    if (value > max) {
      throw new ValidationError(
        'abuse_limit_above_cap',
        `O limite ${key} não pode passar de ${max} (teto da plataforma).`,
        { field: key, max, value },
      )
    }
    next[key] = value
  }

  const now = clock.nowMs()
  db.run(
    `UPDATE clinic_settings SET
      abuse_limits_enabled = ?,
      auto_book_paused = ?,
      abuse_window_hours = ?,
      abuse_auto_drafts_per_contact = ?,
      abuse_ai_bookings_per_contact = ?,
      abuse_ai_bookings_per_clinic = ?,
      abuse_future_appointments_per_contact = ?,
      abuse_pending_pix_per_contact = ?,
      abuse_pending_proposals_per_contact = ?,
      abuse_proposals_per_contact = ?,
      abuse_proposals_per_clinic = ?,
      updated_at = ?
     WHERE id = 1 AND tenant_id = ?`,
    next.enabled ? 1 : 0,
    next.autoBookPaused ? 1 : 0,
    next.windowHours,
    next.autoDraftsPerContact,
    next.aiBookingsPerContact,
    next.aiBookingsPerClinic,
    next.futureAppointmentsPerContact,
    next.pendingPixPerContact,
    next.pendingProposalsPerContact,
    next.proposalsPerContact,
    next.proposalsPerClinic,
    now,
    tenantId,
  )
  return ensureClinicSettings(db, tenantId, clock)
}
