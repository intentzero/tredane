/**
 * Limpeza diária do D1 central da página da cliente (ADR-0018 §7a): links, sessões e contadores
 * de limite expirados. Cron diário do Worker. Só apaga o que já não serve a nada.
 */
import type { Clock } from '../db/clock'

const DAY_MS = 24 * 60 * 60 * 1000

export type ClientWebCleanupRetention = {
  /** Links expirados há mais de isto (default 7 dias: dá tempo de distinguir «usado» de «inexistente» no suporte). */
  linksMs?: number
  /** Sessões expiradas ou revogadas há mais de isto (default 1 dia). */
  sessionsMs?: number
  /** Janelas de limite com mais de isto (default 1 dia). */
  rateLimitsMs?: number
}

export async function purgeExpiredClientWebRows(
  db: D1Database,
  clock: Clock,
  retention: ClientWebCleanupRetention = {},
): Promise<{ ok: boolean }> {
  const now = clock.nowMs()
  const links = now - (retention.linksMs ?? 7 * DAY_MS)
  const sessions = now - (retention.sessionsMs ?? DAY_MS)
  const rates = now - (retention.rateLimitsMs ?? DAY_MS)
  try {
    await db.prepare('DELETE FROM client_web_links WHERE expires_at < ?').bind(links).run()
    await db
      .prepare('DELETE FROM client_web_sessions WHERE expires_at < ? OR (revoked_at IS NOT NULL AND revoked_at < ?)')
      .bind(sessions, sessions)
      .run()
    await db.prepare('DELETE FROM client_web_rate_limits WHERE window_start < ?').bind(rates).run()
    return { ok: true }
  } catch {
    // Limpeza oportunista: falhar não pode derrubar o cron (as outras tarefas correm a seguir).
    return { ok: false }
  }
}
