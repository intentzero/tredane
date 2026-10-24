/**
 * VAPID para Web Push (#42).
 * Synthetic: chaves estáveis de teste (não usar em staging/prod).
 * Live: VAPID_* via env / wrangler secret.
 */

/** Par estável só para CI / AUTH_MODE-style synthetic (não é segredo de produção). */
export const SYNTHETIC_VAPID_PUBLIC_KEY =
  'BALIO4JBk9PGQZcmBfTAZit11wrJxlMDZ7t7REawkPdWJKFmQ6J2Vn5UlRNoiDHbzT791SVMB1bbwgfdksK7dAo'

export const SYNTHETIC_VAPID_PRIVATE_KEY = 'ek1mJ1OEt0tV5d-ZYo20UZN2qwEIyt6iGavQeF6dmaI'

export const SYNTHETIC_VAPID_SUBJECT = 'mailto:push-synthetic@tredane.local'

export type PushMode = 'synthetic' | 'live'

export type VapidConfig = {
  mode: PushMode
  subject: string
  publicKey: string
  privateKey: string
}

export function resolvePushMode(env?: {
  ENVIRONMENT?: string
  PUSH_MODE?: string
  VAPID_PUBLIC_KEY?: string
  VAPID_PRIVATE_KEY?: string
} | null): PushMode {
  const requested = (env?.PUSH_MODE ?? '').trim().toLowerCase()
  if (requested === 'live') return 'live'
  if (requested === 'synthetic') return 'synthetic'
  // staging/production sem chaves → synthetic (não bloqueia CI); live exige chaves.
  if (env?.VAPID_PUBLIC_KEY && env?.VAPID_PRIVATE_KEY) return 'live'
  return 'synthetic'
}

export function resolveVapidConfig(env?: {
  ENVIRONMENT?: string
  PUSH_MODE?: string
  VAPID_PUBLIC_KEY?: string
  VAPID_PRIVATE_KEY?: string
  VAPID_SUBJECT?: string
} | null): VapidConfig {
  const mode = resolvePushMode(env)
  if (mode === 'live') {
    const publicKey = env?.VAPID_PUBLIC_KEY?.trim()
    const privateKey = env?.VAPID_PRIVATE_KEY?.trim()
    if (!publicKey || !privateKey) {
      throw new Error('vapid_keys_required')
    }
    return {
      mode,
      subject: env?.VAPID_SUBJECT?.trim() || 'mailto:ops@tredane.app',
      publicKey,
      privateKey,
    }
  }
  return {
    mode: 'synthetic',
    subject: SYNTHETIC_VAPID_SUBJECT,
    publicKey: SYNTHETIC_VAPID_PUBLIC_KEY,
    privateKey: SYNTHETIC_VAPID_PRIVATE_KEY,
  }
}
