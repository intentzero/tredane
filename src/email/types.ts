/**
 * Transporte de e-mail (#25 / #26).
 * Provedor real ainda Em aberto — só o adaptador simulado está aprovado para F1.
 * Nunca registar tokens, handoffs, inviteUrl com segredo, nem PHI em logs.
 */

export type InvitationEmailPayload = {
  toEmail: string
  tenantId: string
  tenantName: string
  invitationId: string
  /** Token em claro — só para montar o link; nunca persistir/auditar. */
  rawToken: string
  expiresAt: number
  /** Base URL pública (ex.: http://localhost:5173). */
  appBaseUrl: string
}

/** E-mail informativo de pedido de suporte (DEC-030) — sem token/credencial. */
export type SupportAccessRequestEmailPayload = {
  toEmail: string
  tenantId: string
  tenantName: string
  supportRequestId: string
  actorClerkUserId: string
  subjectClerkUserId: string
  reason: string
  scope: string
  expiresAt: number
  appBaseUrl: string
}

export type EmailSendResult =
  | { ok: true; providerMessageId: string }
  | { ok: false; error: string; retryable: boolean }

export type EmailTransport = {
  readonly name: string
  sendInvitation(payload: InvitationEmailPayload): Promise<EmailSendResult>
  sendSupportAccessRequest(
    payload: SupportAccessRequestEmailPayload,
  ): Promise<EmailSendResult>
}

export type DeliveryJobRow = {
  id: string
  idempotencyKey: string
  template: 'tenant_invitation' | 'support_access_request'
  toEmail: string
  tenantId: string
  invitationId: string | null
  supportRequestId: string | null
  status: 'pending' | 'sent' | 'failed' | 'abandoned'
  attemptCount: number
  maxAttempts: number
  nextAttemptAt: number
  lastError: string | null
  createdAt: number
  updatedAt: number
  sentAt: number | null
}

/** Mensagem entregue no mailbox simulado (só memória de teste/dev). */
export type SimulatedMailboxMessage =
  | {
      id: string
      toEmail: string
      template: 'tenant_invitation'
      subject: string
      /** Contém o token — exclusivo do mailbox em memória; nunca serializar em audit. */
      inviteUrl: string
      tenantId: string
      invitationId: string
      sentAt: number
    }
  | {
      id: string
      toEmail: string
      template: 'support_access_request'
      subject: string
      /** Link autenticado — sem token de aprovação. */
      requestUrl: string
      tenantId: string
      supportRequestId: string
      sentAt: number
    }
