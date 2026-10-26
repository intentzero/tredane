/**
 * Verificação de webhook Meta Cloud API (#32 / REQ-050).
 * GET: hub.mode / hub.verify_token / hub.challenge
 * POST: X-Hub-Signature-256 = sha256=<HMAC-SHA256(rawBody, META_APP_SECRET)>
 * Usa o corpo original (bytes/string) antes de qualquer re-serialização.
 */
import { isDeployedEnv } from '../security/env-gate'

export type WebhookVerifyEnv = {
  META_MODE?: string
  META_APP_SECRET?: string
  META_VERIFY_TOKEN?: string
  /** staging/production: nunca há fallback sintético (fail closed). */
  ENVIRONMENT?: string
}

export const SYNTHETIC_VERIFY_TOKEN = 'tredane-synth-verify'
export const SYNTHETIC_APP_SECRET = 'tredane-synth-app-secret'

export function resolveMetaMode(env: WebhookVerifyEnv): 'synthetic' | 'live' {
  return env.META_MODE === 'live' ? 'live' : 'synthetic'
}

/** Webhook Meta só opera em staging/production com META_MODE=live (C3). */
export function isMetaWebhookDisabled(env: WebhookVerifyEnv): boolean {
  return isDeployedEnv(env) && resolveMetaMode(env) !== 'live'
}

export function resolveVerifyToken(env: WebhookVerifyEnv): string | null {
  if (isMetaWebhookDisabled(env)) return null
  if (env.META_VERIFY_TOKEN && env.META_VERIFY_TOKEN.length > 0) {
    return env.META_VERIFY_TOKEN
  }
  if (resolveMetaMode(env) === 'synthetic' && !isDeployedEnv(env)) return SYNTHETIC_VERIFY_TOKEN
  return null
}

export function resolveAppSecret(env: WebhookVerifyEnv): string | null {
  if (isMetaWebhookDisabled(env)) return null
  if (env.META_APP_SECRET && env.META_APP_SECRET.length > 0) {
    return env.META_APP_SECRET
  }
  if (resolveMetaMode(env) === 'synthetic' && !isDeployedEnv(env)) return SYNTHETIC_APP_SECRET
  return null
}

function timingSafeEqualUtf8(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  const ae = new TextEncoder().encode(a)
  const be = new TextEncoder().encode(b)
  let diff = 0
  for (let i = 0; i < ae.length; i++) {
    diff |= (ae[i] ?? 0) ^ (be[i] ?? 0)
  }
  return diff === 0
}

function toHex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export async function computeHubSignature256(
  rawBody: string,
  appSecret: string,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(appSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody))
  return `sha256=${toHex(sig)}`
}

export async function verifyHubSignature256(
  rawBody: string,
  signatureHeader: string | null | undefined,
  appSecret: string,
): Promise<boolean> {
  if (!signatureHeader || !signatureHeader.startsWith('sha256=')) return false
  const expected = await computeHubSignature256(rawBody, appSecret)
  return timingSafeEqualUtf8(signatureHeader, expected)
}

export type ChallengeResult =
  | { ok: true; challenge: string }
  | { ok: false; reason: 'missing_params' | 'token_mismatch' | 'token_unconfigured' | 'wrong_mode' }

/**
 * Validação do challenge de subscrição Meta.
 * Em sucesso devolve o challenge em texto puro (HTTP 200).
 */
export function verifySubscriptionChallenge(
  params: {
    mode: string | null
    token: string | null
    challenge: string | null
  },
  env: WebhookVerifyEnv,
): ChallengeResult {
  if (params.mode !== 'subscribe') {
    return { ok: false, reason: 'wrong_mode' }
  }
  if (!params.token || !params.challenge) {
    return { ok: false, reason: 'missing_params' }
  }
  const expected = resolveVerifyToken(env)
  if (!expected) {
    return { ok: false, reason: 'token_unconfigured' }
  }
  if (!timingSafeEqualUtf8(params.token, expected)) {
    return { ok: false, reason: 'token_mismatch' }
  }
  return { ok: true, challenge: params.challenge }
}
