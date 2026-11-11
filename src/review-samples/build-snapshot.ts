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
  },
): ReviewSampleSnapshot | null {
  const item = getConversationWithContact(db, input.tenantId, input.conversationId)
  if (!item) return null
  const page = listMessages(db, input.tenantId, {
    conversationId: input.conversationId,
    limit: REVIEW_SAMPLE_MESSAGE_LIMIT,
  })
  return {
    tenantId: input.tenantId,
    tenantName: input.tenantName ?? null,
    conversationId: input.conversationId,
    contactId: item.contact.id,
    contactWaId: item.contact.waId,
    contactDisplayName: item.contact.displayName,
    flagSource: input.source,
    flagReason: input.reason,
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
