/**
 * Mensagem de fila para pagamento Pix (#39).
 * Tenant já resolvido na borda (additionalInfo / validação).
 */
export type PixWebhookQueueMessage = {
  source: 'pix_webhook'
  receiptId: string
  providerEventKey: string
  tenantId: string
  accountId: string
  providerChargeId: string
  eventType: 'charge.paid'
  amountCents: number
  occurredAt: string
}

export function isPixWebhookMessage(body: unknown): body is PixWebhookQueueMessage {
  if (!body || typeof body !== 'object') return false
  const b = body as Record<string, unknown>
  return (
    b.source === 'pix_webhook' &&
    typeof b.tenantId === 'string' &&
    typeof b.providerChargeId === 'string' &&
    b.eventType === 'charge.paid'
  )
}
