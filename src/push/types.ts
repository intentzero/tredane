/** Tipos Web Push (#42 / DEC-040) — sem conteúdo de mensagem. */

export type PushSubscriptionKeys = {
  p256dh: string
  auth: string
}

export type PushSubscriptionInput = {
  endpoint: string
  expirationTime?: number | null
  keys: PushSubscriptionKeys
}

export type PushSubscriptionRow = {
  id: string
  tenantId: string
  clerkUserId: string
  endpoint: string
  p256dh: string
  auth: string
  expirationTime: number | null
  userAgent: string | null
  notifyNewConversation: boolean
  createdAt: number
  updatedAt: number
  lastSeenAt: number
}

/** Payload mostrado ao utilizador — sem corpo/telefone/nome do contacto. */
export type NewConversationPushPayload = {
  title: string
  body: string
  tag: string
  /** Deep link relativo; abertura revalida Clerk + membership. */
  url: string
  tenantId: string
  conversationId: string
  kind: 'new_conversation' | 'new_message'
  /** Nº de conversas com não lidas (badge do ícone). Só um número. */
  badgeCount?: number
}

export type PushSendRecord = {
  id: string
  tenantId: string
  clerkUserId: string
  endpoint: string
  conversationId: string
  payload: NewConversationPushPayload
  sentAt: number
  mode: 'synthetic' | 'live'
  status: 'sent' | 'gone' | 'failed'
  errorCode?: string
}

export type PushTransportResult =
  | { ok: true; status: number }
  | { ok: false; gone: true; status: number }
  | { ok: false; gone: false; status: number; errorCode: string }

export type PushTransport = {
  send(
    subscription: {
      endpoint: string
      keys: PushSubscriptionKeys
    },
    payload: NewConversationPushPayload,
  ): Promise<PushTransportResult>
}
