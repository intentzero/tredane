/**
 * Validação de webhook Pix na borda do Worker (#39).
 * Assinatura RSA (Woovi) ou HMAC sintético; extrai tenant/conta de additionalInfo.
 * Não aplica regras de agenda — isso fica no Clinic DO.
 */
import {
  mapWooviChargeStatus,
  mapWooviWebhookEvent,
  readAdditional,
  WOOVI_ADDITIONAL_ACCOUNT,
  WOOVI_ADDITIONAL_TENANT,
} from './woovi/map'
import {
  fetchWooviPublicKeys,
  type PublicKeyCache,
  verifyWooviWebhookSignature,
} from './woovi/webhook'
import { signSimulatedWebhook } from './simulated/adapter'
import type {
  PixResult,
  RawWebhookEnvelope,
  ValidatedWebhookEvent,
  WebhookEventType,
} from './types'

function err(
  code: import('./types').PixProviderErrorCode,
  message: string,
  extra?: { retryable?: boolean },
): PixResult<never> {
  return { ok: false, code, message, ...extra }
}

async function timingSafeEqualHex(a: string, b: string): Promise<boolean> {
  if (a.length !== b.length) return false
  const enc = new TextEncoder()
  const aa = enc.encode(a)
  const bb = enc.encode(b)
  let diff = 0
  for (let i = 0; i < aa.length; i++) diff |= aa[i]! ^ bb[i]!
  return diff === 0
}

export type PixWebhookValidateOptions = {
  /** PEM Woovi (testes / cache injectável). */
  publicKeyPems?: string[]
  baseUrl?: string
  fetchImpl?: typeof fetch
  publicKeyCache?: { current: PublicKeyCache | null; ttlMs?: number }
  /** PIX_MODE=synthetic — aceita x-tredane-pix-signature. */
  allowSynthetic?: boolean
  syntheticWebhookSecret?: string
}

/**
 * Valida assinatura e normaliza evento. Tenant/conta vêm de additionalInfo
 * (tredaneTenantId / tredaneAccountId) gravados na criação da cobrança.
 */
export async function validatePixWebhookEnvelope(
  envelope: RawWebhookEnvelope,
  options: PixWebhookValidateOptions = {},
): Promise<PixResult<ValidatedWebhookEvent>> {
  const wooviSig =
    envelope.headers['x-webhook-signature'] ??
    envelope.headers['X-Webhook-Signature']
  const synthSig =
    envelope.headers['x-tredane-pix-signature'] ??
    envelope.headers['X-Tredane-Pix-Signature']

  if (wooviSig) {
    let pems = options.publicKeyPems
    if (!pems?.length) {
      if (!options.baseUrl) {
        return err('provider_unavailable', 'Chaves públicas Woovi não configuradas', {
          retryable: true,
        })
      }
      try {
        pems = await fetchWooviPublicKeys(
          options.baseUrl,
          options.fetchImpl ?? fetch,
          options.publicKeyCache,
        )
      } catch {
        return err(
          'provider_unavailable',
          'Não foi possível obter chaves públicas Woovi',
          { retryable: true },
        )
      }
    }
    const valid = await verifyWooviWebhookSignature(envelope.body, wooviSig, pems)
    if (!valid) {
      return err('invalid_signature', 'Assinatura de webhook inválida')
    }
    return parseWooviBody(envelope.body)
  }

  if (options.allowSynthetic && synthSig) {
    const secret = options.syntheticWebhookSecret ?? 'synth-pix-webhook-secret'
    const expected = await signSimulatedWebhook(envelope.body, secret)
    if (!(await timingSafeEqualHex(synthSig, expected))) {
      return err('invalid_signature', 'Assinatura sintética inválida')
    }
    return parseSyntheticBody(envelope.body)
  }

  return err('invalid_signature', 'Assinatura de webhook ausente')
}

function parseWooviBody(body: string): PixResult<ValidatedWebhookEvent> {
  let payload: {
    event?: string
    charge?: {
      correlationID?: string
      transactionID?: string
      globalID?: string
      value?: number
      status?: string
      paidAt?: string
      expiresDate?: string
      additionalInfo?: Array<{ key?: string; value?: string }>
    }
  }
  try {
    payload = JSON.parse(body) as typeof payload
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

  const tenantId = readAdditional(charge.additionalInfo, WOOVI_ADDITIONAL_TENANT)
  const accountId = readAdditional(charge.additionalInfo, WOOVI_ADDITIONAL_ACCOUNT)
  if (!tenantId) {
    return err('tenant_mismatch', 'Webhook sem tredaneTenantId em additionalInfo')
  }
  if (!accountId) {
    return err('account_mismatch', 'Webhook sem tredaneAccountId em additionalInfo')
  }

  const amountCents = charge.value ?? 0
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    return err('amount_mismatch', 'Valor do webhook inválido')
  }

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
  return { ok: true, value: event }
}

function parseSyntheticBody(body: string): PixResult<ValidatedWebhookEvent> {
  let payload: {
    eventId?: string
    type?: WebhookEventType
    providerChargeId?: string
    tenantId?: string
    accountId?: string
    amountCents?: number
    occurredAt?: string
    chargeStatus?: ValidatedWebhookEvent['chargeStatus']
  }
  try {
    payload = JSON.parse(body) as typeof payload
  } catch {
    return err('invalid_state', 'Corpo de webhook sintético inválido')
  }
  if (
    !payload.eventId ||
    !payload.type ||
    !payload.providerChargeId ||
    !payload.tenantId ||
    !payload.accountId ||
    !payload.amountCents ||
    !payload.occurredAt
  ) {
    return err('invalid_state', 'Payload sintético incompleto')
  }
  return {
    ok: true,
    value: {
      eventId: payload.eventId,
      type: payload.type,
      providerChargeId: payload.providerChargeId,
      tenantId: payload.tenantId,
      accountId: payload.accountId,
      amountCents: payload.amountCents,
      occurredAt: payload.occurredAt,
      chargeStatus: payload.chargeStatus,
    },
  }
}
