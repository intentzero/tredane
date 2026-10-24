/**
 * Contrato da fila INBOUND_EVENTS (#32).
 * `whatsapp_webhook` — entrada Meta verificada (tenant já resolvido no Worker).
 * `clinic_outbox` — efeitos pós-commit do DO (consumo de envio = #33; aqui ack no-op).
 */

export type WhatsappWebhookQueueMessage = {
  source: 'whatsapp_webhook'
  receiptId: string
  providerEventKey: string
  tenantId: string
  bindingId: string
  phoneNumberId: string
  kind: 'message' | 'unsupported' | 'status' | 'account_interrupt'
  /** Só kinds message/unsupported — conteúdo interno da fila, não em logs. */
  waId?: string
  displayName?: string
  body?: string
  messageType?: string
  providerTimestamp?: number | null
  status?: string
  statusMessageId?: string
  interruptReason?: string
  /** Synthetic-only: força falha permanente após N tentativas → DLQ. */
  __poison?: boolean
}

export type ClinicOutboxQueueMessage = {
  source: 'clinic_outbox'
  tenantId: string
  eventId: string
  type: string
  idempotencyKey: string
  entity?: { type: string; id: string }
  occurredAt?: number
  payload?: Record<string, unknown>
}

export type InboundQueueMessage = WhatsappWebhookQueueMessage | ClinicOutboxQueueMessage

export function isWhatsappWebhookMessage(
  body: unknown,
): body is WhatsappWebhookQueueMessage {
  if (!body || typeof body !== 'object') return false
  const b = body as Record<string, unknown>
  return b.source === 'whatsapp_webhook' && typeof b.tenantId === 'string'
}

export function isClinicOutboxMessage(body: unknown): body is ClinicOutboxQueueMessage {
  if (!body || typeof body !== 'object') return false
  const b = body as Record<string, unknown>
  return b.source === 'clinic_outbox' && typeof b.tenantId === 'string'
}
