/**
 * Adaptador Meta Embedded Signup (#31) + envio de mensagens (#33).
 * Default: synthetic (fixtures). Live: Graph API.
 * App Review / WABA real = gates humanos (#18) — não exigidos aqui.
 */
import type { MetaMode, MetaTokenExchangeResult } from './types'
import { createChannelLogger } from '../ops/log'

const metaSendLog = createChannelLogger('meta_send')

export type MetaSendTextInput = {
  phoneNumberId: string
  accessToken: string
  toWaId: string
  body: string
  /** Idempotency / client reference — synthetic usa para fixtures. */
  clientRequestId?: string
}

export type MetaSendTemplateInput = {
  phoneNumberId: string
  accessToken: string
  toWaId: string
  templateName: string
  language: string
  /** Ordem dos parâmetros do corpo (body components). */
  bodyParams: string[]
  clientRequestId?: string
}

export type MetaSendSuccess = {
  outcome: 'succeeded'
  providerMessageId: string
}

export type MetaSendFailed = {
  outcome: 'failed'
  errorCode: string
}

export type MetaSendUncertain = {
  outcome: 'uncertain'
  errorCode: string
}

export type MetaSendResult = MetaSendSuccess | MetaSendFailed | MetaSendUncertain

export type MetaAdapter = {
  mode: MetaMode
  exchangeSignupCode(input: {
    code: string
    phoneNumberId: string
    wabaId: string
    displayPhone?: string | null
    displayName?: string | null
  }): Promise<MetaTokenExchangeResult>
  sendTextMessage(input: MetaSendTextInput): Promise<MetaSendResult>
  sendTemplateMessage(input: MetaSendTemplateInput): Promise<MetaSendResult>
}

export type MetaEnv = {
  META_MODE?: string
  META_APP_ID?: string
  META_APP_SECRET?: string
  META_CONFIG_ID?: string
  META_GRAPH_API_VERSION?: string
  ENVIRONMENT?: string
}

export function resolveMetaMode(env: MetaEnv): MetaMode {
  const raw = (env.META_MODE ?? '').trim().toLowerCase()
  if (raw === 'live') {
    if (!env.META_APP_ID || !env.META_APP_SECRET || !env.META_CONFIG_ID) {
      throw new Error('meta_live_missing_credentials')
    }
    return 'live'
  }
  // Staging/production sem META_MODE=live ficam em synthetic (piloto / gates).
  return 'synthetic'
}

/**
 * Modo Meta para ENVIO e leitura de estado (sem Embedded Signup).
 *
 * Enviar exige só o token do vínculo + phone_number_id (por clínica, em D1);
 * META_CONFIG_ID só é necessário para o Embedded Signup. Por isso, com
 * META_MODE=live exige META_APP_ID + META_APP_SECRET mas NÃO META_CONFIG_ID.
 * Sem META_CONFIG_ID, `exchangeSignupCode` do adaptador live continua a falhar
 * fechado (ver createLiveMetaAdapter). Fluxos de Embedded Signup continuam a
 * usar `resolveMetaMode` (estrito).
 */
export function resolveMetaSendMode(env: MetaEnv): MetaMode {
  const raw = (env.META_MODE ?? '').trim().toLowerCase()
  if (raw === 'live') {
    if (!env.META_APP_ID || !env.META_APP_SECRET) {
      throw new Error('meta_live_missing_credentials')
    }
    return 'live'
  }
  return 'synthetic'
}

export function graphApiVersion(env: MetaEnv): string {
  return (env.META_GRAPH_API_VERSION ?? 'v25.0').trim() || 'v25.0'
}

/** Fixture: código válido troca para os IDs pedidos (unicidade testada no serviço). */
const SYNTH_OK = 'synth_code_valid'
const SYNTH_FORGED = 'synth_code_forged'
const SYNTH_EXPIRED = 'synth_code_expired'

function syntheticSendResult(marker: string | undefined, phoneNumberId: string): MetaSendResult {
  const m = (marker ?? '').toLowerCase()
  if (m.includes('timeout') || m.includes('uncertain')) {
    return { outcome: 'uncertain', errorCode: 'meta_timeout' }
  }
  if (m.includes('fail') || m.includes('reject')) {
    return { outcome: 'failed', errorCode: 'meta_send_rejected' }
  }
  const suffix = (marker ?? phoneNumberId).replace(/[^a-zA-Z0-9_-]/g, '').slice(-24) || 'ok'
  return { outcome: 'succeeded', providerMessageId: `wamid.synth_${suffix}` }
}

export function createSyntheticMetaAdapter(): MetaAdapter {
  return {
    mode: 'synthetic',
    async exchangeSignupCode(input) {
      if (input.code === SYNTH_FORGED || input.code === SYNTH_EXPIRED) {
        throw new MetaExchangeError(
          input.code === SYNTH_EXPIRED ? 'code_expired' : 'code_invalid',
          'Código de autorização Meta inválido ou expirado',
        )
      }
      if (input.code !== SYNTH_OK && !input.code.startsWith('synth_ok_')) {
        throw new MetaExchangeError(
          'code_invalid',
          'Código de autorização Meta inválido',
        )
      }
      const phoneNumberId = input.phoneNumberId.trim()
      const wabaId = input.wabaId.trim()
      if (!phoneNumberId || !wabaId) {
        throw new MetaExchangeError('missing_ids', 'phone_number_id e waba_id obrigatórios')
      }
      return {
        accessToken: `synth_token_${phoneNumberId}`,
        tokenType: 'bearer',
        expiresIn: null,
        phoneNumberId,
        wabaId,
        displayPhone: (input.displayPhone ?? `+1555${phoneNumberId.slice(-7)}`).trim(),
        displayName: input.displayName?.trim() || null,
      }
    },
    async sendTextMessage(input) {
      if (!input.accessToken || !input.phoneNumberId || !input.toWaId) {
        return { outcome: 'failed', errorCode: 'meta_send_invalid' }
      }
      // Fixtures: token/corpo/clientRequestId com marcadores controlam o resultado.
      const marker = `${input.clientRequestId ?? ''}|${input.body}|${input.accessToken}`
      return syntheticSendResult(marker, input.phoneNumberId)
    },
    async sendTemplateMessage(input) {
      if (!input.accessToken || !input.phoneNumberId || !input.toWaId) {
        return { outcome: 'failed', errorCode: 'meta_send_invalid' }
      }
      if (!input.templateName.trim()) {
        return { outcome: 'failed', errorCode: 'meta_template_missing' }
      }
      const marker = `${input.clientRequestId ?? ''}|${input.templateName}|${input.accessToken}`
      return syntheticSendResult(marker, input.phoneNumberId)
    },
  }
}

export type GraphErrorCodes = { code: number | null; subcode: number | null }

function asErrorInt(v: unknown): number | null {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < 1e9 ? v : null
}

/** Extrai só `error.code` / `error.error_subcode` (inteiros) da resposta Graph. */
export async function readGraphErrorCodes(res: Response): Promise<GraphErrorCodes> {
  try {
    const body = (await res.json()) as { error?: { code?: unknown; error_subcode?: unknown } }
    const err = body && typeof body === 'object' ? body.error : undefined
    return { code: asErrorInt(err?.code), subcode: asErrorInt(err?.error_subcode) }
  } catch {
    return { code: null, subcode: null }
  }
}

/** `meta_http_<status>[_<code>[_<subcode>]]`, ex.: `meta_http_400_131030`. */
export function metaHttpErrorCode(status: number, meta: GraphErrorCodes): string {
  let out = `meta_http_${status}`
  if (meta.code != null) {
    out += `_${meta.code}`
    if (meta.subcode != null) out += `_${meta.subcode}`
  }
  return out
}

async function liveGraphSend(
  version: string,
  phoneNumberId: string,
  accessToken: string,
  payload: Record<string, unknown>,
): Promise<MetaSendResult> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 15_000)
  try {
    const res = await fetch(
      `https://graph.facebook.com/${version}/${encodeURIComponent(phoneNumberId)}/messages`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      },
    )
    if (!res.ok) {
      const meta = await readGraphErrorCodes(res)
      const errorCode = metaHttpErrorCode(res.status, meta)
      // Só status/code/subcode numéricos — nunca corpo, token ou waId.
      metaSendLog({
        level: 'warn',
        event: 'meta.send_http_error',
        detail: {
          httpStatus: res.status,
          metaErrorCode: meta.code,
          metaErrorSubcode: meta.subcode,
        },
      })
      return { outcome: 'failed', errorCode }
    }
    const body = (await res.json()) as {
      messages?: Array<{ id?: string }>
    }
    const id = body.messages?.[0]?.id
    if (!id) {
      return { outcome: 'uncertain', errorCode: 'meta_missing_message_id' }
    }
    return { outcome: 'succeeded', providerMessageId: id }
  } catch (err) {
    const name = err instanceof Error ? err.name : ''
    if (name === 'AbortError') {
      return { outcome: 'uncertain', errorCode: 'meta_timeout' }
    }
    return { outcome: 'uncertain', errorCode: 'meta_network_error' }
  } finally {
    clearTimeout(timer)
  }
}

export function createLiveMetaAdapter(env: MetaEnv): MetaAdapter {
  const appId = env.META_APP_ID!
  const appSecret = env.META_APP_SECRET!
  const version = graphApiVersion(env)

  return {
    mode: 'live',
    async exchangeSignupCode(input) {
      // Embedded Signup falha fechado sem META_CONFIG_ID (adaptador construído
      // para envio/leitura via createMetaSendAdapter).
      if (!env.META_CONFIG_ID) {
        throw new Error('meta_live_missing_credentials')
      }
      const url = new URL(`https://graph.facebook.com/${version}/oauth/access_token`)
      url.searchParams.set('client_id', appId)
      url.searchParams.set('client_secret', appSecret)
      url.searchParams.set('code', input.code)

      const res = await fetch(url.toString(), { method: 'GET' })
      if (!res.ok) {
        throw new MetaExchangeError(
          'token_exchange_failed',
          'Falha ao trocar código Embedded Signup na Meta',
        )
      }
      const body = (await res.json()) as {
        access_token?: string
        token_type?: string
        expires_in?: number
      }
      if (!body.access_token) {
        throw new MetaExchangeError(
          'token_exchange_failed',
          'Resposta Meta sem access_token',
        )
      }

      // IDs vêm do evento WA_EMBEDDED_SIGNUP no cliente; validamos presença.
      const phoneNumberId = input.phoneNumberId.trim()
      const wabaId = input.wabaId.trim()
      if (!phoneNumberId || !wabaId) {
        throw new MetaExchangeError('missing_ids', 'phone_number_id e waba_id obrigatórios')
      }

      return {
        accessToken: body.access_token,
        tokenType: body.token_type ?? 'bearer',
        expiresIn: typeof body.expires_in === 'number' ? body.expires_in : null,
        phoneNumberId,
        wabaId,
        displayPhone: (input.displayPhone ?? phoneNumberId).trim(),
        displayName: input.displayName?.trim() || null,
      }
    },
    async sendTextMessage(input) {
      return liveGraphSend(version, input.phoneNumberId, input.accessToken, {
        messaging_product: 'whatsapp',
        to: input.toWaId,
        type: 'text',
        text: { preview_url: false, body: input.body },
      })
    },
    async sendTemplateMessage(input) {
      return liveGraphSend(version, input.phoneNumberId, input.accessToken, {
        messaging_product: 'whatsapp',
        to: input.toWaId,
        type: 'template',
        template: {
          name: input.templateName,
          language: { code: input.language },
          components: [
            {
              type: 'body',
              parameters: input.bodyParams.map((text) => ({ type: 'text', text })),
            },
          ],
        },
      })
    },
  }
}

export function createMetaAdapter(env: MetaEnv): MetaAdapter {
  const mode = resolveMetaMode(env)
  return mode === 'live' ? createLiveMetaAdapter(env) : createSyntheticMetaAdapter()
}

/**
 * Adaptador para envio (fila clinic_outbox) e leitura de estado do painel.
 * Não exige META_CONFIG_ID; Embedded Signup continua fail-closed sem ele.
 */
export function createMetaSendAdapter(env: MetaEnv): MetaAdapter {
  const mode = resolveMetaSendMode(env)
  return mode === 'live' ? createLiveMetaAdapter(env) : createSyntheticMetaAdapter()
}

export class MetaExchangeError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'MetaExchangeError'
    this.code = code
  }
}

export const SYNTHETIC_CODES = {
  valid: SYNTH_OK,
  forged: SYNTH_FORGED,
  expired: SYNTH_EXPIRED,
} as const
