import type { Clock } from '../../db/clock'
import {
  DEFAULT_SIGNAL_DEADLINE_SECONDS,
  SIGNAL_DEADLINE_ALLOWED_SECONDS,
  type SignalKind,
} from '../../pix/money'
import { DEFAULT_BOOKING_LEAD_MINUTES } from '../constants'
import { ValidationError } from '../errors'
import type { ClinicDb } from '../store'
import { ensureClinicSettings } from '../config/settings'
import { syncSignalPolicyKnowledgeEntry } from '../config/knowledge'
import {
  buildSignalPolicyPreview,
  type SignalPolicyKind,
} from './signal-policy-text'
import type { PixSignalSettings, UpdateSignalSettingsInput } from './types'

const MAX_FIXED_CENTS = 10_000_000
/** Custom Outro…: número máx. 2 dígitos → até 99 h. */
const MAX_CREDIT_WINDOW_MINUTES = 99 * 60
const MAX_BOOKING_LEAD_MINUTES = 99 * 60

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
  signal_credit_window_minutes: number | null
  signal_custom_policy_text: string | null
  booking_lead_minutes: number | null
  updated_at: number
}

function mapAmountKind(raw: string | null | undefined): SignalKind {
  return raw === 'percent' ? 'percent' : 'fixed'
}

function mapPolicyKind(raw: string | null | undefined): SignalPolicyKind {
  if (raw === 'keep' || raw === 'custom') return raw
  return 'credit_next'
}

function resolveCreditWindowMinutes(
  minutes: number | null | undefined,
  hours: number | null | undefined,
): number {
  if (minutes != null && Number.isInteger(minutes) && minutes > 0) return minutes
  if (hours != null && Number.isInteger(hours) && hours > 0) return hours * 60
  return 24 * 60
}

function hoursCompat(minutes: number): number | null {
  return minutes > 0 && minutes % 60 === 0 ? minutes / 60 : null
}

function rowToSettings(row: SettingsSignalSql): PixSignalSettings {
  const amountKind = mapAmountKind(row.signal_amount_kind)
  const policyKind = mapPolicyKind(row.signal_policy_kind)
  // Sempre devolve a janela guardada (para o formulário round-trip Outro…),
  // mesmo com política ≠ credit_next. A prévia só a usa com credit_next.
  const creditWindowMinutes = resolveCreditWindowMinutes(
    row.signal_credit_window_minutes,
    row.signal_credit_window_hours,
  )
  const customPolicyText = row.signal_custom_policy_text ?? ''
  const bookingLeadMinutes =
    row.booking_lead_minutes != null && Number.isFinite(row.booking_lead_minutes)
      ? Math.max(0, Math.trunc(row.booking_lead_minutes))
      : DEFAULT_BOOKING_LEAD_MINUTES
  const preview = buildSignalPolicyPreview({
    amountKind,
    fixedCents: row.signal_fixed_cents,
    percent: row.signal_percent,
    deadlineSeconds: row.signal_deadline_seconds ?? DEFAULT_SIGNAL_DEADLINE_SECONDS,
    policyKind,
    creditWindowMinutes: policyKind === 'credit_next' ? creditWindowMinutes : null,
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
    creditWindowMinutes,
    creditWindowHours: hoursCompat(creditWindowMinutes),
    bookingLeadMinutes,
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
            signal_policy_kind, signal_credit_window_hours, signal_credit_window_minutes,
            signal_custom_policy_text, booking_lead_minutes, updated_at
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
      creditWindowMinutes: 24 * 60,
    })
    return {
      tenantId,
      enabled: false,
      amountKind: 'fixed',
      fixedCents: 5000,
      percent: null,
      deadlineSeconds: DEFAULT_SIGNAL_DEADLINE_SECONDS,
      policyKind: 'credit_next',
      creditWindowMinutes: 24 * 60,
      creditWindowHours: 24,
      bookingLeadMinutes: DEFAULT_BOOKING_LEAD_MINUTES,
      customPolicyText: '',
      cancellationPolicy: preview.combined,
      preview,
      updatedAt: clock.nowMs(),
    }
  }
  return rowToSettings(row)
}

/**
 * Texto efectivo da política de sinal para contexto IA / CF-04 / propostas
 * (DEC-180). Preferir a coluna persistida; só regenerar o preview quando o
 * sinal está ligado e a coluna ficou vazia (drift). Sem inventar política
 * default com o sinal desligado — isso tapava `reschedulePolicy` no CF-04 (E-06).
 *
 * Nota: `getPixSignalSettings().cancellationPolicy` regenera sempre que a
 * coluna está vazia (útil na API/Recebimento); não usar esse fallback cego
 * no caminho de atendimento.
 */
export function effectiveSignalCancellationPolicy(
  db: ClinicDb,
  tenantId: string,
  clock: Clock,
): string {
  ensureClinicSettings(db, tenantId, clock)
  const row = db.get<{
    signal_cancellation_policy: string | null
    signal_enabled: number | null
  }>(
    `SELECT signal_cancellation_policy, signal_enabled
     FROM clinic_settings WHERE id = 1 AND tenant_id = ?`,
    tenantId,
  )
  const stored = (row?.signal_cancellation_policy ?? '').trim()
  if (stored) return stored
  if ((row?.signal_enabled ?? 0) !== 1) return ''
  return getPixSignalSettings(db, tenantId, clock).cancellationPolicy.trim()
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

function isAllowedDeadline(seconds: number): boolean {
  return (SIGNAL_DEADLINE_ALLOWED_SECONDS as readonly number[]).includes(seconds)
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
  let creditWindowMinutes = current.creditWindowMinutes ?? 24 * 60
  let bookingLeadMinutes = current.bookingLeadMinutes
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
    if (!Number.isInteger(input.deadlineSeconds) || !isAllowedDeadline(input.deadlineSeconds)) {
      throw new ValidationError(
        'invalid_signal_deadline',
        'prazo deve ser 15 min ou 30 min',
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

  if (input.creditWindowMinutes !== undefined && input.creditWindowMinutes !== null) {
    if (
      !Number.isInteger(input.creditWindowMinutes)
      || input.creditWindowMinutes < 1
      || input.creditWindowMinutes > MAX_CREDIT_WINDOW_MINUTES
    ) {
      throw new ValidationError(
        'invalid_signal_credit_window',
        'janela deve ser entre 1 min e 99 h',
        { creditWindowMinutes: input.creditWindowMinutes },
      )
    }
    creditWindowMinutes = input.creditWindowMinutes
  } else if (input.creditWindowHours !== undefined && input.creditWindowHours !== null) {
    if (
      !Number.isInteger(input.creditWindowHours)
      || input.creditWindowHours < 1
      || input.creditWindowHours > 99
    ) {
      throw new ValidationError(
        'invalid_signal_credit_window',
        'janela deve ser entre 1 e 99 horas',
        { creditWindowHours: input.creditWindowHours },
      )
    }
    creditWindowMinutes = input.creditWindowHours * 60
  }

  if (input.bookingLeadMinutes !== undefined) {
    if (
      !Number.isInteger(input.bookingLeadMinutes)
      || input.bookingLeadMinutes < 0
      || input.bookingLeadMinutes > MAX_BOOKING_LEAD_MINUTES
    ) {
      throw new ValidationError(
        'invalid_booking_lead',
        'antecedência deve ser 0 (Desligado) até 99 h',
        { bookingLeadMinutes: input.bookingLeadMinutes },
      )
    }
    bookingLeadMinutes = input.bookingLeadMinutes
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

  // Preserva a janela custom (Outro…) ao mudar para Não devolve / Outro…;
  // não forçar 24 h no UPDATE.
  const storedWindowMinutes = creditWindowMinutes > 0 ? creditWindowMinutes : 24 * 60

  const preview = buildSignalPolicyPreview({
    amountKind,
    fixedCents: amountKind === 'fixed' ? fixedCents : null,
    percent: amountKind === 'percent' ? percent : null,
    deadlineSeconds: deadline,
    policyKind,
    creditWindowMinutes: policyKind === 'credit_next' ? storedWindowMinutes : null,
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
  const storedWindowHours =
    hoursCompat(storedWindowMinutes) ?? Math.max(1, Math.round(storedWindowMinutes / 60))

  db.run(
    `UPDATE clinic_settings
     SET signal_enabled = ?,
         signal_amount_kind = ?,
         signal_fixed_cents = ?,
         signal_percent = ?,
         signal_deadline_seconds = ?,
         signal_policy_kind = ?,
         signal_credit_window_hours = ?,
         signal_credit_window_minutes = ?,
         signal_custom_policy_text = ?,
         signal_cancellation_policy = ?,
         booking_lead_minutes = ?,
         updated_at = ?
     WHERE id = 1 AND tenant_id = ?`,
    enabled ? 1 : 0,
    amountKind,
    amountKind === 'fixed' ? fixedCents : null,
    amountKind === 'percent' ? percent : null,
    deadline,
    policyKind,
    storedWindowHours,
    storedWindowMinutes,
    policyKind === 'custom' ? customPolicyText : '',
    policy,
    bookingLeadMinutes,
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

  // DEC-185: política de sinal também como entrada FAQ (além do wiring DEC-180).
  try {
    syncSignalPolicyKnowledgeEntry(
      db,
      tenantId,
      { policyText: policy, enabled },
      'system:signal-policy',
      clock,
    )
  } catch {
    // Schema antigo em testes unitários sem migração 68: não quebra Recebimento.
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
