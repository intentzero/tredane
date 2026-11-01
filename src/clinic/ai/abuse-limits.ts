/**
 * S7 (#178, épico #171) — limites de abuso das automações.
 *
 * Valores das quotas: **Confirmado (Paulo, 29/10/2026)** — ver docs/security/abuse-limits.md.
 * Controlo por clínica (owner no painel): `clinic_settings.abuse_limits_enabled` (default off,
 * fail-closed por tenant). Env `ABUSE_LIMIT_*` = tetos/bootstrap da plataforma; `ABUSE_LIMITS=on`
 * no env continua a preencher `platform.enabled` só como legado/testes — a aplicação efetiva
 * usa o enable da clínica (`resolveAbuseLimits`).
 *
 * Princípios:
 * - Só limita efeitos AUTOMÁTICOS (rascunho automático, marcação/proposta pela IA). Ações da
 *   equipe no painel não são bloqueadas.
 * - Escopo explícito por clínica (DO por tenant) e por contato; um contato no limite não afeta
 *   os outros da mesma clínica.
 * - Contagem a partir das tabelas de efeitos já existentes, dentro do DO (single-threaded) →
 *   verificação e efeito no mesmo turno, sem corrida entre pedidos concorrentes. Webhook
 *   repetido não cria efeito novo (deduplicação a montante), logo não consome quota.
 * - Limite atingido: o novo efeito não acontece, a atendente recebe o motivo, auditoria
 *   `abuse.limit_reached` (uma vez por contato/limite/janela). Nunca bloqueia o contato.
 */
import type { Clock } from '../../db/clock'
import { AI_DAILY_DRAFT_CAP } from '../../ai'
import { writeOperationalAudit } from '../audit'
import { AI_AUTOBOOK_ACTOR } from '../constants'
import type { ClinicDb } from '../store'

export type AbuseLimits = {
  enabled: boolean
  /** Janela rolante das quotas. */
  windowMs: number
  /** Rascunhos automáticos da IA por contato na janela. */
  autoDraftsPerContact: number
  /** Rascunhos por clínica por dia — já aprovado e aplicado (AI_DAILY_DRAFT_CAP); só referência. */
  autoDraftsPerClinic: number
  /** Marcações feitas pela IA por contato na janela. */
  aiBookingsPerContact: number
  /** Marcações feitas pela IA por clínica na janela. */
  aiBookingsPerClinic: number
  /** Compromissos futuros confirmados por contato (qualquer origem) antes de nova marcação automática. */
  futureAppointmentsPerContact: number
  /** Cobranças Pix aguardando pagamento por contato antes de nova cobrança automática. */
  pendingPixPerContact: number
  /** Propostas pendentes por contato (tabela appointment_proposals, S3/#174/#264). */
  pendingProposalsPerContact: number
  /** Propostas criadas por contato na janela (S3/#174/#264). */
  proposalsPerContact: number
  /** Propostas criadas por clínica na janela (S3/#174/#264). */
  proposalsPerClinic: number
}

/**
 * Padrões Confirmados (Paulo, 29/10/2026). `enabled` continua false (fail-closed).
 * Ver docs/security/abuse-limits.md.
 */
export const DEFAULT_ABUSE_LIMITS: Readonly<AbuseLimits> = Object.freeze({
  enabled: false,
  windowMs: 24 * 60 * 60 * 1000,
  autoDraftsPerContact: 20,
  autoDraftsPerClinic: AI_DAILY_DRAFT_CAP,
  aiBookingsPerContact: 1,
  aiBookingsPerClinic: 20,
  futureAppointmentsPerContact: 3,
  pendingPixPerContact: 2,
  pendingProposalsPerContact: 1,
  proposalsPerContact: 5,
  proposalsPerClinic: 100,
})

/** @deprecated Use DEFAULT_ABUSE_LIMITS (valores Confirmados Paulo 29/10/2026). */
export const PROPOSED_ABUSE_LIMITS = DEFAULT_ABUSE_LIMITS

/** Quotas numéricas editáveis pela owner (sem `enabled` / sem teto diário de rascunhos da clínica). */
export type AbuseLimitNumericKey = Exclude<keyof AbuseLimits, 'enabled' | 'autoDraftsPerClinic'>

/** Limites em horas / contagens como a owner vê e grava (não ms). */
export type AbuseLimitNumbers = {
  windowHours: number
  autoDraftsPerContact: number
  aiBookingsPerContact: number
  aiBookingsPerClinic: number
  futureAppointmentsPerContact: number
  pendingPixPerContact: number
  pendingProposalsPerContact: number
  proposalsPerContact: number
  proposalsPerClinic: number
}

/** Teto absoluto (servidor) — a clínica não pode gravar acima disto. */
export const ABUSE_LIMIT_HARD_CAPS: Readonly<AbuseLimitNumbers> = Object.freeze({
  windowHours: 168,
  autoDraftsPerContact: 200,
  aiBookingsPerContact: 20,
  aiBookingsPerClinic: 500,
  futureAppointmentsPerContact: 20,
  pendingPixPerContact: 20,
  pendingProposalsPerContact: 10,
  proposalsPerContact: 50,
  proposalsPerClinic: 1000,
})

export const DEFAULT_ABUSE_LIMIT_NUMBERS: Readonly<AbuseLimitNumbers> = Object.freeze({
  windowHours: Math.round(DEFAULT_ABUSE_LIMITS.windowMs / (60 * 60 * 1000)),
  autoDraftsPerContact: DEFAULT_ABUSE_LIMITS.autoDraftsPerContact,
  aiBookingsPerContact: DEFAULT_ABUSE_LIMITS.aiBookingsPerContact,
  aiBookingsPerClinic: DEFAULT_ABUSE_LIMITS.aiBookingsPerClinic,
  futureAppointmentsPerContact: DEFAULT_ABUSE_LIMITS.futureAppointmentsPerContact,
  pendingPixPerContact: DEFAULT_ABUSE_LIMITS.pendingPixPerContact,
  pendingProposalsPerContact: DEFAULT_ABUSE_LIMITS.pendingProposalsPerContact,
  proposalsPerContact: DEFAULT_ABUSE_LIMITS.proposalsPerContact,
  proposalsPerClinic: DEFAULT_ABUSE_LIMITS.proposalsPerClinic,
})

/** Preferências persistidas por clínica (SQLite do DO). */
export type ClinicAbuseLimitsRow = AbuseLimitNumbers & {
  enabled: boolean
  /** Pausa novas propostas e cliques de confirmação; não cancela o já marcado. */
  autoBookPaused: boolean
  updatedAt: number
}

type NumericKey = Exclude<keyof AbuseLimits, 'enabled'>
const ENV_KEYS: Record<NumericKey, string> = {
  windowMs: 'ABUSE_LIMIT_WINDOW_HOURS',
  autoDraftsPerContact: 'ABUSE_LIMIT_AUTO_DRAFTS_PER_CONTACT',
  autoDraftsPerClinic: '',
  aiBookingsPerContact: 'ABUSE_LIMIT_AI_BOOKINGS_PER_CONTACT',
  aiBookingsPerClinic: 'ABUSE_LIMIT_AI_BOOKINGS_PER_CLINIC',
  futureAppointmentsPerContact: 'ABUSE_LIMIT_FUTURE_APPOINTMENTS_PER_CONTACT',
  pendingPixPerContact: 'ABUSE_LIMIT_PENDING_PIX_PER_CONTACT',
  pendingProposalsPerContact: 'ABUSE_LIMIT_PENDING_PROPOSALS_PER_CONTACT',
  proposalsPerContact: 'ABUSE_LIMIT_PROPOSALS_PER_CONTACT',
  proposalsPerClinic: 'ABUSE_LIMIT_PROPOSALS_PER_CLINIC',
}

/**
 * Bootstrap / tetos da plataforma a partir do env.
 * `ABUSE_LIMITS=on` preenche `enabled` só como legado (testes / ops antiga); a aplicação efetiva
 * usa o enable da clínica via `resolveAbuseLimits`.
 * Cada `ABUSE_LIMIT_*` (inteiro ≥ 1; inválido → padrão Confirmado) é teto e default numérico.
 */
export function abuseLimitsFromEnv(env: Record<string, string | undefined>): AbuseLimits {
  const out: AbuseLimits = { ...DEFAULT_ABUSE_LIMITS }
  out.enabled = typeof env.ABUSE_LIMITS === 'string' && env.ABUSE_LIMITS.trim().toLowerCase() === 'on'
  for (const [key, name] of Object.entries(ENV_KEYS) as Array<[NumericKey, string]>) {
    if (!name) continue
    const raw = env[name]
    if (raw == null || raw.trim() === '') continue
    if (!/^\d+$/.test(raw.trim())) continue
    const n = Number(raw.trim())
    if (key === 'windowMs') {
      if (n >= 1) out.windowMs = n * 60 * 60 * 1000
    } else if (n >= 1) out[key] = n
  }
  return out
}

export function abuseLimitNumbersFromLimits(limits: AbuseLimits): AbuseLimitNumbers {
  return {
    windowHours: Math.max(1, Math.round(limits.windowMs / (60 * 60 * 1000))),
    autoDraftsPerContact: limits.autoDraftsPerContact,
    aiBookingsPerContact: limits.aiBookingsPerContact,
    aiBookingsPerClinic: limits.aiBookingsPerClinic,
    futureAppointmentsPerContact: limits.futureAppointmentsPerContact,
    pendingPixPerContact: limits.pendingPixPerContact,
    pendingProposalsPerContact: limits.pendingProposalsPerContact,
    proposalsPerContact: limits.proposalsPerContact,
    proposalsPerClinic: limits.proposalsPerClinic,
  }
}

/**
 * Tetos para a clínica: hard caps por omissão.
 * Se o env define `ABUSE_LIMIT_*`, esse valor (≤ hard) aperta o teto dessa chave.
 * Assim a owner pode subir até o máximo seguro; ops só restringe quando quiser.
 */
export function platformAbuseCeilings(
  platform: AbuseLimits,
  env: Record<string, string | undefined> = {},
): AbuseLimitNumbers {
  const p = abuseLimitNumbersFromLimits(platform)
  const pick = (key: keyof AbuseLimitNumbers, envName: string, platformKey: NumericKey): number => {
    const hard = ABUSE_LIMIT_HARD_CAPS[key]
    const raw = env[envName]
    if (raw != null && raw.trim() !== '' && /^\d+$/.test(raw.trim())) {
      const n = Number(raw.trim())
      if (n >= 1) return Math.min(hard, platformKey === 'windowMs' ? n : p[key])
    }
    return hard
  }
  return {
    windowHours: pick('windowHours', 'ABUSE_LIMIT_WINDOW_HOURS', 'windowMs'),
    autoDraftsPerContact: pick(
      'autoDraftsPerContact',
      'ABUSE_LIMIT_AUTO_DRAFTS_PER_CONTACT',
      'autoDraftsPerContact',
    ),
    aiBookingsPerContact: pick(
      'aiBookingsPerContact',
      'ABUSE_LIMIT_AI_BOOKINGS_PER_CONTACT',
      'aiBookingsPerContact',
    ),
    aiBookingsPerClinic: pick(
      'aiBookingsPerClinic',
      'ABUSE_LIMIT_AI_BOOKINGS_PER_CLINIC',
      'aiBookingsPerClinic',
    ),
    futureAppointmentsPerContact: pick(
      'futureAppointmentsPerContact',
      'ABUSE_LIMIT_FUTURE_APPOINTMENTS_PER_CONTACT',
      'futureAppointmentsPerContact',
    ),
    pendingPixPerContact: pick(
      'pendingPixPerContact',
      'ABUSE_LIMIT_PENDING_PIX_PER_CONTACT',
      'pendingPixPerContact',
    ),
    pendingProposalsPerContact: pick(
      'pendingProposalsPerContact',
      'ABUSE_LIMIT_PENDING_PROPOSALS_PER_CONTACT',
      'pendingProposalsPerContact',
    ),
    proposalsPerContact: pick(
      'proposalsPerContact',
      'ABUSE_LIMIT_PROPOSALS_PER_CONTACT',
      'proposalsPerContact',
    ),
    proposalsPerClinic: pick(
      'proposalsPerClinic',
      'ABUSE_LIMIT_PROPOSALS_PER_CLINIC',
      'proposalsPerClinic',
    ),
  }
}

function clampInt(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min
  return Math.min(max, Math.max(min, Math.trunc(n)))
}

/**
 * Limites efetivos para enforcement: enable da clínica; números da clínica limitados ao teto
 * da plataforma. `platform.enabled` (env) não liga a clínica.
 */
export function resolveAbuseLimits(
  platform: AbuseLimits,
  clinic: Pick<ClinicAbuseLimitsRow, 'enabled' | keyof AbuseLimitNumbers>,
  env: Record<string, string | undefined> = {},
): AbuseLimits {
  const ceilings = platformAbuseCeilings(platform, env)
  return {
    enabled: clinic.enabled === true,
    windowMs: clampInt(clinic.windowHours, 1, ceilings.windowHours) * 60 * 60 * 1000,
    autoDraftsPerContact: clampInt(clinic.autoDraftsPerContact, 1, ceilings.autoDraftsPerContact),
    autoDraftsPerClinic: platform.autoDraftsPerClinic,
    aiBookingsPerContact: clampInt(clinic.aiBookingsPerContact, 1, ceilings.aiBookingsPerContact),
    aiBookingsPerClinic: clampInt(clinic.aiBookingsPerClinic, 1, ceilings.aiBookingsPerClinic),
    futureAppointmentsPerContact: clampInt(
      clinic.futureAppointmentsPerContact,
      1,
      ceilings.futureAppointmentsPerContact,
    ),
    pendingPixPerContact: clampInt(clinic.pendingPixPerContact, 1, ceilings.pendingPixPerContact),
    pendingProposalsPerContact: clampInt(
      clinic.pendingProposalsPerContact,
      1,
      ceilings.pendingProposalsPerContact,
    ),
    proposalsPerContact: clampInt(clinic.proposalsPerContact, 1, ceilings.proposalsPerContact),
    proposalsPerClinic: clampInt(clinic.proposalsPerClinic, 1, ceilings.proposalsPerClinic),
  }
}

export type AutomatedEffect = 'auto_draft' | 'ai_booking' | 'pix_charge' | 'proposal'

export type QuotaDecision =
  | { allowed: true }
  | { allowed: false; limit: NumericKey; max: number; used: number; scope: 'contact' | 'clinic'; message: string }

const n = (r: { n: number } | undefined | null) => r?.n ?? 0

export function contactIdForConversation(db: ClinicDb, tenantId: string, conversationId: string): string | null {
  return db.get<{ contact_id: string }>(
    `SELECT contact_id FROM conversations WHERE tenant_id = ? AND id = ?`,
    tenantId,
    conversationId,
  )?.contact_id ?? null
}

/** Rascunhos automáticos do contato na janela + jobs em geração (conta o que está em voo). */
export function countAutoDraftsForContact(db: ClinicDb, tenantId: string, contactId: string, since: number): number {
  const inFlight = n(
    db.get<{ n: number }>(
      `SELECT COUNT(*) AS n FROM ai_autodraft_jobs j
       JOIN conversations c ON c.tenant_id = j.tenant_id AND c.id = j.conversation_id
       WHERE j.tenant_id = ? AND c.contact_id = ? AND j.state = 'generating'`,
      tenantId,
      contactId,
    ),
  )
  return inFlight + n(
    db.get<{ n: number }>(
      `SELECT COUNT(*) AS n FROM ai_suggestions s
       JOIN conversations c ON c.tenant_id = s.tenant_id AND c.id = s.conversation_id
       WHERE s.tenant_id = ? AND c.contact_id = ? AND s.origin = 'auto' AND s.kind = 'reply' AND s.created_at >= ?`,
      tenantId,
      contactId,
      since,
    ),
  )
}

export function countAiBookings(db: ClinicDb, tenantId: string, since: number, contactId?: string): number {
  return n(
    db.get<{ n: number }>(
      `SELECT COUNT(*) AS n FROM appointments
       WHERE tenant_id = ? AND confirmed_by = ? AND created_at >= ?${contactId ? ' AND contact_id = ?' : ''}`,
      ...[tenantId, AI_AUTOBOOK_ACTOR, since, ...(contactId ? [contactId] : [])],
    ),
  )
}

export function countFutureAppointments(db: ClinicDb, tenantId: string, contactId: string, now: number): number {
  return n(
    db.get<{ n: number }>(
      `SELECT COUNT(*) AS n FROM appointments
       WHERE tenant_id = ? AND contact_id = ? AND status = 'confirmed' AND starts_at > ?`,
      tenantId,
      contactId,
      now,
    ),
  )
}

export function countPendingPix(db: ClinicDb, tenantId: string, contactId: string): number {
  return n(
    db.get<{ n: number }>(
      `SELECT COUNT(*) AS n FROM pix_charges WHERE tenant_id = ? AND contact_id = ? AND status = 'awaiting_payment'`,
      tenantId,
      contactId,
    ),
  )
}

/** Propostas criadas na janela (S3 / #174). */
export function countProposalsCreated(
  db: ClinicDb,
  tenantId: string,
  since: number,
  contactId?: string,
): number {
  return n(
    db.get<{ n: number }>(
      `SELECT COUNT(*) AS n FROM appointment_proposals
       WHERE tenant_id = ? AND created_at >= ?${contactId ? ' AND contact_id = ?' : ''}`,
      ...[tenantId, since, ...(contactId ? [contactId] : [])],
    ),
  )
}

/** Propostas abertas por contacto (S3 / #174). */
export function countPendingProposalsForContact(
  db: ClinicDb,
  tenantId: string,
  contactId: string,
): number {
  return n(
    db.get<{ n: number }>(
      `SELECT COUNT(*) AS n FROM appointment_proposals
       WHERE tenant_id = ? AND contact_id = ?
         AND state IN ('preparada', 'envio_pendente', 'envio_incerto', 'enviada')`,
      tenantId,
      contactId,
    ),
  )
}

const MESSAGES: Record<string, string> = {
  autoDraftsPerContact: 'Limite de rascunhos automáticos para este contato atingido. Responda manualmente.',
  aiBookingsPerContact: 'Limite de marcações automáticas para este contato atingido. A equipe pode marcar pelo painel, se fizer sentido.',
  aiBookingsPerClinic: 'Limite diário de marcações automáticas da clínica atingido. A equipe pode marcar pelo painel.',
  futureAppointmentsPerContact: 'Este contato já tem vários compromissos futuros. Confirme com a cliente antes de marcar outro.',
  pendingPixPerContact: 'Este contato já tem cobranças Pix pendentes. Verifique antes de gerar outra.',
  pendingProposalsPerContact:
    'Já existe uma proposta de horário pendente para este contato. Aguarde resposta ou substitua a proposta atual.',
  proposalsPerContact: 'Limite de propostas automáticas para este contato atingido. Continue pelo painel, se fizer sentido.',
  proposalsPerClinic: 'Limite diário de propostas automáticas da clínica atingido. Continue pelo painel.',
}

/**
 * Decide se um efeito automático pode acontecer agora. Chamar no mesmo turno do DO que
 * executa o efeito. Desligado → sempre permitido.
 */
export function checkAutomationQuota(
  db: ClinicDb,
  limits: AbuseLimits,
  input: { tenantId: string; contactId: string; effect: AutomatedEffect },
  clock: Clock,
): QuotaDecision {
  if (!limits.enabled) return { allowed: true }
  const now = clock.nowMs()
  const since = now - limits.windowMs
  const { tenantId, contactId } = input
  const checks: Array<[NumericKey, 'contact' | 'clinic', () => number]> = []
  if (input.effect === 'auto_draft') {
    checks.push(['autoDraftsPerContact', 'contact', () => countAutoDraftsForContact(db, tenantId, contactId, since)])
  } else if (input.effect === 'ai_booking') {
    checks.push(
      ['aiBookingsPerContact', 'contact', () => countAiBookings(db, tenantId, since, contactId)],
      ['aiBookingsPerClinic', 'clinic', () => countAiBookings(db, tenantId, since)],
      ['futureAppointmentsPerContact', 'contact', () => countFutureAppointments(db, tenantId, contactId, now)],
    )
  } else if (input.effect === 'proposal') {
    checks.push(
      [
        'pendingProposalsPerContact',
        'contact',
        () => countPendingProposalsForContact(db, tenantId, contactId),
      ],
      [
        'proposalsPerContact',
        'contact',
        () => countProposalsCreated(db, tenantId, since, contactId),
      ],
      ['proposalsPerClinic', 'clinic', () => countProposalsCreated(db, tenantId, since)],
    )
  } else {
    checks.push(['pendingPixPerContact', 'contact', () => countPendingPix(db, tenantId, contactId)])
  }
  for (const [limit, scope, count] of checks) {
    const max = limits[limit]
    const used = count()
    if (used >= max) {
      return { allowed: false, limit, max, used, scope, message: MESSAGES[limit] ?? 'Limite de automação atingido.' }
    }
  }
  return { allowed: true }
}

/** Auditoria `abuse.limit_reached`, no máximo uma vez por contato/limite/janela. */
export function recordLimitReached(
  db: ClinicDb,
  limits: AbuseLimits,
  input: { tenantId: string; contactId: string; effect: AutomatedEffect; decision: Extract<QuotaDecision, { allowed: false }> },
  clock: Clock,
): boolean {
  const since = clock.nowMs() - limits.windowMs
  const objectId = `${input.contactId}:${input.decision.limit}`
  const existing = db.get<{ n: number }>(
    `SELECT COUNT(*) AS n FROM operational_audit
     WHERE tenant_id = ? AND action = 'abuse.limit_reached' AND object_id = ? AND occurred_at >= ?`,
    input.tenantId,
    objectId,
    since,
  )
  if (n(existing) > 0) return false
  writeOperationalAudit(
    db,
    {
      tenantId: input.tenantId,
      actor: 'system:abuse-limits',
      action: 'abuse.limit_reached',
      objectType: 'contact_limit',
      objectId,
      detail: {
        effect: input.effect,
        limit: input.decision.limit,
        scope: input.decision.scope,
        max: input.decision.max,
        used: input.decision.used,
      },
    },
    clock,
  )
  console.warn(
    JSON.stringify({
      level: 'warn',
      event: 'abuse.limit_reached',
      tenantId: input.tenantId,
      limit: input.decision.limit,
      scope: input.decision.scope,
    }),
  )
  return true
}
