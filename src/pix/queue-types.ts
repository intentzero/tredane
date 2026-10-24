/**
 * Mensagem de fila para webhooks Pix (#39/#40).
 * Tenant já resolvido na borda (additionalInfo / validação).
 */
export type PixWebhookEventType =
  | 'charge.paid'
  | 'charge.expired'
  | 'charge.cancelled'
  | 'refund.updated'

export type PixWebhookQueueMessage = {
  source: 'pix_webhook'
  receiptId: string
  providerEventKey: string
  tenantId: string
  accountId: string
  providerChargeId: string
  eventType: PixWebhookEventType
  amountCents: number
  occurredAt: string
  /** Presente em refund.updated. */
  refund?: {
    providerRefundId: string
    status: 'requested' | 'succeeded' | 'failed'
    amountCents: number
    failureReason?: string | null
  } | null
}

const PIX_EVENT_TYPES: readonly string[] = [
  'charge.paid',
  'charge.expired',
  'charge.cancelled',
  'refund.updated',
]

export function isPixWebhookMessage(body: unknown): body is PixWebhookQueueMessage {
  if (!body || typeof body !== 'object') return false
  const b = body as Record<string, unknown>
  return (
    b.source === 'pix_webhook' &&
    typeof b.tenantId === 'string' &&
    typeof b.providerChargeId === 'string' &&
    typeof b.eventType === 'string' &&
    PIX_EVENT_TYPES.includes(b.eventType)
  )
}
