/**
 * Contrato da fila INBOUND_EVENTS (#32/#33/#34/#39).
 * `whatsapp_webhook` — entrada Meta verificada (tenant já resolvido no Worker).
 * `clinic_outbox` — efeitos pós-commit do DO (`whatsapp.send` → Graph/synthetic).
 * `pix_webhook` — pagamento Pix validado (#39) → confirmação atómica no DO.
 */
import type { PixWebhookQueueMessage } from '../pix/queue-types'
export type { PixWebhookQueueMessage }
export { isPixWebhookMessage } from '../pix/queue-types'

export type WhatsappWebhookQueueMessage = {
  source: 'whatsapp_webhook'
  receiptId: string
  providerEventKey: string
  tenantId: string
  bindingId: string
  phoneNumberId: string
  kind: 'message' | 'media' | 'unsupported' | 'status' | 'account_interrupt'
  /** Só kinds message/unsupported/media — conteúdo interno da fila, não em logs. */
  waId?: string
  displayName?: string
  body?: string
  messageType?: string
  providerTimestamp?: number | null
  /** Mídia piloto (#34) — media_id Meta; download no consumer, fora da TX DO. */
  mediaId?: string
  mediaMimeType?: string | null
  mediaFilename?: string | null
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

export type InboundQueueMessage =
  | WhatsappWebhookQueueMessage
  | ClinicOutboxQueueMessage
  | PixWebhookQueueMessage

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
