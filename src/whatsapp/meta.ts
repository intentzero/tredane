/**
 * Adaptador Meta Embedded Signup (#31).
 * Default: synthetic (fixtures). Live: troca de código Graph API.
 * App Review / WABA real = gates humanos (#18) — não exigidos aqui.
 */
import type { MetaMode, MetaTokenExchangeResult } from './types'

export type MetaAdapter = {
  mode: MetaMode
  exchangeSignupCode(input: {
    code: string
    phoneNumberId: string
    wabaId: string
    displayPhone?: string | null
    displayName?: string | null
  }): Promise<MetaTokenExchangeResult>
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

export function graphApiVersion(env: MetaEnv): string {
  return (env.META_GRAPH_API_VERSION ?? 'v25.0').trim() || 'v25.0'
}

/** Fixture: código válido troca para os IDs pedidos (unicidade testada no serviço). */
const SYNTH_OK = 'synth_code_valid'
const SYNTH_FORGED = 'synth_code_forged'
const SYNTH_EXPIRED = 'synth_code_expired'

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
  }
}

export function createLiveMetaAdapter(env: MetaEnv): MetaAdapter {
  const appId = env.META_APP_ID!
  const appSecret = env.META_APP_SECRET!
  const version = graphApiVersion(env)

  return {
    mode: 'live',
    async exchangeSignupCode(input) {
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
  }
}

export function createMetaAdapter(env: MetaEnv): MetaAdapter {
  const mode = resolveMetaMode(env)
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
