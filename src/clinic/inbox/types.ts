import type {
  ConversationStatus,
  InboxFilter,
  MessageDeliveryState,
  MessageDirection,
  OpportunityStage,
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
  /** `deleted` = anexo removido (sem metadados de conteúdo). */
  status: 'pending' | 'ready' | 'unavailable' | 'failed' | 'deleted'
  failureCode: string | null
  /** Texto verificável do estado (P2 #184). */
  statusLabel: string
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
  /**
   * Legenda da cliente, distinta do placeholder («[Imagem]»…). null = sem legenda.
   * Só preenchida quando a mensagem tem anexos (P2 #184). Texto não confiável.
   */
  caption?: string | null
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

/** Proposta ativa + comunicação pendente (S4 / #175) — só membros autorizados via API. */
export type ConversationProposalPanel = {
  id: string
  version: number
  state: string
  serviceName: string
  startsAt: number
  endsAt: number
  expiresAt: number | null
  resultKind: string | null
  sendProviderMessageId: string | null
}

export type ConversationPendingCommunicationPanel = {
  id: string
  kind: string
  status: string
  startedAt: number
  alertAfterAt: number
  alertedAt: number | null
  detailText: string
  proposalId: string | null
}

export type ConversationDetail = ConversationListItem & {
  messages: MessageRow[]
  messagesHasMore: boolean
  messagesNextBefore: number | null
  messagingWindow: MessagingWindowView
  /** Contato tem Pix pendente (aviso no diálogo de bloqueio; o Pix não é cancelado). */
  contactHasPendingPix: boolean
  /** Oportunidade aberta da conversa (DEC-062: etapa só de leitura na tela); `null` sem oportunidade. */
  opportunity: {
    id: string
    stage: OpportunityStage
    label: string
    updatedAt: number
  } | null
  /** S4: proposta versionada visível na conversa (membros da clínica). */
  activeProposal: ConversationProposalPanel | null
  /** S4 / H7: comunicações pendentes abertas ou alertadas. */
  pendingCommunications: ConversationPendingCommunicationPanel[]
  /** DEC-083: IA pausada até a equipe devolver. */
  aiReplyPause: { at: number; reason: string } | null
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

/** Botões reply da Cloud API (interactive type=button) — S4 / #175. */
export type SendOutboundInteractiveButton = {
  id: string
  title: string
}

export type SendOutboundInteractiveInput = {
  buttons: SendOutboundInteractiveButton[]
}

export type SendOutboundInput = {
  conversationId: string
  /** Texto livre — só permitido com janela 24 h aberta. */
  body?: string | null
  /** Modelo aprovado — obrigatório fora da janela. */
  template?: SendOutboundTemplateInput | null
  /**
   * Mensagem interactive com botões (Cloud API). Exige janela 24 h aberta;
   * fora da janela não há envio irregular — a chamada deve escalar à equipe.
   */
  interactive?: SendOutboundInteractiveInput | null
  clientRequestId: string
  authorClerkUserId: string
  authorDisplayName: string
  /**
   * Sugestão IA usada neste envio humano (#41 / AC-06).
   * Origem da sugestão. O rascunho automático envia sozinho; o clique em Enviar continua válido.
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
