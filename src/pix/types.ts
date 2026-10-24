/**
 * Contrato de domínio do Pix (sinal) — independente do provedor real.
 * Autorização/pagamento NÃO inclui canais de comunicação (WhatsApp).
 * Valores em centavos inteiros; nenhum dinheiro real é movimentado pelo simulador.
 */

export type MoneyCents = number

/** Identificador do tenant (clínica) no Tredane. */
export type TenantId = string

/** Conta de recebimento da clínica no provedor (não a conta do Tredane). */
export type ClinicAccountId = string

/** Identificador estável da cobrança no Tredane (external_reference / correlation). */
export type TredaneChargeRef = string

export type ChargeStatus =
  | 'awaiting_payment'
  | 'paid'
  | 'expired'
  | 'cancelled'

export type RefundStatus = 'requested' | 'succeeded' | 'failed'

export type PixProviderErrorCode =
  | 'timeout'
  | 'not_found'
  | 'invalid_state'
  | 'invalid_signature'
  | 'tenant_mismatch'
  | 'account_mismatch'
  | 'amount_mismatch'
  | 'uncertain'
  | 'provider_unavailable'
  | 'duplicate_event'
  | 'refund_failed'

export type PixProviderError = {
  ok: false
  code: PixProviderErrorCode
  message: string
  /** Quando o resultado é incerto, a chamada deve reconciliar via consulta. */
  uncertain?: boolean
  retryable?: boolean
}

export type PixOk<T> = { ok: true; value: T }

export type PixResult<T> = PixOk<T> | PixProviderError

export type CreateChargeInput = {
  tenantId: TenantId
  accountId: ClinicAccountId
  amountCents: MoneyCents
  /** Prazo para pagar (padrão de produto: 2 h = 7200 s). */
  expiresInSeconds: number
  /** Chave de idempotência da criação. */
  idempotencyKey: string
  /** Identificador próprio do Tredane na cobrança. */
  externalReference: TredaneChargeRef
}

export type PixCharge = {
  providerChargeId: string
  tenantId: TenantId
  accountId: ClinicAccountId
  amountCents: MoneyCents
  status: ChargeStatus
  externalReference: TredaneChargeRef
  /** Copia-e-cola Pix sintético ou real conforme o adaptador. */
  pixCopyPaste: string
  expiresAt: string
  createdAt: string
  paidAt?: string
  cancelledAt?: string
}

export type RequestRefundInput = {
  providerChargeId: string
  tenantId: TenantId
  accountId: ClinicAccountId
  amountCents: MoneyCents
  idempotencyKey: string
  reason?: string
}

export type PixRefund = {
  providerRefundId: string
  providerChargeId: string
  tenantId: TenantId
  accountId: ClinicAccountId
  amountCents: MoneyCents
  status: RefundStatus
  createdAt: string
  updatedAt: string
  failureReason?: string
}

export type WebhookEventType =
  | 'charge.paid'
  | 'charge.expired'
  | 'charge.cancelled'
  | 'refund.updated'

export type RawWebhookEnvelope = {
  headers: Record<string, string | undefined>
  body: string
  /** Instantâneo em que o Tredane recebeu o aviso (para ordem). */
  receivedAt?: string
}

export type ValidatedWebhookEvent = {
  eventId: string
  type: WebhookEventType
  providerChargeId: string
  tenantId: TenantId
  accountId: ClinicAccountId
  amountCents: MoneyCents
  occurredAt: string
  /** Estado reportado pelo provedor no momento do evento. */
  chargeStatus?: ChargeStatus
  refund?: PixRefund
}
