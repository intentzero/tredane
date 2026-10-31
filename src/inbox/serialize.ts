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
    blockedAt: c.blockedAt,
    blockedByDisplayName: c.blockedByDisplayName,
    blockedReason: c.blockedReason,
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
    needsPerson: 'needsPerson' in c ? c.needsPerson : false,
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
    readByDisplayName: m.readByDisplayName ?? null,
    readAt: m.readAt ?? null,
    attachments: (m.attachments ?? []).map((a) => ({
      id: a.id,
      contentType: a.contentType,
      byteSize: a.byteSize,
      filename: a.filename,
      status: a.status,
      failureCode: a.failureCode,
      statusLabel: a.statusLabel,
      includedInAiContext: false as const,
    })),
    caption: m.caption ?? null,
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
    contactHasPendingPix: d.contactHasPendingPix,
    // DEC-062: a etapa mostrada na conversa; sem este campo a faixa «Etapa» nunca aparece.
    opportunity: d.opportunity
      ? {
          id: d.opportunity.id,
          stage: d.opportunity.stage,
          label: d.opportunity.label,
          updatedAt: d.opportunity.updatedAt,
        }
      : null,
    // S4 / #175 — proposta e H7 só para membros autorizados (rota já exige membership).
    activeProposal: d.activeProposal
      ? {
          id: d.activeProposal.id,
          version: d.activeProposal.version,
          state: d.activeProposal.state,
          serviceName: d.activeProposal.serviceName,
          startsAt: d.activeProposal.startsAt,
          endsAt: d.activeProposal.endsAt,
          expiresAt: d.activeProposal.expiresAt,
          resultKind: d.activeProposal.resultKind,
          sendProviderMessageId: d.activeProposal.sendProviderMessageId,
        }
      : null,
    pendingCommunications: (d.pendingCommunications ?? []).map((c) => ({
      id: c.id,
      kind: c.kind,
      status: c.status,
      startedAt: c.startedAt,
      alertAfterAt: c.alertAfterAt,
      alertedAt: c.alertedAt,
      detailText: c.detailText,
      proposalId: c.proposalId,
    })),
    aiReplyPause: d.aiReplyPause,
  }
}

export function serializeCounts(c: InboxCounts) {
  return {
    all: c.all,
    new: c.new,
    mine: c.mine,
    unassigned: c.unassigned,
    closed: c.closed,
    unread: c.unread ?? 0,
    needsPerson: c.needsPerson ?? 0,
  }
}
