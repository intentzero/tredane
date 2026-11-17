/**
 * Retenção dos registos de suporte (decisão 3 do Paulo, 17/11/2026, #896; VAL-09):
 * 5 anos depois do fim da sessão para pedidos, sessões, pedidos de término e leituras (`support.access*`).
 * Cron diário do Worker. Só apaga o que já terminou; uma sessão ativa nunca é tocada.
 * A auditoria do ciclo de vida (`support.request.*`, `support.session.*`) não está neste prazo: a decisão só
 * cobre leituras e tentativas bloqueadas. A própria purga fica auditada, só com contagens.
 */
import type { Clock } from '../db/clock'
import { newId } from '../db/admin/ids'

const YEAR_MS = 365 * 24 * 60 * 60 * 1000

/** 5 anos. Constante configurável até o advogado confirmar o prazo (pergunta 11 do dossiê LGPD). */
export const SUPPORT_RETENTION_MS = 5 * YEAR_MS

export type SupportPurgeResult =
  | { ok: true; sessions: number; requests: number; accessEvents: number }
  | { ok: false }

export async function purgeSupportRecords(
  db: D1Database,
  clock: Clock,
  retentionMs: number = SUPPORT_RETENTION_MS,
): Promise<SupportPurgeResult> {
  const now = clock.nowMs()
  const cutoff = now - retentionMs
  try {
    // 1. Sessões terminadas antes do limite (e os seus pedidos de término). Ativas nunca.
    await db
      .prepare(
        `DELETE FROM support_termination_requests WHERE support_session_id IN (
           SELECT id FROM support_sessions WHERE status <> 'active' AND ended_at IS NOT NULL AND ended_at < ?)`,
      )
      .bind(cutoff)
      .run()
    const sessions = await db
      .prepare(`DELETE FROM support_sessions WHERE status <> 'active' AND ended_at IS NOT NULL AND ended_at < ?`)
      .bind(cutoff)
      .run()

    // 2. Pedidos já sem desfecho pendente e sem sessão: o prazo do pedido (24 h) já passou há mais que a retenção.
    const requests = await db
      .prepare(
        `DELETE FROM support_access_requests
         WHERE status <> 'pending' AND expires_at < ?
           AND NOT EXISTS (SELECT 1 FROM support_sessions s WHERE s.support_access_request_id = support_access_requests.id)`,
      )
      .bind(cutoff)
      .run()

    // 3. Leituras e tentativas bloqueadas (só estas ações; o resto da auditoria fica).
    const access = await db
      .prepare(`DELETE FROM central_audit_events WHERE action IN ('support.access', 'support.access.denied') AND occurred_at < ?`)
      .bind(cutoff)
      .run()

    const counts = {
      sessions: sessions.meta?.changes ?? 0,
      requests: requests.meta?.changes ?? 0,
      accessEvents: access.meta?.changes ?? 0,
    }
    if (counts.sessions + counts.requests + counts.accessEvents > 0) {
      await db
        .prepare(
          `INSERT INTO central_audit_events (
             id, occurred_at, actor_clerk_user_id, subject_clerk_user_id, tenant_id,
             action, object_type, object_id, outcome, support_session_id, metadata_json
           ) VALUES (?, ?, 'system:support-retention', NULL, NULL, 'support.retention.purge', 'support_records', NULL, 'success', NULL, ?)`,
        )
        .bind(newId('aud'), now, JSON.stringify({ ...counts, retentionMs, cutoff }))
        .run()
    }
    return { ok: true, ...counts }
  } catch {
    // Limpeza oportunista: falhar não pode derrubar o cron (as outras tarefas correm a seguir).
    return { ok: false }
  }
}
