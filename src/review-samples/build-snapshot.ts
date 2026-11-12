/**
 * Constrói o snapshot de revisão a partir do SQLite do Clinic DO (DEC-159).
 * Chamado só no instante do flag (sem sync contínuo).
 */
import type { ClinicDb } from '../clinic/store'
import { listMessages } from '../clinic/inbox/messages'
import { getConversationWithContact } from '../clinic/inbox/conversations'
import type { ReviewFlagReason, ReviewFlagSource } from '../clinic/inbox/review-flag'
import { REVIEW_SAMPLE_MESSAGE_LIMIT } from './constants'
import type { ReviewSampleSnapshot } from './types'

export function buildReviewSampleSnapshot(
  db: ClinicDb,
  input: {
    tenantId: string
    tenantName?: string | null
    conversationId: string
    source: ReviewFlagSource
    reason: ReviewFlagReason | string | null
    flaggedAt: number
    /** Se omitido, lê `review_client_comment` do DO (1.º flag). */
    clientComment?: string | null
  },
): ReviewSampleSnapshot | null {
  const item = getConversationWithContact(db, input.tenantId, input.conversationId)
  if (!item) return null
  const page = listMessages(db, input.tenantId, {
    conversationId: input.conversationId,
    limit: REVIEW_SAMPLE_MESSAGE_LIMIT,
  })
  let clientComment: string | null
  if (input.clientComment !== undefined) {
    clientComment =
      typeof input.clientComment === 'string' && input.clientComment.trim() !== ''
        ? input.clientComment.trim()
        : null
  } else {
    const row = db.get<{ review_client_comment: string | null }>(
      `SELECT review_client_comment FROM conversations WHERE tenant_id = ? AND id = ?`,
      input.tenantId,
      input.conversationId,
    )
    clientComment =
      typeof row?.review_client_comment === 'string' &&
      row.review_client_comment.trim() !== ''
        ? row.review_client_comment.trim()
        : null
  }
  return {
    tenantId: input.tenantId,
    tenantName: input.tenantName ?? null,
    conversationId: input.conversationId,
    contactId: item.contact.id,
    contactWaId: item.contact.waId,
    contactDisplayName: item.contact.displayName,
    flagSource: input.source,
    flagReason: input.reason,
    clientComment,
    flaggedAt: input.flaggedAt,
    lastMessageAt: item.lastMessageAt,
    lastMessagePreview: item.lastMessagePreview,
    messages: page.messages.map((m) => ({
      messageId: m.id,
      direction: m.direction,
      body: m.body,
      createdAt: m.createdAt,
      deliveryState: m.deliveryState,
      authorClerkUserId: m.authorClerkUserId,
      authorDisplayName: m.authorDisplayName,
    })),
  }
}
