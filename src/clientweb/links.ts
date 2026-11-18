/**
 * Link pessoal e sessão curta da página web da cliente (DEC-196 a DEC-199, ADR-0018).
 *
 * - O link é um token opaco; só o hash SHA-256 fica no D1.
 * - Abrir o link (GET) não o consome. A troca (POST) consome-o de forma atómica
 *   e abre uma sessão curta (DEC-199).
 * - Um link novo da mesma conversa invalida o anterior.
 * - Link inexistente, usado, expirado ou substituído devolve sempre `null`,
 *   para não permitir enumerar.
 */
import type { Clock } from '../db/clock'
import { generateOpaqueToken, hashToken } from '../db/tokens'
import { serializeVariantIds } from './link-preset'

/** Valores **Propostos** (DEC-199): token 60 min, sessão 30 min. */
export const CLIENT_WEB_LINK_TTL_MS = 60 * 60 * 1000
export const CLIENT_WEB_SESSION_TTL_MS = 30 * 60 * 1000

export const CLIENT_WEB_LINK_PREFIX = 'cw1_'
export const CLIENT_WEB_SESSION_PREFIX = 'cs1_'

export type ClientWebPurpose = 'home' | 'agendar' | 'remarcar' | 'cancelar'

export type ClientWebSession = {
  tenantId: string
  contactId: string
  conversationId: string
  expiresAt: number
}

export type IssuedClientWebLink = {
  /** Token em claro: vai só no URL enviado à cliente; nunca em logs. */
  token: string
  expiresAt: number
}

export type ExchangedClientWebLink = ClientWebSession & {
  /** Sessão em claro: vai só no cookie; nunca em logs. */
  sessionToken: string
  purpose: ClientWebPurpose
  appointmentId: string | null
  /** Serviço a pré-escolher na página (DEC-202(4)). */
  serviceId: string | null
  /** Linha já dita no chat (DEC-202; DEC-200(3) Proposto). */
  audienceLine: 'feminino' | 'masculino' | null
  /** Zonas já ditas no chat. */
  variantIds: string[]
}

export function newClientWebLinkToken(): string {
  return `${CLIENT_WEB_LINK_PREFIX}${generateOpaqueToken(32)}`
}

export function newClientWebSessionToken(): string {
  return `${CLIENT_WEB_SESSION_PREFIX}${generateOpaqueToken(32)}`
}

/** Emite um link e invalida os anteriores ainda abertos da mesma conversa. */
export async function issueClientWebLink(
  db: D1Database,
  clock: Clock,
  input: {
    tenantId: string
    bindingId: string
    contactId: string
    conversationId: string
    purpose: ClientWebPurpose
    appointmentId?: string | null
    serviceId?: string | null
    audienceLine?: 'feminino' | 'masculino' | null
    variantIds?: string[]
    ttlMs?: number
  },
): Promise<IssuedClientWebLink> {
  const now = clock.nowMs()
  const token = newClientWebLinkToken()
  const tokenHash = await hashToken(token)
  const expiresAt = now + (input.ttlMs ?? CLIENT_WEB_LINK_TTL_MS)
  // Insere primeiro: nunca há janela sem um link válido.
  await db
    .prepare(
      `INSERT INTO client_web_links
         (token_hash, tenant_id, binding_id, contact_id, conversation_id, purpose,
          appointment_id, service_id, audience_line, variant_ids, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      tokenHash,
      input.tenantId,
      input.bindingId,
      input.contactId,
      input.conversationId,
      input.purpose,
      input.appointmentId ?? null,
      input.serviceId ?? null,
      input.audienceLine ?? null,
      serializeVariantIds(input.variantIds ?? []),
      now,
      expiresAt,
    )
    .run()
  await db
    .prepare(
      `UPDATE client_web_links SET replaced_at = ?
       WHERE tenant_id = ? AND conversation_id = ?
         AND token_hash <> ? AND consumed_at IS NULL AND replaced_at IS NULL`,
    )
    .bind(now, input.tenantId, input.conversationId, tokenHash)
    .run()
  return { token, expiresAt }
}

type ExchangeRow = {
  token_hash: string
  tenant_id: string
  contact_id: string
  conversation_id: string
  purpose: ClientWebPurpose
  appointment_id: string | null
  service_id: string | null
  audience_line: string | null
  variant_ids: string | null
}

function parseStoredVariantIds(raw: string | null): string[] {
  if (!raw?.trim()) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter((x): x is string => typeof x === 'string' && x.length > 0)
  } catch {
    return []
  }
}

/**
 * Troca única: consome o token e abre a sessão. Uma só instrução SQL decide
 * quem ganha, por isso dois pedidos em paralelo nunca abrem duas sessões.
 */
export async function exchangeClientWebLink(
  db: D1Database,
  clock: Clock,
  token: string,
  sessionTtlMs: number = CLIENT_WEB_SESSION_TTL_MS,
): Promise<ExchangedClientWebLink | null> {
  if (!token.startsWith(CLIENT_WEB_LINK_PREFIX) || token.length > 200) return null
  const now = clock.nowMs()
  const tokenHash = await hashToken(token)
  const row = await db
    .prepare(
      `UPDATE client_web_links SET consumed_at = ?
       WHERE token_hash = ? AND consumed_at IS NULL AND replaced_at IS NULL AND expires_at > ?
       RETURNING token_hash, tenant_id, contact_id, conversation_id, purpose, appointment_id,
         service_id, audience_line, variant_ids`,
    )
    .bind(now, tokenHash, now)
    .first<ExchangeRow>()
  if (!row) return null
  const audienceLine =
    row.audience_line === 'feminino' || row.audience_line === 'masculino' ? row.audience_line : null

  const sessionToken = newClientWebSessionToken()
  const sessionHash = await hashToken(sessionToken)
  const expiresAt = now + sessionTtlMs
  // Uma sessão aberta por conversa: as anteriores deixam de valer.
  await db
    .prepare(
      `UPDATE client_web_sessions SET revoked_at = ?
       WHERE tenant_id = ? AND conversation_id = ? AND revoked_at IS NULL`,
    )
    .bind(now, row.tenant_id, row.conversation_id)
    .run()
  await db
    .prepare(
      `INSERT INTO client_web_sessions
         (session_hash, link_hash, tenant_id, contact_id, conversation_id, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(sessionHash, row.token_hash, row.tenant_id, row.contact_id, row.conversation_id, now, expiresAt)
    .run()
  return {
    sessionToken,
    tenantId: row.tenant_id,
    contactId: row.contact_id,
    conversationId: row.conversation_id,
    expiresAt,
    purpose: row.purpose,
    appointmentId: row.appointment_id,
    serviceId: row.service_id,
    audienceLine,
    variantIds: parseStoredVariantIds(row.variant_ids),
  }
}

/** Resolve a sessão a partir do cookie. `null` se inexistente, expirada ou revogada. */
export async function getClientWebSession(
  db: D1Database,
  clock: Clock,
  sessionToken: string,
): Promise<ClientWebSession | null> {
  if (!sessionToken.startsWith(CLIENT_WEB_SESSION_PREFIX) || sessionToken.length > 200) return null
  const sessionHash = await hashToken(sessionToken)
  const row = await db
    .prepare(
      `SELECT tenant_id, contact_id, conversation_id, expires_at
       FROM client_web_sessions
       WHERE session_hash = ? AND revoked_at IS NULL AND expires_at > ?`,
    )
    .bind(sessionHash, clock.nowMs())
    .first<{ tenant_id: string; contact_id: string; conversation_id: string; expires_at: number }>()
  if (!row) return null
  return {
    tenantId: row.tenant_id,
    contactId: row.contact_id,
    conversationId: row.conversation_id,
    expiresAt: row.expires_at,
  }
}

/** Revoga as sessões abertas de uma conversa (pausa da owner, clínica suspensa). */
export async function revokeClientWebSessions(
  db: D1Database,
  clock: Clock,
  input: { tenantId: string; conversationId?: string },
): Promise<void> {
  const now = clock.nowMs()
  if (input.conversationId) {
    await db
      .prepare(
        `UPDATE client_web_sessions SET revoked_at = ?
         WHERE tenant_id = ? AND conversation_id = ? AND revoked_at IS NULL`,
      )
      .bind(now, input.tenantId, input.conversationId)
      .run()
    return
  }
  await db
    .prepare(`UPDATE client_web_sessions SET revoked_at = ? WHERE tenant_id = ? AND revoked_at IS NULL`)
    .bind(now, input.tenantId)
    .run()
}
