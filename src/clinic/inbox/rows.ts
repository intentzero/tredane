import type {
  ConversationStatus,
  MessageDeliveryState,
  MessageDirection,
} from '../constants'
import type { ContactSummary, ConversationRow, MessageRow } from './types'

export function mapConversation(row: {
  id: string
  tenant_id: string
  contact_id: string
  status: string
  assignee_clerk_user_id: string | null
  assignee_display_name: string | null
  assignment_version: number
  last_message_at: number | null
  last_message_preview: string | null
  last_message_direction: string | null
  unread_count: number
  created_at: number
  updated_at: number
}): ConversationRow {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    contactId: row.contact_id,
    status: row.status as ConversationStatus,
    assigneeClerkUserId: row.assignee_clerk_user_id,
    assigneeDisplayName: row.assignee_display_name,
    assignmentVersion: row.assignment_version,
    lastMessageAt: row.last_message_at,
    lastMessagePreview: row.last_message_preview,
    lastMessageDirection: row.last_message_direction as MessageDirection | null,
    unreadCount: row.unread_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function mapMessage(row: {
  id: string
  tenant_id: string
  conversation_id: string
  direction: string
  body: string
  external_message_id: string | null
  delivery_state: string
  author_clerk_user_id: string | null
  author_display_name: string | null
  read_by_display_name?: string | null
  read_at?: number | null
  created_at: number
}): MessageRow {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    conversationId: row.conversation_id,
    direction: row.direction as MessageDirection,
    body: row.body,
    externalMessageId: row.external_message_id,
    deliveryState: row.delivery_state as MessageDeliveryState,
    authorClerkUserId: row.author_clerk_user_id,
    authorDisplayName: row.author_display_name,
    readByDisplayName: row.read_by_display_name ?? null,
    readAt: row.read_at ?? null,
    createdAt: row.created_at,
  }
}

export function mapContactSummary(row: {
  id: string
  wa_id: string
  display_name: string | null
  created_at: number
}): ContactSummary {
  return {
    id: row.id,
    waId: row.wa_id,
    displayName: row.display_name,
    createdAt: row.created_at,
  }
}

export function previewBody(body: string, max = 120): string {
  const trimmed = body.trim()
  if (trimmed.length <= max) return trimmed
  return `${trimmed.slice(0, max - 1)}…`
}
