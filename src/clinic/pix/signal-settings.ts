import type { Clock } from '../../db/clock'
import {
  DEFAULT_SIGNAL_DEADLINE_SECONDS,
  MAX_SIGNAL_DEADLINE_SECONDS,
  MIN_SIGNAL_DEADLINE_SECONDS,
  type SignalKind,
} from '../../pix/money'
import { ValidationError } from '../errors'
import type { ClinicDb } from '../store'
import { ensureClinicSettings } from '../config/settings'
import {
  buildSignalPolicyPreview,
  type SignalPolicyKind,
} from './signal-policy-text'
import type { PixSignalSettings, UpdateSignalSettingsInput } from './types'

const MAX_FIXED_CENTS = 10_000_000
const CREDIT_WINDOWS = new Set([12, 24, 48])

type SettingsSignalSql = {
  tenant_id: string
  signal_deadline_seconds: number
  signal_cancellation_policy: string
  signal_enabled: number | null
  signal_amount_kind: string | null
  signal_fixed_cents: number | null
  signal_percent: number | null
  signal_policy_kind: string | null
  signal_credit_window_hours: number | null
  signal_custom_policy_text: string | null
  updated_at: number
}

function mapAmountKind(raw: string | null | undefined): SignalKind {
  return raw === 'percent' ? 'percent' : 'fixed'
}

function mapPolicyKind(raw: string | null | undefined): SignalPolicyKind {
  if (raw === 'keep' || raw === 'custom') return raw
  return 'credit_next'
}

function mapCreditWindow(raw: number | null | undefined): 12 | 24 | 48 {
  if (raw === 12 || raw === 48) return raw
  return 24
}

function rowToSettings(row: SettingsSignalSql): PixSignalSettings {
  const amountKind = mapAmountKind(row.signal_amount_kind)
  const policyKind = mapPolicyKind(row.signal_policy_kind)
  const creditWindowHours =
    policyKind === 'credit_next' ? mapCreditWindow(row.signal_credit_window_hours) : null
  const customPolicyText = row.signal_custom_policy_text ?? ''
  const preview = buildSignalPolicyPreview({
    amountKind,
    fixedCents: row.signal_fixed_cents,
    percent: row.signal_percent,
    deadlineSeconds: row.signal_deadline_seconds ?? DEFAULT_SIGNAL_DEADLINE_SECONDS,
    policyKind,
    creditWindowHours,
    customPolicyText,
  })
  return {
    tenantId: row.tenant_id,
    enabled: (row.signal_enabled ?? 0) === 1,
    amountKind,
    fixedCents: amountKind === 'fixed' ? (row.signal_fixed_cents ?? null) : null,
    percent: amountKind === 'percent' ? (row.signal_percent ?? null) : null,
    deadlineSeconds: row.signal_deadline_seconds ?? DEFAULT_SIGNAL_DEADLINE_SECONDS,
    policyKind,
    creditWindowHours,
    customPolicyText: policyKind === 'custom' ? customPolicyText : '',
    cancellationPolicy: row.signal_cancellation_policy || preview.combined,
    preview,
    updatedAt: row.updated_at,
  }
}

export function getPixSignalSettings(
  db: ClinicDb,
  tenantId: string,
  clock: Clock,
): PixSignalSettings {
  ensureClinicSettings(db, tenantId, clock)
  const row = db.get<SettingsSignalSql>(
    `SELECT tenant_id, signal_deadline_seconds, signal_cancellation_policy,
            signal_enabled, signal_amount_kind, signal_fixed_cents, signal_percent,
            signal_policy_kind, signal_credit_window_hours, signal_custom_policy_text,
            updated_at
     FROM clinic_settings WHERE id = 1 AND tenant_id = ?`,
    tenantId,
  )
  if (!row) {
    const preview = buildSignalPolicyPreview({
      amountKind: 'fixed',
      fixedCents: 5000,
      percent: null,
      deadlineSeconds: DEFAULT_SIGNAL_DEADLINE_SECONDS,
      policyKind: 'credit_next',
      creditWindowHours: 24,
    })
    return {
      tenantId,
      enabled: false,
      amountKind: 'fixed',
      fixedCents: 5000,
      percent: null,
      deadlineSeconds: DEFAULT_SIGNAL_DEADLINE_SECONDS,
      policyKind: 'credit_next',
      creditWindowHours: 24,
      customPolicyText: '',
      cancellationPolicy: preview.combined,
      preview,
      updatedAt: clock.nowMs(),
    }
  }
  return rowToSettings(row)
}

function validateAmount(
  amountKind: SignalKind,
  fixedCents: number | null,
  percent: number | null,
): void {
  if (amountKind === 'fixed') {
    if (
      fixedCents == null
      || !Number.isInteger(fixedCents)
      || fixedCents <= 0
      || fixedCents > MAX_FIXED_CENTS
    ) {
      throw new ValidationError(
        'invalid_signal_fixed',
        'sinal fixo deve ser inteiro positivo em centavos',
        { fixedCents },
      )
    }
    return
  }
  if (percent == null || !Number.isInteger(percent) || percent < 1 || percent > 100) {
    throw new ValidationError(
      'invalid_signal_percent',
      'percentual deve ser inteiro entre 1 e 100',
      { percent },
    )
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

  let enabled = current.enabled
  let amountKind = current.amountKind
  let fixedCents = current.fixedCents
  let percent = current.percent
  let deadline = current.deadlineSeconds
  let policyKind = current.policyKind
  let creditWindowHours = current.creditWindowHours ?? 24
  let customPolicyText = current.customPolicyText

  if (input.enabled !== undefined) enabled = input.enabled === true

  if (input.amountKind !== undefined) {
    if (input.amountKind !== 'fixed' && input.amountKind !== 'percent') {
      throw new ValidationError('invalid_signal_amount_kind', 'tipo de valor inválido')
    }
    amountKind = input.amountKind
  }
  if (input.fixedCents !== undefined) fixedCents = input.fixedCents
  if (input.percent !== undefined) percent = input.percent

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

  if (input.policyKind !== undefined) {
    if (
      input.policyKind !== 'credit_next'
      && input.policyKind !== 'keep'
      && input.policyKind !== 'custom'
    ) {
      throw new ValidationError('invalid_signal_policy_kind', 'política inválida')
    }
    policyKind = input.policyKind
  }

  if (input.creditWindowHours !== undefined && input.creditWindowHours !== null) {
    if (!CREDIT_WINDOWS.has(input.creditWindowHours)) {
      throw new ValidationError(
        'invalid_signal_credit_window',
        'janela deve ser 12, 24 ou 48 horas',
        { creditWindowHours: input.creditWindowHours },
      )
    }
    creditWindowHours = input.creditWindowHours as 12 | 24 | 48
  }

  if (input.customPolicyText !== undefined) {
    customPolicyText = input.customPolicyText.trim().slice(0, 4000)
  }

  // Compat: PATCH antigo só com cancellationPolicy (DEC-179) — trata como Outro…
  if (
    input.cancellationPolicy !== undefined
    && input.policyKind === undefined
    && input.enabled === undefined
    && input.amountKind === undefined
  ) {
    policyKind = 'custom'
    customPolicyText = input.cancellationPolicy.trim().slice(0, 4000)
  }

  if (enabled) {
    validateAmount(amountKind, fixedCents, percent)
  }

  if (policyKind === 'custom' && !customPolicyText.trim()) {
    throw new ValidationError(
      'custom_policy_required',
      'Com «Outro…» é preciso escrever o texto que a cliente vê',
    )
  }

  if (policyKind !== 'credit_next') {
    creditWindowHours = creditWindowHours || 24
  }

  const preview = buildSignalPolicyPreview({
    amountKind,
    fixedCents: amountKind === 'fixed' ? fixedCents : null,
    percent: amountKind === 'percent' ? percent : null,
    deadlineSeconds: deadline,
    policyKind,
    creditWindowHours: policyKind === 'credit_next' ? creditWindowHours : null,
    customPolicyText,
  })

  // Texto à cliente: gerado, custom, ou override explícito raro.
  let policy = preview.combined
  if (input.cancellationPolicy !== undefined && input.policyKind !== undefined) {
    // Se o cliente manda policyKind + cancellationPolicy, o texto explícito vence.
    policy = input.cancellationPolicy.trim().slice(0, 4000) || preview.combined
  } else if (policyKind === 'custom') {
    policy = customPolicyText
  }

  const now = clock.nowMs()
  db.run(
    `UPDATE clinic_settings
     SET signal_enabled = ?,
         signal_amount_kind = ?,
         signal_fixed_cents = ?,
         signal_percent = ?,
         signal_deadline_seconds = ?,
         signal_policy_kind = ?,
         signal_credit_window_hours = ?,
         signal_custom_policy_text = ?,
         signal_cancellation_policy = ?,
         updated_at = ?
     WHERE id = 1 AND tenant_id = ?`,
    enabled ? 1 : 0,
    amountKind,
    amountKind === 'fixed' ? fixedCents : null,
    amountKind === 'percent' ? percent : null,
    deadline,
    policyKind,
    policyKind === 'credit_next' ? creditWindowHours : 24,
    policyKind === 'custom' ? customPolicyText : '',
    policy,
    now,
    tenantId,
  )

  // Espelha o global nos serviços quando a owner muda o interruptor/valor
  // (caminhos propostas / IA ainda leem requires_signal). PATCH só de prazo
  // (DEC-179) não apaga o espelho antigo.
  const mirrorsServices =
    input.enabled !== undefined
    || input.amountKind !== undefined
    || input.fixedCents !== undefined
    || input.percent !== undefined
  if (mirrorsServices) {
    if (enabled) {
      db.run(
        `UPDATE services
         SET requires_signal = 1,
             signal_kind = ?,
             signal_fixed_cents = ?,
             signal_percent = ?,
             updated_at = ?
         WHERE tenant_id = ?`,
        amountKind,
        amountKind === 'fixed' ? fixedCents : null,
        amountKind === 'percent' ? percent : null,
        now,
        tenantId,
      )
    } else {
      db.run(
        `UPDATE services
         SET requires_signal = 0,
             signal_kind = NULL,
             signal_fixed_cents = NULL,
             signal_percent = NULL,
             updated_at = ?
         WHERE tenant_id = ?`,
        now,
        tenantId,
      )
    }
  }

  return getPixSignalSettings(db, tenantId, clock)
}

/**
 * Config efectiva para cobrança: global ligado + contacto sem isenção.
 * Substitui o valor por serviço (DEC-180).
 */
export function effectiveSignalForCharge(
  settings: PixSignalSettings,
  contactWaived: boolean,
): {
  requiresSignal: boolean
  kind: SignalKind | null
  fixedCents: number | null
  percent: number | null
} {
  if (!settings.enabled || contactWaived) {
    return {
      requiresSignal: false,
      kind: null,
      fixedCents: null,
      percent: null,
    }
  }
  return {
    requiresSignal: true,
    kind: settings.amountKind,
    fixedCents: settings.amountKind === 'fixed' ? settings.fixedCents : null,
    percent: settings.amountKind === 'percent' ? settings.percent : null,
  }
}
