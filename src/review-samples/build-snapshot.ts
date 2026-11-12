/**
 * Constrói o snapshot de revisão a partir do SQLite do Clinic DO (DEC-159).
 * Chamado no instante do flag / append de comentário (sem sync contínuo).
 */
import type { ClinicDb } from '../clinic/store'
import { listMessages } from '../clinic/inbox/messages'
import { getConversationWithContact } from '../clinic/inbox/conversations'
import {
  parseStoredClientComments,
  type ReviewFlagReason,
  type ReviewFlagSource,
} from '../clinic/inbox/review-flag'
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
    /** Se omitido, lê comentários do DO. */
    clientComment?: string | null
    clientComments?: string[] | null
  },
): ReviewSampleSnapshot | null {
  const item = getConversationWithContact(db, input.tenantId, input.conversationId)
  if (!item) return null
  const page = listMessages(db, input.tenantId, {
    conversationId: input.conversationId,
    limit: REVIEW_SAMPLE_MESSAGE_LIMIT,
  })

  let clientComments: string[]
  if (input.clientComments != null) {
    clientComments = input.clientComments
      .filter((c): c is string => typeof c === 'string')
      .map((c) => c.trim())
      .filter((c) => c.length > 0)
  } else if (input.clientComment !== undefined) {
    clientComments =
      typeof input.clientComment === 'string' && input.clientComment.trim() !== ''
        ? [input.clientComment.trim()]
        : []
  } else {
    const row = db.get<{
      review_client_comment: string | null
      review_client_comments: string | null
    }>(
      `SELECT review_client_comment, review_client_comments
       FROM conversations WHERE tenant_id = ? AND id = ?`,
      input.tenantId,
      input.conversationId,
    )
    clientComments = parseStoredClientComments(
      row?.review_client_comments,
      row?.review_client_comment,
    )
  }
  const clientComment = clientComments[0] ?? null

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
    clientComments,
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
