/**
 * DEC-159 — purge TTL 30 dias das amostras de revisão no D1 central.
 * Disparado pelo cron Worker (`triggers.crons`) ou por ops tick.
 */
import { purgeExpiredReviewSamplesD1 } from './store'

export async function runReviewSamplesPurge(
  env: { DB: D1Database },
  nowMs = Date.now(),
): Promise<{ deleted: number; nowMs: number }> {
  const { deleted } = await purgeExpiredReviewSamplesD1(env.DB, nowMs)
  return { deleted, nowMs }
}
