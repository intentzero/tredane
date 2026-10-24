import type {
  ContactSummary,
  ConversationDetail,
  ConversationListItem,
  ConversationRow,
  InboxCounts,
  MessageRow,
} from '../clinic/inbox'

/** Serialização camelCase — texto nunca é marcado como HTML. */
export function serializeContact(c: ContactSummary) {
  return {
    id: c.id,
    waId: c.waId,
    displayName: c.displayName,
    createdAt: c.createdAt,
  }
}

export function serializeConversation(c: ConversationRow | ConversationListItem) {
  const base = {
    id: c.id,
    tenantId: c.tenantId,
    contactId: c.contactId,
    status: c.status,
    assigneeClerkUserId: c.assigneeClerkUserId,
    assigneeDisplayName: c.assigneeDisplayName,
    assignmentVersion: c.assignmentVersion,
    lastMessageAt: c.lastMessageAt,
    lastMessagePreview: c.lastMessagePreview,
    lastMessageDirection: c.lastMessageDirection,
    unreadCount: c.unreadCount,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  }
  if ('contact' in c) {
    return { ...base, contact: serializeContact(c.contact) }
  }
  return base
}

export function serializeMessage(m: MessageRow) {
  return {
    id: m.id,
    tenantId: m.tenantId,
    conversationId: m.conversationId,
    direction: m.direction,
    /** Texto plano — cliente deve renderizar como texto, nunca como HTML. */
    body: m.body,
    externalMessageId: m.externalMessageId,
    deliveryState: m.deliveryState,
    authorClerkUserId: m.authorClerkUserId,
    authorDisplayName: m.authorDisplayName,
    createdAt: m.createdAt,
  }
}

export function serializeConversationDetail(d: ConversationDetail) {
  return {
    ...serializeConversation(d),
    messages: d.messages.map(serializeMessage),
    messagesHasMore: d.messagesHasMore,
    messagesNextBefore: d.messagesNextBefore,
    messagingWindow: {
      open: d.messagingWindow.open,
      lastInboundAt: d.messagingWindow.lastInboundAt,
      closesAt: d.messagingWindow.closesAt,
      remainingMs: d.messagingWindow.remainingMs,
    },
  }
}

export function serializeCounts(c: InboxCounts) {
  return {
    all: c.all,
    new: c.new,
    mine: c.mine,
    unassigned: c.unassigned,
    closed: c.closed,
  }
}
