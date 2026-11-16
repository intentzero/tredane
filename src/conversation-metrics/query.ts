/**
 * Consulta agregada (D1 central) para MCP e ops HTTP.
 */
import type { AsyncAdminDb } from '../db/admin/async-store'
import { computeConversationMetrics } from './compute'
import {
  listConversationQualityEpisodes,
  listFalseConfirmationIds,
} from './store'
import type { ConversationMetricsWindow } from './types'

export function parseMetricsWindowFromQuery(input: {
  tenantId?: string | null
  sinceMs?: number | null
  untilMs?: number | null
  sinceHours?: number | null
  nowMs: number
}): ConversationMetricsWindow | null {
  const tenantId = input.tenantId?.trim() || null
  let fromMs = input.sinceMs ?? null
  const toMs = input.untilMs ?? input.nowMs
  if (fromMs == null) {
    const hours = input.sinceHours ?? 168
    if (!Number.isFinite(hours) || hours < 1 || hours > 24 * 90) return null
    fromMs = input.nowMs - hours * 3_600_000
  }
  if (!Number.isFinite(fromMs) || fromMs >= toMs) return null
  return { tenantId, fromMs, toMs }
}

export async function fetchConversationMetricsReport(
  db: AsyncAdminDb,
  window: ConversationMetricsWindow,
  nowMs: number,
) {
  const [episodes, falseIds] = await Promise.all([
    listConversationQualityEpisodes(db, {
      sinceMs: window.fromMs,
      toMs: window.toMs,
      tenantId: window.tenantId,
    }),
    listFalseConfirmationIds(db, {
      sinceMs: window.fromMs,
      toMs: window.toMs,
      tenantId: window.tenantId,
    }),
  ])
  return computeConversationMetrics(episodes, falseIds, window, nowMs)
}