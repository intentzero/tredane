/**
 * Fixture HTTP sintética no formato Woovi — CI sem conta live.
 * injectável via `fetchImpl` no WooviPixAdapter.
 */

import {
  generateWooviTestKeyPair,
  signWooviWebhookBody,
} from './webhook'
import {
  WOOVI_ADDITIONAL_ACCOUNT,
  WOOVI_ADDITIONAL_TENANT,
} from './map'

type StoredCharge = {
  correlationID: string
  value: number
  status: 'ACTIVE' | 'COMPLETED' | 'EXPIRED'
  brCode: string
  expiresDate: string
  createdAt: string
  paidAt?: string
  additionalInfo: Array<{ key: string; value: string }>
  appId: string
}

type StoredRefund = {
  correlationID: string
  chargeCorrelationID: string
  value: number
  status: 'IN_PROCESSING' | 'CONFIRMED' | 'REJECTED'
  time: string
}

export type WooviSandboxOptions = {
  /** App IDs válidos; outros → 401. */
  validAppIds?: Set<string>
  /** App IDs revogados → 401 após estarem na lista. */
  revokedAppIds?: Set<string>
  now?: () => Date
}

export type WooviSandboxFixture = {
  baseUrl: string
  publicPem: string
  privateKey: CryptoKey
  fetchImpl: typeof fetch
  revokeAppId(appId: string): void
  addValidAppId(appId: string): void
  getCharge(correlationID: string): StoredCharge | undefined
  listChargesForApp(appId: string): StoredCharge[]
  /** Marca paga e devolve envelope assinado. */
  simulatePayment(
    correlationID: string,
  ): Promise<{ body: string; headers: Record<string, string> }>
  simulateExpiration(
    correlationID: string,
  ): Promise<{ body: string; headers: Record<string, string> }>
}

export async function createWooviSandboxFixture(
  options: WooviSandboxOptions = {},
): Promise<WooviSandboxFixture> {
  const validAppIds = options.validAppIds ?? new Set<string>(['synth_woovi_app_valid'])
  const revokedAppIds = options.revokedAppIds ?? new Set<string>()
  const now = options.now ?? (() => new Date())
  const { publicPem, privateKey } = await generateWooviTestKeyPair()
  const charges = new Map<string, StoredCharge>()
  const refunds = new Map<string, StoredRefund>()
  const baseUrl = 'https://api.woovi-sandbox.test'

  function authorize(req: Request): boolean {
    const appId = req.headers.get('Authorization') ?? ''
    if (!appId) return false
    if (revokedAppIds.has(appId)) return false
    return validAppIds.has(appId)
  }

  function json(data: unknown, status = 200): Response {
    return new Response(JSON.stringify(data), {
      status,
      headers: { 'content-type': 'application/json' },
    })
  }

  const fetchImpl: typeof fetch = async (input, init) => {
    const req = new Request(input, init)
    const url = new URL(req.url)

    if (url.pathname === '/api/v1/webhook/public-keys') {
      return json({
        public_keys: [
          {
            key_identifier: 'sandbox-fixture',
            is_current: true,
            key: publicPem,
          },
        ],
      })
    }

    if (!authorize(req) && url.pathname.startsWith('/api/v1/')) {
      return json({ error: 'Unauthorized' }, 401)
    }

    const appId = req.headers.get('Authorization') ?? ''

    if (url.pathname === '/api/v1/charge' && req.method === 'GET') {
      const list = [...charges.values()].filter((c) => c.appId === appId)
      return json({ charges: list.slice(0, 1) })
    }

    if (url.pathname === '/api/v1/charge' && req.method === 'POST') {
      const body = (await req.json()) as {
        correlationID: string
        value: number
        expiresIn?: number
        additionalInfo?: Array<{ key: string; value: string }>
      }
      const existing = charges.get(body.correlationID)
      if (existing) {
        return json({ charge: existing })
      }
      const createdAt = now().toISOString()
      const expiresIn = body.expiresIn ?? 7200
      const charge: StoredCharge = {
        correlationID: body.correlationID,
        value: body.value,
        status: 'ACTIVE',
        brCode: `00020126SANDBOX${body.correlationID}52040000530398654${(body.value / 100).toFixed(2)}5802BR`,
        expiresDate: new Date(now().getTime() + expiresIn * 1000).toISOString(),
        createdAt,
        additionalInfo: body.additionalInfo ?? [],
        appId,
      }
      charges.set(charge.correlationID, charge)
      return json({ charge }, 201)
    }

    const chargeMatch = /^\/api\/v1\/charge\/([^/]+)$/.exec(url.pathname)
    if (chargeMatch) {
      const id = decodeURIComponent(chargeMatch[1]!)
      const charge = charges.get(id)
      if (req.method === 'GET') {
        if (!charge || charge.appId !== appId) return json({ error: 'Not found' }, 404)
        return json({ charge })
      }
      if (req.method === 'DELETE') {
        if (!charge || charge.appId !== appId) return json({ error: 'Not found' }, 404)
        if (charge.status === 'COMPLETED') {
          return json({ error: 'Cannot delete paid charge' }, 400)
        }
        charge.status = 'EXPIRED'
        return json({ charge })
      }
    }

    const refundMatch = /^\/api\/v1\/charge\/([^/]+)\/refund$/.exec(url.pathname)
    if (refundMatch && req.method === 'POST') {
      const chargeId = decodeURIComponent(refundMatch[1]!)
      const charge = charges.get(chargeId)
      if (!charge || charge.appId !== appId) return json({ error: 'Not found' }, 404)
      if (charge.status !== 'COMPLETED') {
        return json({ error: 'Charge not paid' }, 400)
      }
      const body = (await req.json()) as {
        correlationID: string
        value?: number
        comment?: string
      }
      const existing = refunds.get(body.correlationID)
      if (existing) return json({ refund: existing })
      const refund: StoredRefund = {
        correlationID: body.correlationID,
        chargeCorrelationID: chargeId,
        value: body.value ?? charge.value,
        status: 'CONFIRMED',
        time: now().toISOString(),
      }
      refunds.set(refund.correlationID, refund)
      return json({ refund })
    }

    return json({ error: 'Not found' }, 404)
  }

  async function signedEnvelope(payload: unknown) {
    const body = JSON.stringify(payload)
    const signature = await signWooviWebhookBody(body, privateKey)
    return {
      body,
      headers: {
        'x-webhook-signature': signature,
        'content-type': 'application/json',
      },
    }
  }

  return {
    baseUrl,
    publicPem,
    privateKey,
    fetchImpl,
    revokeAppId(appId: string) {
      revokedAppIds.add(appId)
      validAppIds.delete(appId)
    },
    addValidAppId(appId: string) {
      validAppIds.add(appId)
      revokedAppIds.delete(appId)
    },
    getCharge(correlationID: string) {
      return charges.get(correlationID)
    },
    listChargesForApp(appId: string) {
      return [...charges.values()].filter((c) => c.appId === appId)
    },
    async simulatePayment(correlationID: string) {
      const charge = charges.get(correlationID)
      if (!charge) throw new Error('charge_not_found')
      charge.status = 'COMPLETED'
      charge.paidAt = now().toISOString()
      return signedEnvelope({
        event: 'OPENPIX:CHARGE_COMPLETED',
        charge: {
          correlationID: charge.correlationID,
          value: charge.value,
          status: charge.status,
          brCode: charge.brCode,
          expiresDate: charge.expiresDate,
          createdAt: charge.createdAt,
          paidAt: charge.paidAt,
          additionalInfo: charge.additionalInfo,
        },
      })
    },
    async simulateExpiration(correlationID: string) {
      const charge = charges.get(correlationID)
      if (!charge) throw new Error('charge_not_found')
      charge.status = 'EXPIRED'
      return signedEnvelope({
        event: 'OPENPIX:CHARGE_EXPIRED',
        charge: {
          correlationID: charge.correlationID,
          value: charge.value,
          status: charge.status,
          brCode: charge.brCode,
          expiresDate: charge.expiresDate,
          createdAt: charge.createdAt,
          additionalInfo: charge.additionalInfo,
        },
      })
    },
  }
}

/** Garante additionalInfo mínimo para testes de domínio. */
export function sandboxAdditional(tenantId: string, accountId: string) {
  return [
    { key: WOOVI_ADDITIONAL_TENANT, value: tenantId },
    { key: WOOVI_ADDITIONAL_ACCOUNT, value: accountId },
  ]
}
