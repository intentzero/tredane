/**
 * Cópia best-effort do snapshot para o D1 central (DEC-159 / DEC-167).
 * Nunca bloqueia o ack WhatsApp / flag local.
 */
import type { ClinicDb } from '../clinic/store'
import type { ReviewFlagReason, ReviewFlagSource } from '../clinic/inbox/review-flag'
import { buildReviewSampleSnapshot } from './build-snapshot'
import { upsertReviewSampleD1, upsertReviewSampleSync } from './store'
import type { AdminDb } from '../db/admin/store'

export type ReviewSampleCopyTarget =
  | { kind: 'd1'; db: D1Database }
  | { kind: 'sync'; db: AdminDb }

export async function copyReviewSampleBestEffort(input: {
  clinicDb: ClinicDb
  target: ReviewSampleCopyTarget | null | undefined
  tenantId: string
  tenantName?: string | null
  conversationId: string
  source: ReviewFlagSource
  reason: ReviewFlagReason | string | null
  flaggedAt: number
  clientComment?: string | null
  clientComments?: string[] | null
  nowMs: number
}): Promise<{ ok: boolean; sampleId?: string; error?: string }> {
  if (!input.target) return { ok: false, error: 'no_target' }
  try {
    const snapshot = buildReviewSampleSnapshot(input.clinicDb, {
      tenantId: input.tenantId,
      tenantName: input.tenantName ?? null,
      conversationId: input.conversationId,
      source: input.source,
      reason: input.reason,
      flaggedAt: input.flaggedAt,
      clientComment: input.clientComment,
      clientComments: input.clientComments,
    })
    if (!snapshot) return { ok: false, error: 'conversation_not_found' }
    if (input.target.kind === 'sync') {
      const { sampleId } = upsertReviewSampleSync(
        input.target.db,
        snapshot,
        input.nowMs,
      )
      return { ok: true, sampleId }
    }
    const { sampleId } = await upsertReviewSampleD1(
      input.target.db,
      snapshot,
      input.nowMs,
    )
    return { ok: true, sampleId }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'copy_failed',
    }
  }
}
