/**
 * Bilhete curto de upgrade WebSocket (inbox em tempo real).
 *
 * O `WebSocket` do browser não envia `Authorization`. O cliente pede, via API
 * autenticada (Bearer Clerk + membership D1), um bilhete opaco de uso único
 * guardado no Durable Object da própria clínica. O upgrade leva o bilhete em
 * `?ticket=`; o DO resgata-o (apaga-o) e revalida o membership no D1.
 *
 * - Guarda apenas o SHA-256 do bilhete (nunca o valor bruto).
 * - TTL curto; uso único; escopo = instância DO do tenant (sem fuga cross-tenant).
 */

export const WS_TICKET_TTL_MS = 30_000
export const WS_TICKET_QUERY = 'ticket'
export const WS_TICKET_HEADER = 'x-tredane-ws-ticket'
const KEY_PREFIX = 'rt_ws_ticket:'

export type WsTicketGrant = {
  tenantId: string
  clerkUserId: string
  sessionId: string
  role: 'owner' | 'attendant'
  expiresAt: number
}

/** Subconjunto do KV do DO (ctx.storage) — injetável em testes. */
export type WsTicketStorage = {
  get<T>(key: string): Promise<T | undefined>
  put<T>(key: string, value: T): Promise<void>
  delete(key: string): Promise<boolean>
  list<T>(opts: { prefix: string }): Promise<Map<string, T>>
}

export type WsTicketRedeemResult =
  | { ok: true; grant: WsTicketGrant }
  | { ok: false; reason: 'ticket_invalid' | 'ticket_expired' | 'ticket_tenant_mismatch' }

function toBase64Url(bytes: Uint8Array): string {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export async function hashWsTicket(ticket: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ticket))
  return toBase64Url(new Uint8Array(digest))
}

/** Formato: `wst_` + 32 bytes aleatórios base64url. */
export function isWellFormedWsTicket(ticket: string | null | undefined): ticket is string {
  return typeof ticket === 'string' && /^wst_[A-Za-z0-9_-]{40,64}$/.test(ticket)
}

export async function issueWsTicket(
  storage: WsTicketStorage,
  input: Omit<WsTicketGrant, 'expiresAt'>,
  nowMs: number,
  ttlMs = WS_TICKET_TTL_MS,
): Promise<{ ticket: string; expiresAt: number }> {
  // Limpeza oportunista de bilhetes expirados (poucos por clínica).
  try {
    const existing = await storage.list<WsTicketGrant>({ prefix: KEY_PREFIX })
    for (const [key, grant] of existing) {
      if (!grant || grant.expiresAt <= nowMs) await storage.delete(key)
    }
  } catch {
    /* best-effort */
  }
  const raw = new Uint8Array(32)
  crypto.getRandomValues(raw)
  const ticket = `wst_${toBase64Url(raw)}`
  const expiresAt = nowMs + ttlMs
  await storage.put<WsTicketGrant>(KEY_PREFIX + (await hashWsTicket(ticket)), {
    ...input,
    expiresAt,
  })
  return { ticket, expiresAt }
}

/** Resgate de uso único: o bilhete é apagado antes de qualquer verificação. */
export async function redeemWsTicket(
  storage: WsTicketStorage,
  ticket: string,
  expectedTenantId: string,
  nowMs: number,
): Promise<WsTicketRedeemResult> {
  if (!isWellFormedWsTicket(ticket)) return { ok: false, reason: 'ticket_invalid' }
  const key = KEY_PREFIX + (await hashWsTicket(ticket))
  const grant = await storage.get<WsTicketGrant>(key)
  if (!grant) return { ok: false, reason: 'ticket_invalid' }
  await storage.delete(key)
  if (grant.expiresAt <= nowMs) return { ok: false, reason: 'ticket_expired' }
  if (grant.tenantId !== expectedTenantId) {
    return { ok: false, reason: 'ticket_tenant_mismatch' }
  }
  return { ok: true, grant }
}

/** KV em memória para testes unitários. */
export function createMemoryWsTicketStorage(): WsTicketStorage & { size(): number } {
  const map = new Map<string, unknown>()
  return {
    async get<T>(key: string) {
      return map.get(key) as T | undefined
    },
    async put<T>(key: string, value: T) {
      map.set(key, structuredClone(value))
    },
    async delete(key: string) {
      return map.delete(key)
    },
    async list<T>(opts: { prefix: string }) {
      const out = new Map<string, T>()
      for (const [k, v] of map) if (k.startsWith(opts.prefix)) out.set(k, v as T)
      return out
    },
    size: () => map.size,
  }
}
