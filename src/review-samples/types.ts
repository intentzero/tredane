import type { ReviewFlagReason, ReviewFlagSource } from '../clinic/inbox/review-flag'

export type ReviewSampleMessageSnapshot = {
  messageId: string
  direction: string
  body: string
  createdAt: number
  deliveryState: string | null
  authorClerkUserId: string | null
  authorDisplayName: string | null
}

export type ReviewSampleSnapshot = {
  tenantId: string
  tenantName: string | null
  conversationId: string
  contactId: string | null
  contactWaId: string | null
  contactDisplayName: string | null
  flagSource: ReviewFlagSource
  flagReason: ReviewFlagReason | string | null
  flaggedAt: number
  lastMessageAt: number | null
  lastMessagePreview: string | null
  messages: ReviewSampleMessageSnapshot[]
}

export type ReviewSampleListItem = {
  id: string
  tenantId: string
  tenantName: string | null
  conversationId: string
  contactId: string | null
  contactWaId: string | null
  contactDisplayName: string | null
  flagSource: string
  flagReason: string | null
  flaggedAt: number
  copiedAt: number
  expiresAt: number
  messageCount: number
  lastMessageAt: number | null
  lastMessagePreview: string | null
}

export type ReviewSampleDetail = ReviewSampleListItem & {
  messages: Array<{
    id: string
    messageId: string
    seq: number
    direction: string
    body: string
    createdAt: number
    deliveryState: string | null
    authorClerkUserId: string | null
    authorDisplayName: string | null
  }>
}
