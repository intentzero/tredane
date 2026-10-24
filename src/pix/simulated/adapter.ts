import type { PixProviderAdapter } from '../contract'
import type {
  ChargeStatus,
  CreateChargeInput,
  MoneyCents,
  PixCharge,
  PixProviderError,
  PixProviderErrorCode,
  PixRefund,
  PixResult,
  RawWebhookEnvelope,
  RequestRefundInput,
  ValidatedWebhookEvent,
  WebhookEventType,
} from '../types'

export type SimulatedClock = {
  now(): Date
}

export type SimulatedPixOptions = {
  clock?: SimulatedClock
  /** Segredo HMAC usado na assinatura sintética dos webhooks. */
  webhookSecret?: string
  /**
   * Quando true, a próxima chamada a createCharge falha com timeout
   * (resultado incerto — reconciliar via getCharge / não há id).
   */
  failNextCreateWithTimeout?: boolean
  /**
   * Quando true, a próxima solicitação de estorno falha com refund_failed.
   */
  failNextRefund?: boolean
  /**
   * Quando true, createCharge responde uncertain (rede interrompida após envio).
   * O simulador ainda grava a cobrança para permitir reconciliação por idempotencyKey.
   */
  uncertainNextCreate?: boolean
}

type StoredCharge = PixCharge & {
  idempotencyKey: string
}

type StoredRefund = PixRefund & {
  idempotencyKey: string
}

type InternalWebhookPayload = {
  eventId: string
  type: WebhookEventType
  providerChargeId: string
  tenantId: string
  accountId: string
  amountCents: MoneyCents
  occurredAt: string
  chargeStatus?: ChargeStatus
  refundId?: string
}

const DEFAULT_SECRET = 'tredane-pix-sim-secret'

function err(
  code: PixProviderErrorCode,
  message: string,
  extra?: Pick<PixProviderError, 'uncertain' | 'retryable'>,
): PixProviderError {
  return { ok: false, code, message, ...extra }
}

function ok<T>(value: T): PixResult<T> {
  return { ok: true, value }
}

function assertPositiveCents(amountCents: MoneyCents): string | null {
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    return 'amountCents deve ser inteiro positivo (centavos)'
  }
  return null
}

/** HMAC-SHA256 hex — disponível em Workers e Node via Web Crypto. */
export async function signSimulatedWebhook(
  body: string,
  secret: string,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body))
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

async function timingSafeEqualHex(a: string, b: string): Promise<boolean> {
  if (a.length !== b.length) return false
  const ae = new TextEncoder().encode(a)
  const be = new TextEncoder().encode(b)
  let diff = 0
  for (let i = 0; i < ae.length; i++) {
    diff |= (ae[i] ?? 0) ^ (be[i] ?? 0)
  }
  return diff === 0
}

/**
 * Provedor Pix determinístico para testes — nenhum dinheiro real.
 * Reproduz pago, expirado, cancelado, duplicata, fora de ordem, timeout e estorno falho.
 */
export class SimulatedPixAdapter implements PixProviderAdapter {
  readonly providerId = 'simulated'

  private readonly clock: SimulatedClock
  private readonly webhookSecret: string
  private charges = new Map<string, StoredCharge>()
  private chargesByIdempotency = new Map<string, string>()
  private refunds = new Map<string, StoredRefund>()
  private refundsByIdempotency = new Map<string, string>()
  private processedEventIds = new Set<string>()
  private seq = 0

  failNextCreateWithTimeout: boolean
  failNextRefund: boolean
  uncertainNextCreate: boolean

  constructor(options: SimulatedPixOptions = {}) {
    this.clock = options.clock ?? { now: () => new Date() }
    this.webhookSecret = options.webhookSecret ?? DEFAULT_SECRET
    this.failNextCreateWithTimeout = options.failNextCreateWithTimeout ?? false
    this.failNextRefund = options.failNextRefund ?? false
    this.uncertainNextCreate = options.uncertainNextCreate ?? false
  }

  /** Expira cobranças awaiting cujo prazo já passou (chamado por get/cancel/eventos). */
  reconcileExpirations(): void {
    const now = this.clock.now().getTime()
    for (const charge of this.charges.values()) {
      if (
        charge.status === 'awaiting_payment' &&
        Date.parse(charge.expiresAt) <= now
      ) {
        charge.status = 'expired'
      }
    }
  }

  async createCharge(input: CreateChargeInput): Promise<PixResult<PixCharge>> {
    const amountError = assertPositiveCents(input.amountCents)
    if (amountError) return err('invalid_state', amountError)
    if (input.expiresInSeconds <= 0) {
      return err('invalid_state', 'expiresInSeconds deve ser positivo')
    }
    if (!input.tenantId || !input.accountId || !input.externalReference) {
      return err('invalid_state', 'tenantId, accountId e externalReference são obrigatórios')
    }

    if (this.failNextCreateWithTimeout) {
      this.failNextCreateWithTimeout = false
      return err('timeout', 'Timeout ao criar cobrança no provedor simulado', {
        uncertain: true,
        retryable: true,
      })
    }

    const existingId = this.chargesByIdempotency.get(input.idempotencyKey)
    if (existingId) {
      const existing = this.charges.get(existingId)
      if (!existing) return err('not_found', 'Cobrança idempotente perdida')
      if (
        existing.tenantId !== input.tenantId ||
        existing.accountId !== input.accountId ||
        existing.amountCents !== input.amountCents ||
        existing.externalReference !== input.externalReference
      ) {
        return err(
          'invalid_state',
          'idempotencyKey reutilizada com payload diferente',
        )
      }
      return ok(this.publicCharge(existing))
    }

    const now = this.clock.now()
    const id = `sim_chg_${++this.seq}`
    const charge: StoredCharge = {
      providerChargeId: id,
      tenantId: input.tenantId,
      accountId: input.accountId,
      amountCents: input.amountCents,
      status: 'awaiting_payment',
      externalReference: input.externalReference,
      pixCopyPaste: `00020126SIMULADO${id}52040000530398654${(input.amountCents / 100).toFixed(2)}5802BR5925Tredane Clinica Sintetica6009SAO PAULO62070503***6304ABCD`,
      expiresAt: new Date(now.getTime() + input.expiresInSeconds * 1000).toISOString(),
      createdAt: now.toISOString(),
      idempotencyKey: input.idempotencyKey,
    }

    this.charges.set(id, charge)
    this.chargesByIdempotency.set(input.idempotencyKey, id)

    if (this.uncertainNextCreate) {
      this.uncertainNextCreate = false
      return err(
        'uncertain',
        'Resposta do provedor interrompida após aceitar a cobrança; reconciliar por idempotencyKey',
        { uncertain: true, retryable: true },
      )
    }

    return ok(this.publicCharge(charge))
  }

  /**
   * Reconcilia criação incierta: devolve a cobrança gravada pela mesma chave,
   * se existir (padrão at-least-once / resultado incerto).
   */
  async findChargeByIdempotencyKey(
    idempotencyKey: string,
  ): Promise<PixResult<PixCharge>> {
    this.reconcileExpirations()
    const id = this.chargesByIdempotency.get(idempotencyKey)
    if (!id) return err('not_found', 'Nenhuma cobrança para esta chave de idempotência')
    const charge = this.charges.get(id)
    if (!charge) return err('not_found', 'Cobrança não encontrada')
    return ok(this.publicCharge(charge))
  }

  async getCharge(providerChargeId: string): Promise<PixResult<PixCharge>> {
    this.reconcileExpirations()
    const charge = this.charges.get(providerChargeId)
    if (!charge) return err('not_found', `Cobrança ${providerChargeId} não encontrada`)
    return ok(this.publicCharge(charge))
  }

  async cancelCharge(providerChargeId: string): Promise<PixResult<PixCharge>> {
    this.reconcileExpirations()
    const charge = this.charges.get(providerChargeId)
    if (!charge) return err('not_found', `Cobrança ${providerChargeId} não encontrada`)
    if (charge.status === 'paid') {
      return err('invalid_state', 'Não é possível cancelar cobrança já paga')
    }
    if (charge.status === 'cancelled') {
      return ok(this.publicCharge(charge))
    }
    if (charge.status === 'expired') {
      return err('invalid_state', 'Cobrança já expirada')
    }
    charge.status = 'cancelled'
    charge.cancelledAt = this.clock.now().toISOString()
    return ok(this.publicCharge(charge))
  }

  /**
   * Marca a cobrança como paga (pagamento simulado) e devolve o envelope
   * assinado que um webhook entregaria. Útil para testes de ordem/duplicata.
   */
  async simulatePayment(
    providerChargeId: string,
    options?: { occurredAt?: string; eventId?: string },
  ): Promise<PixResult<{ charge: PixCharge; envelope: RawWebhookEnvelope }>> {
    this.reconcileExpirations()
    const charge = this.charges.get(providerChargeId)
    if (!charge) return err('not_found', `Cobrança ${providerChargeId} não encontrada`)
    if (charge.status === 'cancelled') {
      return err('invalid_state', 'Cobrança cancelada não aceita pagamento')
    }

    const occurredAt = options?.occurredAt ?? this.clock.now().toISOString()
    // Pagamento tardio após expiração: o provedor ainda pode avisar "pago";
    // o domínio trata como pago sem horário. O adaptador só reporta paid.
    charge.status = 'paid'
    charge.paidAt = occurredAt

    const envelope = await this.buildSignedEnvelope({
      eventId: options?.eventId ?? `sim_evt_${++this.seq}`,
      type: 'charge.paid',
      providerChargeId: charge.providerChargeId,
      tenantId: charge.tenantId,
      accountId: charge.accountId,
      amountCents: charge.amountCents,
      occurredAt,
      chargeStatus: 'paid',
    })

    return ok({ charge: this.publicCharge(charge), envelope })
  }

  async simulateExpirationWebhook(
    providerChargeId: string,
    options?: { occurredAt?: string; eventId?: string },
  ): Promise<PixResult<{ charge: PixCharge; envelope: RawWebhookEnvelope }>> {
    this.reconcileExpirations()
    const charge = this.charges.get(providerChargeId)
    if (!charge) return err('not_found', `Cobrança ${providerChargeId} não encontrada`)
    if (charge.status === 'awaiting_payment') {
      charge.status = 'expired'
    }
    const occurredAt = options?.occurredAt ?? this.clock.now().toISOString()
    const envelope = await this.buildSignedEnvelope({
      eventId: options?.eventId ?? `sim_evt_${++this.seq}`,
      type: 'charge.expired',
      providerChargeId: charge.providerChargeId,
      tenantId: charge.tenantId,
      accountId: charge.accountId,
      amountCents: charge.amountCents,
      occurredAt,
      chargeStatus: charge.status,
    })
    return ok({ charge: this.publicCharge(charge), envelope })
  }

  async validateWebhookEvent(
    envelope: RawWebhookEnvelope,
  ): Promise<PixResult<ValidatedWebhookEvent>> {
    const signature = envelope.headers['x-tredane-pix-signature']
    if (!signature) {
      return err('invalid_signature', 'Assinatura de webhook ausente')
    }
    const expected = await signSimulatedWebhook(envelope.body, this.webhookSecret)
    if (!(await timingSafeEqualHex(signature, expected))) {
      return err('invalid_signature', 'Assinatura de webhook inválida')
    }

    let payload: InternalWebhookPayload
    try {
      payload = JSON.parse(envelope.body) as InternalWebhookPayload
    } catch {
      return err('invalid_state', 'Corpo de webhook inválido')
    }

    if (this.processedEventIds.has(payload.eventId)) {
      return err('duplicate_event', `Evento ${payload.eventId} já processado`, {
        retryable: false,
      })
    }

    const charge = this.charges.get(payload.providerChargeId)
    if (!charge) {
      return err('not_found', 'Cobrança desconhecida no webhook')
    }
    if (charge.tenantId !== payload.tenantId) {
      return err('tenant_mismatch', 'Tenant do webhook não corresponde à cobrança')
    }
    if (charge.accountId !== payload.accountId) {
      return err('account_mismatch', 'Conta do webhook não corresponde à cobrança')
    }
    if (charge.amountCents !== payload.amountCents) {
      return err('amount_mismatch', 'Valor do webhook não corresponde à cobrança')
    }

    this.processedEventIds.add(payload.eventId)

    const event: ValidatedWebhookEvent = {
      eventId: payload.eventId,
      type: payload.type,
      providerChargeId: payload.providerChargeId,
      tenantId: payload.tenantId,
      accountId: payload.accountId,
      amountCents: payload.amountCents,
      occurredAt: payload.occurredAt,
      chargeStatus: payload.chargeStatus ?? charge.status,
    }

    if (payload.refundId) {
      const refund = this.refunds.get(payload.refundId)
      if (refund) event.refund = { ...refund }
    }

    return ok(event)
  }

  async requestRefund(input: RequestRefundInput): Promise<PixResult<PixRefund>> {
    this.reconcileExpirations()
    const amountError = assertPositiveCents(input.amountCents)
    if (amountError) return err('invalid_state', amountError)

    const charge = this.charges.get(input.providerChargeId)
    if (!charge) return err('not_found', 'Cobrança não encontrada para estorno')
    if (charge.tenantId !== input.tenantId) {
      return err('tenant_mismatch', 'Tenant do estorno não corresponde')
    }
    if (charge.accountId !== input.accountId) {
      return err('account_mismatch', 'Conta do estorno não corresponde')
    }
    if (charge.status !== 'paid') {
      return err('invalid_state', 'Só é possível estornar cobrança paga')
    }
    if (input.amountCents !== charge.amountCents) {
      return err('amount_mismatch', 'MVP só permite estorno total do sinal')
    }

    const existingId = this.refundsByIdempotency.get(input.idempotencyKey)
    if (existingId) {
      const existing = this.refunds.get(existingId)
      if (!existing) return err('not_found', 'Estorno idempotente perdido')
      return ok({ ...existing })
    }

    const now = this.clock.now().toISOString()
    const id = `sim_rfnd_${++this.seq}`
    const refund: StoredRefund = {
      providerRefundId: id,
      providerChargeId: charge.providerChargeId,
      tenantId: charge.tenantId,
      accountId: charge.accountId,
      amountCents: input.amountCents,
      status: 'requested',
      createdAt: now,
      updatedAt: now,
      idempotencyKey: input.idempotencyKey,
    }

    if (this.failNextRefund) {
      this.failNextRefund = false
      refund.status = 'failed'
      refund.failureReason = 'Falha simulada no provedor ao devolver Pix'
      this.refunds.set(id, refund)
      this.refundsByIdempotency.set(input.idempotencyKey, id)
      return err('refund_failed', refund.failureReason, { retryable: true })
    }

    refund.status = 'succeeded'
    refund.updatedAt = this.clock.now().toISOString()
    this.refunds.set(id, refund)
    this.refundsByIdempotency.set(input.idempotencyKey, id)
    return ok({ ...refund })
  }

  async getRefund(providerRefundId: string): Promise<PixResult<PixRefund>> {
    const refund = this.refunds.get(providerRefundId)
    if (!refund) return err('not_found', `Estorno ${providerRefundId} não encontrado`)
    return ok({ ...refund })
  }

  private publicCharge(charge: StoredCharge): PixCharge {
    return {
      providerChargeId: charge.providerChargeId,
      tenantId: charge.tenantId,
      accountId: charge.accountId,
      amountCents: charge.amountCents,
      status: charge.status,
      externalReference: charge.externalReference,
      pixCopyPaste: charge.pixCopyPaste,
      expiresAt: charge.expiresAt,
      createdAt: charge.createdAt,
      paidAt: charge.paidAt,
      cancelledAt: charge.cancelledAt,
    }
  }

  private async buildSignedEnvelope(
    payload: InternalWebhookPayload,
  ): Promise<RawWebhookEnvelope> {
    const body = JSON.stringify(payload)
    const signature = await signSimulatedWebhook(body, this.webhookSecret)
    return {
      headers: { 'x-tredane-pix-signature': signature, 'content-type': 'application/json' },
      body,
      receivedAt: this.clock.now().toISOString(),
    }
  }
}
