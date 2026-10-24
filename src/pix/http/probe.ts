/**
 * Prova de chamada HTTP com `fetch` (API disponível em Cloudflare Workers).
 * Não movimenta dinheiro: apenas confirma que o Worker/runtime consegue
 * criar cobrança, consultar, cancelar e reconciliar contra um endpoint HTTP.
 */

export type ProbeCharge = {
  id: string
  tenantId: string
  accountId: string
  amountCents: number
  status: 'awaiting_payment' | 'paid' | 'expired' | 'cancelled'
  externalReference: string
  expiresAt: string
}

export type ProbeClientOptions = {
  baseUrl: string
  fetchImpl?: typeof fetch
  /** Atraso artificial para testar timeout do cliente. */
  timeoutMs?: number
}

export type ProbeResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: 'timeout' | 'http_error' | 'uncertain'; message: string }

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

/**
 * Cliente HTTP mínimo alinhado ao contrato Pix (sem SDK Node).
 * Usado só para evidência F0 de conectividade Workers → provedor via fetch.
 */
export class PixHttpProbeClient {
  private readonly baseUrl: string
  private readonly fetchImpl: typeof fetch
  private readonly timeoutMs?: number

  constructor(options: ProbeClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '')
    this.fetchImpl = options.fetchImpl ?? fetch
    this.timeoutMs = options.timeoutMs
  }

  async createCharge(input: {
    tenantId: string
    accountId: string
    amountCents: number
    expiresInSeconds: number
    idempotencyKey: string
    externalReference: string
  }): Promise<ProbeResult<ProbeCharge>> {
    try {
      const response = await withTimeout(
        this.fetchImpl(`${this.baseUrl}/charges`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'idempotency-key': input.idempotencyKey,
          },
          body: JSON.stringify(input),
        }),
        this.timeoutMs,
      )
      if (!response.ok) {
        return {
          ok: false,
          code: 'http_error',
          message: `HTTP ${response.status}`,
        }
      }
      return { ok: true, value: (await response.json()) as ProbeCharge }
    } catch (error) {
      if (error instanceof Error && error.message === 'timeout') {
        return {
          ok: false,
          code: 'timeout',
          message: 'Timeout na chamada HTTP de criação',
        }
      }
      return {
        ok: false,
        code: 'uncertain',
        message: 'Falha de rede com resultado incerto; reconciliar',
      }
    }
  }

  async getCharge(id: string): Promise<ProbeResult<ProbeCharge>> {
    try {
      const response = await withTimeout(
        this.fetchImpl(`${this.baseUrl}/charges/${encodeURIComponent(id)}`),
        this.timeoutMs,
      )
      if (response.status === 404) {
        return { ok: false, code: 'http_error', message: 'not_found' }
      }
      if (!response.ok) {
        return { ok: false, code: 'http_error', message: `HTTP ${response.status}` }
      }
      return { ok: true, value: (await response.json()) as ProbeCharge }
    } catch {
      return {
        ok: false,
        code: 'uncertain',
        message: 'Falha ao consultar cobrança; tentar de novo',
      }
    }
  }

  async cancelCharge(id: string): Promise<ProbeResult<ProbeCharge>> {
    try {
      const response = await withTimeout(
        this.fetchImpl(`${this.baseUrl}/charges/${encodeURIComponent(id)}/cancel`, {
          method: 'POST',
        }),
        this.timeoutMs,
      )
      if (!response.ok) {
        return { ok: false, code: 'http_error', message: `HTTP ${response.status}` }
      }
      return { ok: true, value: (await response.json()) as ProbeCharge }
    } catch {
      return {
        ok: false,
        code: 'uncertain',
        message: 'Cancelamento com resultado incerto; consultar estado',
      }
    }
  }
}
