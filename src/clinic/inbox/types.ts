import type {
  ConversationStatus,
  InboxFilter,
  MessageDeliveryState,
  MessageDirection,
} from '../constants'

export type ConversationRow = {
  id: string
  tenantId: string
  contactId: string
  status: ConversationStatus
  assigneeClerkUserId: string | null
  assigneeDisplayName: string | null
  assignmentVersion: number
  lastMessageAt: number | null
  lastMessagePreview: string | null
  lastMessageDirection: MessageDirection | null
  unreadCount: number
  createdAt: number
  updatedAt: number
}

export type MessageRow = {
  id: string
  tenantId: string
  conversationId: string
  direction: MessageDirection
  body: string
  externalMessageId: string | null
  deliveryState: MessageDeliveryState
  authorClerkUserId: string | null
  authorDisplayName: string | null
  createdAt: number
}

export type ContactSummary = {
  id: string
  waId: string
  displayName: string | null
  createdAt: number
}

export type ConversationListItem = ConversationRow & {
  contact: ContactSummary
}

export type MessagingWindowView = {
  open: boolean
  lastInboundAt: number | null
  closesAt: number | null
  remainingMs: number | null
}

export type ConversationDetail = ConversationListItem & {
  messages: MessageRow[]
  messagesHasMore: boolean
  messagesNextBefore: number | null
  messagingWindow: MessagingWindowView
}

export type ListConversationsInput = {
  filter?: InboxFilter
  q?: string
  /** Clerk user id do membro autenticado — necessário para filtro `mine`. */
  viewerClerkUserId?: string
  limit?: number
  /** Paginação por last_message_at (exclusivo). */
  before?: number | null
}

export type ListMessagesInput = {
  conversationId: string
  limit?: number
  /** Mensagens com created_at < before (histórico mais antigo). */
  before?: number | null
}

export type AssignConversationInput = {
  conversationId: string
  /** null = remover responsável. */
  assigneeClerkUserId: string | null
  assigneeDisplayName: string | null
  /** Actor que assume/transfere (histórico de autor). */
  actorClerkUserId: string
  actorDisplayName: string
  /**
   * Concorrência otimista (Proposto): se informado e diferente do persistido,
   * a escrita ainda aplica (last-write-wins no DO) e devolve o vencedor;
   * o chamador HTTP pode optar por 409 quando expected != resultado.
   */
  expectedAssignmentVersion?: number | null
}

export type MarkReadInput = {
  conversationId: string
}

export type CloseConversationInput = {
  conversationId: string
  actorClerkUserId: string
  actorDisplayName: string
}

export type SendOutboundTemplateInput = {
  name: string
  language: string
  params: Record<string, string>
}

export type SendOutboundInput = {
  conversationId: string
  /** Texto livre — só permitido com janela 24 h aberta. */
  body?: string | null
  /** Modelo aprovado — obrigatório fora da janela. */
  template?: SendOutboundTemplateInput | null
  clientRequestId: string
  authorClerkUserId: string
  authorDisplayName: string
}

export type InboxCounts = {
  all: number
  new: number
  mine: number
  unassigned: number
  closed: number
}
