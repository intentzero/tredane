/**
 * Adaptador real Woovi / OpenPix (DEC-049 / ADR-0014 / #37).
 * HTTP `fetch` apenas — sem SDK Node. Credenciais = App ID da clínica (nunca Tredane).
 * CI usa sandbox fixture injectável; dinheiro real exige GATE-08 (DPA/chaves humanas).
 */

import type { PixProviderAdapter } from '../contract'
import type {
  CreateChargeInput,
  PixCharge,
  PixProviderError,
  PixProviderErrorCode,
  PixRefund,
  PixResult,
  RawWebhookEnvelope,
  RequestRefundInput,
  ValidatedWebhookEvent,
} from '../types'
import {
  mapWooviChargeStatus,
  mapWooviRefundStatus,
  mapWooviWebhookEvent,
  readAdditional,
  WOOVI_ADDITIONAL_ACCOUNT,
  WOOVI_ADDITIONAL_TENANT,
} from './map'
import {
  fetchWooviPublicKeys,
  type PublicKeyCache,
  verifyWooviWebhookSignature,
} from './webhook'

export const WOOVI_PROVIDER_ID = 'woovi'

export const WOOVI_BASE_URLS = {
  live: 'https://api.woovi.com',
  sandbox: 'https://api.woovi-sandbox.com',
} as const

export type WooviEnvironment = 'sandbox' | 'live'

export type WooviPixAdapterOptions = {
  appId: string
  /** Conta/tenant esperados — usados se additionalInfo faltar no webhook. */
  tenantId: string
  accountId: string
  environment?: WooviEnvironment
  baseUrl?: string
  fetchImpl?: typeof fetch
  timeoutMs?: number
  /** Cache mutável de chaves públicas de webhook. */
  publicKeyCache?: { current: PublicKeyCache | null; ttlMs?: number }
  /** PEM injectáveis (testes) — evita GET remoto. */
  webhookPublicKeys?: string[]
}

type WooviChargeJson = {
  correlationID?: string
  value?: number
  status?: string
  brCode?: string
  paymentLinkUrl?: string
  expiresDate?: string
  createdAt?: string
  paidAt?: string
  transactionID?: string
  additionalInfo?: Array<{ key?: string; value?: string }>
  globalID?: string
}

type WooviRefundJson = {
  correlationID?: string
  value?: number
  status?: string
  time?: string
  comment?: string
  endToEndId?: string
}

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

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number | undefined,
): Promise<T> {
  if (!timeoutMs || timeoutMs <= 0) return promise
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error('timeout')), timeoutMs)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

function assertPositiveCents(amountCents: number): string | null {
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    return 'amountCents deve ser inteiro positivo (centavos)'
  }
  return null
}

export class WooviPixAdapter implements PixProviderAdapter {
  readonly providerId = WOOVI_PROVIDER_ID

  private readonly appId: string
  private readonly tenantId: string
  private readonly accountId: string
  private readonly baseUrl: string
  private readonly fetchImpl: typeof fetch
  private readonly timeoutMs?: number
  private readonly publicKeyCache: { current: PublicKeyCache | null; ttlMs?: number }
  private readonly injectedPublicKeys?: string[]
  private readonly processedEventIds = new Set<string>()

  constructor(options: WooviPixAdapterOptions) {
    this.appId = options.appId
    this.tenantId = options.tenantId
    this.accountId = options.accountId
    const env = options.environment ?? 'sandbox'
    this.baseUrl = (options.baseUrl ?? WOOVI_BASE_URLS[env]).replace(/\/$/, '')
    this.fetchImpl = options.fetchImpl ?? fetch
    this.timeoutMs = options.timeoutMs
    this.publicKeyCache = options.publicKeyCache ?? { current: null }
    this.injectedPublicKeys = options.webhookPublicKeys
  }

  /** Valida App ID com uma chamada leve (lista 1 cobrança). */
  async verifyCredentials(): Promise<
    PixResult<{ ok: true; environmentBaseUrl: string }>
  > {
    try {
      const res = await withTimeout(
        this.fetchImpl(`${this.baseUrl}/api/v1/charge?skip=0&limit=1`, {
          method: 'GET',
          headers: this.headers(),
        }),
        this.timeoutMs,
      )
      if (res.status === 401 || res.status === 403) {
        return err('invalid_signature', 'App ID rejeitado pelo Woovi', {
          retryable: false,
        })
      }
      if (!res.ok) {
        return err('provider_unavailable', `Woovi HTTP ${res.status}`, {
          retryable: res.status >= 500,
        })
      }
      return ok({ ok: true, environmentBaseUrl: this.baseUrl })
    } catch (e) {
      if (e instanceof Error && e.message === 'timeout') {
        return err('timeout', 'Timeout ao verificar App ID Woovi', {
          uncertain: true,
          retryable: true,
        })
      }
      return err('provider_unavailable', 'Falha de rede ao verificar Woovi', {
        retryable: true,
      })
    }
  }

  async createCharge(input: CreateChargeInput): Promise<PixResult<PixCharge>> {
    const amountError = assertPositiveCents(input.amountCents)
    if (amountError) return err('invalid_state', amountError)
    if (input.expiresInSeconds <= 0) {
      return err('invalid_state', 'expiresInSeconds deve ser positivo')
    }
    if (input.tenantId !== this.tenantId) {
      return err('tenant_mismatch', 'tenantId não corresponde ao adaptador')
    }
    if (input.accountId !== this.accountId) {
      return err('account_mismatch', 'accountId não corresponde ao adaptador')
    }

    const body = {
      correlationID: input.externalReference,
      value: input.amountCents,
      expiresIn: input.expiresInSeconds,
      additionalInfo: [
        { key: WOOVI_ADDITIONAL_TENANT, value: input.tenantId },
        { key: WOOVI_ADDITIONAL_ACCOUNT, value: input.accountId },
      ],
    }

    try {
      const res = await withTimeout(
        this.fetchImpl(`${this.baseUrl}/api/v1/charge`, {
          method: 'POST',
          headers: {
            ...this.headers(),
            'idempotency-key': input.idempotencyKey,
          },
          body: JSON.stringify(body),
        }),
        this.timeoutMs,
      )
      if (res.status === 401 || res.status === 403) {
        return err('invalid_signature', 'Credencial Woovi inválida ou revogada')
      }
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        return err(
          res.status >= 500 ? 'provider_unavailable' : 'invalid_state',
          `Woovi create charge HTTP ${res.status}: ${text.slice(0, 200)}`,
          { retryable: res.status >= 500 },
        )
      }
      const json = (await res.json()) as { charge?: WooviChargeJson } & WooviChargeJson
      const charge = json.charge ?? json
      return ok(this.toPixCharge(charge, input))
    } catch (e) {
      if (e instanceof Error && e.message === 'timeout') {
        return err('timeout', 'Timeout ao criar cobrança Woovi', {
          uncertain: true,
          retryable: true,
        })
      }
      return err('uncertain', 'Resposta Woovi interrompida; reconciliar', {
        uncertain: true,
        retryable: true,
      })
    }
  }

  async getCharge(providerChargeId: string): Promise<PixResult<PixCharge>> {
    try {
      const res = await withTimeout(
        this.fetchImpl(
          `${this.baseUrl}/api/v1/charge/${encodeURIComponent(providerChargeId)}`,
          { method: 'GET', headers: this.headers() },
        ),
        this.timeoutMs,
      )
      if (res.status === 404) {
        return err('not_found', `Cobrança ${providerChargeId} não encontrada`)
      }
      if (res.status === 401 || res.status === 403) {
        return err('invalid_signature', 'Credencial Woovi inválida ou revogada')
      }
      if (!res.ok) {
        return err('provider_unavailable', `Woovi get charge HTTP ${res.status}`, {
          retryable: res.status >= 500,
        })
      }
      const json = (await res.json()) as { charge?: WooviChargeJson } & WooviChargeJson
      const charge = json.charge ?? json
      return ok(this.toPixCharge(charge))
    } catch (e) {
      if (e instanceof Error && e.message === 'timeout') {
        return err('timeout', 'Timeout ao consultar cobrança Woovi', {
          uncertain: true,
          retryable: true,
        })
      }
      return err('provider_unavailable', 'Falha de rede ao consultar Woovi', {
        retryable: true,
      })
    }
  }

  async cancelCharge(providerChargeId: string): Promise<PixResult<PixCharge>> {
    try {
      const res = await withTimeout(
        this.fetchImpl(
          `${this.baseUrl}/api/v1/charge/${encodeURIComponent(providerChargeId)}`,
          { method: 'DELETE', headers: this.headers() },
        ),
        this.timeoutMs,
      )
      if (res.status === 404) {
        return err('not_found', `Cobrança ${providerChargeId} não encontrada`)
      }
      if (res.status === 401 || res.status === 403) {
        return err('invalid_signature', 'Credencial Woovi inválida ou revogada')
      }
      if (!res.ok && res.status !== 204) {
        return err('invalid_state', `Woovi cancel HTTP ${res.status}`, {
          retryable: res.status >= 500,
        })
      }
      // Após DELETE, consulta estado.
      const got = await this.getCharge(providerChargeId)
      if (got.ok) {
        return ok({
          ...got.value,
          status: got.value.status === 'paid' ? 'paid' : 'cancelled',
          cancelledAt: got.value.cancelledAt ?? new Date().toISOString(),
        })
      }
      // 404 após delete = cancelada
      if (got.code === 'not_found') {
        return ok({
          providerChargeId,
          tenantId: this.tenantId,
          accountId: this.accountId,
          amountCents: 0,
          status: 'cancelled',
          externalReference: providerChargeId,
          pixCopyPaste: '',
          expiresAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
          cancelledAt: new Date().toISOString(),
        })
      }
      return got
    } catch (e) {
      if (e instanceof Error && e.message === 'timeout') {
        return err('timeout', 'Timeout ao cancelar cobrança Woovi', {
          uncertain: true,
          retryable: true,
        })
      }
      return err('provider_unavailable', 'Falha de rede ao cancelar Woovi', {
        retryable: true,
      })
    }
  }

  async validateWebhookEvent(
    envelope: RawWebhookEnvelope,
  ): Promise<PixResult<ValidatedWebhookEvent>> {
    const signature =
      envelope.headers['x-webhook-signature'] ??
      envelope.headers['X-Webhook-Signature']
    if (!signature) {
      return err('invalid_signature', 'Assinatura de webhook ausente')
    }

    let pems: string[]
    try {
      pems =
        this.injectedPublicKeys ??
        (await fetchWooviPublicKeys(this.baseUrl, this.fetchImpl, this.publicKeyCache))
    } catch {
      return err('provider_unavailable', 'Não foi possível obter chaves públicas Woovi', {
        retryable: true,
      })
    }

    const valid = await verifyWooviWebhookSignature(envelope.body, signature, pems)
    if (!valid) {
      return err('invalid_signature', 'Assinatura de webhook inválida')
    }

    let payload: {
      event?: string
      charge?: WooviChargeJson
      refund?: WooviRefundJson
    }
    try {
      payload = JSON.parse(envelope.body) as typeof payload
    } catch {
      return err('invalid_state', 'Corpo de webhook inválido')
    }

    const type = mapWooviWebhookEvent(payload.event ?? '')
    if (!type) {
      return err('invalid_state', `Evento Woovi não suportado: ${payload.event}`)
    }

    const charge = payload.charge
    if (!charge?.correlationID && !charge?.transactionID) {
      return err('not_found', 'Webhook sem cobrança')
    }

    const providerChargeId =
      charge.correlationID ?? charge.transactionID ?? charge.globalID ?? ''
    const eventId = `${payload.event}:${providerChargeId}:${charge.paidAt ?? charge.status ?? ''}`
    if (this.processedEventIds.has(eventId)) {
      return err('duplicate_event', `Evento ${eventId} já processado`, {
        retryable: false,
      })
    }

    const tenantId =
      readAdditional(charge.additionalInfo, WOOVI_ADDITIONAL_TENANT) ?? this.tenantId
    const accountId =
      readAdditional(charge.additionalInfo, WOOVI_ADDITIONAL_ACCOUNT) ?? this.accountId

    if (tenantId !== this.tenantId) {
      return err('tenant_mismatch', 'Tenant do webhook não corresponde')
    }
    if (accountId !== this.accountId) {
      return err('account_mismatch', 'Conta do webhook não corresponde')
    }

    const amountCents = charge.value ?? 0
    if (!Number.isInteger(amountCents) || amountCents <= 0) {
      return err('amount_mismatch', 'Valor do webhook inválido')
    }

    this.processedEventIds.add(eventId)

    const event: ValidatedWebhookEvent = {
      eventId,
      type,
      providerChargeId,
      tenantId,
      accountId,
      amountCents,
      occurredAt: charge.paidAt ?? charge.expiresDate ?? new Date().toISOString(),
      chargeStatus: charge.status ? mapWooviChargeStatus(charge.status) : undefined,
    }

    if (payload.refund) {
      event.refund = {
        providerRefundId: payload.refund.correlationID ?? eventId,
        providerChargeId,
        tenantId,
        accountId,
        amountCents: payload.refund.value ?? amountCents,
        status: mapWooviRefundStatus(payload.refund.status ?? 'IN_PROCESSING'),
        createdAt: payload.refund.time ?? event.occurredAt,
        updatedAt: payload.refund.time ?? event.occurredAt,
      }
    }

    return ok(event)
  }

  async requestRefund(input: RequestRefundInput): Promise<PixResult<PixRefund>> {
    const amountError = assertPositiveCents(input.amountCents)
    if (amountError) return err('invalid_state', amountError)
    if (input.tenantId !== this.tenantId) {
      return err('tenant_mismatch', 'Tenant do estorno não corresponde')
    }
    if (input.accountId !== this.accountId) {
      return err('account_mismatch', 'Conta do estorno não corresponde')
    }

    try {
      const res = await withTimeout(
        this.fetchImpl(
          `${this.baseUrl}/api/v1/charge/${encodeURIComponent(input.providerChargeId)}/refund`,
          {
            method: 'POST',
            headers: this.headers(),
            body: JSON.stringify({
              correlationID: input.idempotencyKey,
              value: input.amountCents,
              comment: input.reason?.slice(0, 140),
            }),
          },
        ),
        this.timeoutMs,
      )
      if (res.status === 401 || res.status === 403) {
        return err('invalid_signature', 'Credencial Woovi inválida ou revogada')
      }
      if (!res.ok) {
        return err('refund_failed', `Woovi refund HTTP ${res.status}`, {
          retryable: res.status >= 500,
        })
      }
      const json = (await res.json()) as { refund?: WooviRefundJson }
      const refund = json.refund ?? {}
      const now = new Date().toISOString()
      return ok({
        providerRefundId: refund.correlationID ?? input.idempotencyKey,
        providerChargeId: input.providerChargeId,
        tenantId: input.tenantId,
        accountId: input.accountId,
        amountCents: refund.value ?? input.amountCents,
        status: mapWooviRefundStatus(refund.status ?? 'IN_PROCESSING'),
        createdAt: refund.time ?? now,
        updatedAt: refund.time ?? now,
      })
    } catch (e) {
      if (e instanceof Error && e.message === 'timeout') {
        return err('timeout', 'Timeout ao pedir estorno Woovi', {
          uncertain: true,
          retryable: true,
        })
      }
      return err('refund_failed', 'Falha de rede no estorno Woovi', { retryable: true })
    }
  }

  async getRefund(providerRefundId: string): Promise<PixResult<PixRefund>> {
    // Woovi não expõe GET refund isolado estável; devolve not_found para forçar reconciliação via webhook.
    return err(
      'not_found',
      `Consulta de estorno ${providerRefundId} via webhook/reconciliação (#39)`,
    )
  }

  private headers(): Record<string, string> {
    return {
      Authorization: this.appId,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    }
  }

  private toPixCharge(
    charge: WooviChargeJson,
    input?: CreateChargeInput,
  ): PixCharge {
    const externalReference =
      charge.correlationID ?? input?.externalReference ?? ''
    const amountCents = charge.value ?? input?.amountCents ?? 0
    const tenantId =
      readAdditional(charge.additionalInfo, WOOVI_ADDITIONAL_TENANT) ??
      input?.tenantId ??
      this.tenantId
    const accountId =
      readAdditional(charge.additionalInfo, WOOVI_ADDITIONAL_ACCOUNT) ??
      input?.accountId ??
      this.accountId
    const status = mapWooviChargeStatus(charge.status ?? 'ACTIVE')
    return {
      providerChargeId: externalReference || charge.transactionID || charge.globalID || '',
      tenantId,
      accountId,
      amountCents,
      status,
      externalReference,
      pixCopyPaste: charge.brCode ?? '',
      expiresAt: charge.expiresDate ?? new Date().toISOString(),
      createdAt: charge.createdAt ?? new Date().toISOString(),
      paidAt: charge.paidAt,
      cancelledAt: status === 'cancelled' ? new Date().toISOString() : undefined,
    }
  }
}
