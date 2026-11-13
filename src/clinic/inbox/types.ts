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
  /** DEC-180 — isenção durável do sinal (Contato). */
  signalWaived?: boolean
  signalWaiveReason?: string | null
  signalWaivedByDisplayName?: string | null
  signalWaivedAt?: number | null
}

/** Visita resumida para o directório Clientes (DEC-165): o que vem a seguir ou o que já houve. */
export type ContactVisit = { startsAt: number; serviceName: string }

export type ContactDirectoryItem = ContactSummary & {
  nextVisit: ContactVisit | null
  lastVisit: ContactVisit | null
}

export type ConversationListItem = ConversationRow & {
  contact: ContactSummary
  /** IA pausada ou alerta de equipe ainda aberto (DEC-083, 31/10/2026). */
  needsPerson: boolean
  /**
   * Rascunho automático em curso (`ai_autodraft_jobs`: queued | generating).
   * Alimenta o spinner da lista; o WS `conversation.ai_draft` actualiza em tempo real.
   */
  aiDrafting: boolean
  /** DEC-157 — marcada para revisão humana (não pausa a IA). */
  forReview: boolean
  reviewFlaggedAt: number | null
  reviewFlaggedSource: 'client' | 'staff' | 'auto' | null
  reviewFlagReason: string | null
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
  /**
   * Procedimento, dia e período que a conversa já definiu (BookingFrame); `null` sem sessão.
   * `dayLabel` fica sempre `null` após o cutover #472 (coluna órfã); use `date` (YYYY-MM-DD).
   */
  scheduleHint: {
    serviceId: string
    dayLabel: string | null
    /** Data civil absoluta no fuso da clínica (ADR-0015 / #472). */
    date: string | null
    period: 'manha' | 'tarde' | 'noite' | null
  } | null
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

/** Linha de lista Cloud API (interactive type=list) — M5 / #415 / DEC-128. */
export type SendOutboundInteractiveListRow = {
  id: string
  title: string
  description?: string
}

export type SendOutboundInteractiveListSection = {
  title?: string
  rows: SendOutboundInteractiveListRow[]
}

export type SendOutboundInteractiveList = {
  /** Rótulo do botão que abre a lista (≤20). */
  button: string
  sections: SendOutboundInteractiveListSection[]
}

/** Flow Cloud API (interactive type=flow) — #514 / ADR-0016. */
export type SendOutboundInteractiveFlow = {
  flowId: string
  flowCta: string
  flowToken: string
  flowAction?: 'data_exchange'
  flowMessageVersion?: string
  mode?: 'published' | 'draft'
}

/**
 * Interactive WhatsApp: botões (≤3) **ou** lista (≤10 linhas) **ou** Flow.
 * Mutuamente exclusivos. Exige janela 24 h.
 */
export type SendOutboundInteractiveInput = {
  buttons?: SendOutboundInteractiveButton[]
  list?: SendOutboundInteractiveList | null
  flow?: SendOutboundInteractiveFlow | null
}

export type SendOutboundAfterPersistCtx = {
  /** ClinicDb já dentro de transactionSync — não abrir outra TX. */
  db: import('../store').ClinicDb
  tenantId: string
  conversationId: string
  messageId: string
  outboundId: string
  now: number
}

export type SendOutboundInput = {
  conversationId: string
  /** Texto livre — só permitido com janela 24 h aberta. */
  body?: string | null
  /** Modelo aprovado — obrigatório fora da janela. */
  template?: SendOutboundTemplateInput | null
  /**
   * Mensagem interactive com botões ou lista (Cloud API). Exige janela 24 h;
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
  /**
   * ADR-0015 / #412: corre dentro do mesmo `transactionSync` após inserir
   * mensagem + outbound. Sem HTTP/Queues/R2 nem novo `transactionSync`.
   * Usado para gravar BookingFrame + `booking_frame.updated` na mesma TX.
   */
  afterPersist?: (ctx: SendOutboundAfterPersistCtx) => import('../outbox').OutboxRow[]
}

export type InboxCounts = {
  /**
   * Chip «Todas»: conversas dual-unread (não lidas pelo humano e ainda
   * sem resposta — DEC-159). Não é o total de fios abertos.
   */
  all: number
  /** Chip «Novas»: dual-unread com status `new`. */
  new: number
  /** Chip «Minhas»: dual-unread atribuídas ao viewer. */
  mine: number
  /** Chip «Sem responsável»: dual-unread sem assignee. */
  unassigned: number
  closed: number
  /** Dual-unread — badge do ícone da app (DEC-159). */
  unread: number
  /** IA pausada ou alerta de equipe aberto. */
  needsPerson: number
  /** DEC-157 — fila «Para revisão». */
  forReview: number
}
