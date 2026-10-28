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

export type MessageAttachmentSummary = {
  id: string
  contentType: string
  byteSize: number
  filename: string | null
  status: 'pending' | 'ready' | 'unavailable' | 'failed'
  failureCode: string | null
  /** Confirmado DEC-011: nunca true no contexto IA. */
  includedInAiContext: false
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
  /** Mensagem da cliente lida pela equipa («Lida por Ana · 17:40»). */
  readByDisplayName?: string | null
  readAt?: number | null
  attachments?: MessageAttachmentSummary[]
}

export type ContactSummary = {
  id: string
  waId: string
  displayName: string | null
  createdAt: number
  /** Bloqueado pela equipe (Proposto): mensagens novas não entram no painel. */
  blockedAt: number | null
  blockedByDisplayName: string | null
  blockedReason: string | null
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
  /** Contato tem Pix pendente (aviso no diálogo de bloqueio; o Pix não é cancelado). */
  contactHasPendingPix: boolean
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
  /** Quem abriu a conversa (para «Lida por Ana · 17:40»). */
  readerClerkUserId?: string | null
  readerDisplayName?: string | null
}

export type CloseConversationInput = {
  conversationId: string
  actorClerkUserId: string
  actorDisplayName: string
}

export type BlockContactInput = {
  contactId: string
  actorClerkUserId: string
  actorDisplayName: string
  /** Motivo opcional, só a equipe vê. */
  reason?: string | null
}

export type UnblockContactInput = {
  contactId: string
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
  /**
   * Sugestão IA usada neste envio humano (#41 / AC-06).
   * A IA nunca envia sozinha — só liga origem interna após clique em Enviar.
   */
  aiSuggestionId?: string | null
}

export type InboxCounts = {
  all: number
  new: number
  mine: number
  unassigned: number
  closed: number
  /** Conversas com mensagens não lidas (badge do ícone da app). */
  unread: number
}
