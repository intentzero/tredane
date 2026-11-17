/**
 * Limite de pedidos das rotas públicas da página da cliente (ADR-0018 §7a).
 * Janela fixa no D1, por bucket. A chave é um hash: nunca guarda IP nem sessão em claro.
 * Não é um controlo de autenticação (o token tem 256 bits): protege contra inundação e custo.
 * Se o D1 falhar, deixa passar (e regista): a rota falha por si se o D1 estiver em baixo.
 */
import type { Clock } from '../db/clock'
import { hashToken } from '../db/tokens'

/** Valores **Propostos**. */
export const CLIENT_WEB_RATE_WINDOW_MS = 10 * 60 * 1000
export const CLIENT_WEB_EXCHANGE_LIMIT = 20
export const CLIENT_WEB_STATE_LIMIT = 120

export type RateDecision = { allowed: boolean; retryAfterSec: number }

export async function rateBucket(kind: string, subject: string): Promise<string> {
  return `${kind}:${(await hashToken(subject)).slice(0, 32)}`
}

export async function hitRateLimit(
  db: D1Database,
  clock: Clock,
  input: { bucket: string; limit: number; windowMs?: number },
): Promise<RateDecision> {
  const windowMs = input.windowMs ?? CLIENT_WEB_RATE_WINDOW_MS
  const now = clock.nowMs()
  const windowStart = Math.floor(now / windowMs) * windowMs
  const retryAfterSec = Math.max(1, Math.ceil((windowStart + windowMs - now) / 1000))
  try {
    const row = await db
      .prepare(
        `INSERT INTO client_web_rate_limits (bucket, window_start, count) VALUES (?, ?, 1)
         ON CONFLICT (bucket, window_start) DO UPDATE SET count = count + 1
         RETURNING count`,
      )
      .bind(input.bucket, windowStart)
      .first<{ count: number }>()
    return { allowed: (row?.count ?? 1) <= input.limit, retryAfterSec }
  } catch {
    return { allowed: true, retryAfterSec }
  }
}

/** Apaga janelas antigas; chamada de vez em quando, não a cada pedido. */
export async function pruneRateLimits(db: D1Database, clock: Clock, olderThanMs = 24 * 60 * 60 * 1000): Promise<void> {
  try {
    await db
      .prepare('DELETE FROM client_web_rate_limits WHERE window_start < ?')
      .bind(clock.nowMs() - olderThanMs)
      .run()
  } catch {
    /* limpeza é oportunista */
  }
}
