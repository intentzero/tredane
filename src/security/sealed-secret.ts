/**
 * Cifra autenticada de segredos de terceiros em repouso (revisão de segurança A2).
 *
 * Formato actual: `v2:<iv b64url>.<ciphertext+tag b64url>` — AES-256-GCM via
 * WebCrypto, IV aleatório de 96 bits por valor, AAD `tredane:<purpose>:v2`.
 * Chave derivada (HKDF-SHA256) de `TOKEN_ENCRYPTION_KEY`, com `info` por
 * finalidade (`wa` = tokens Meta, `pix` = App ID Woovi).
 *
 * Legado (só leitura, migração): `v1:<hex>` = XOR com SHA-256(`tredane-<purpose>-v1:<secret>`),
 * onde secret = META_TOKEN_SECRET ?? META_APP_SECRET (wa) ou PIX_TOKEN_SECRET (pix).
 * Escritas produzem sempre `v2:`; um valor `v1:` é re-cifrado na próxima escrita.
 *
 * `synth:<plaintext>` só é aceite fora de staging/production e sem chave
 * configurada (desenvolvimento/CI com fixtures sintéticas). Em staging/production
 * (`strict`) a ausência de chave falha fechado, tanto a cifrar como a decifrar.
 */

export type SealPurpose = 'wa' | 'pix'
export type SealMode = 'synthetic' | 'sandbox' | 'live'

export type SealKeys = {
  /** TOKEN_ENCRYPTION_KEY (≥ 32 caracteres). */
  key?: string
  /** Segredo da cifra XOR legada (`v1:`), apenas para decifrar. */
  legacySecret?: string
  /** staging/production: sem fallback em claro. */
  strict?: boolean
}

export const TOKEN_ENCRYPTION_KEY_MIN_LENGTH = 32
export const CURRENT_SEAL_PREFIX = 'v2:'

export class SealError extends Error {
  constructor(
    readonly code:
      | 'token_encryption_key_missing'
      | 'token_encryption_key_weak'
      | 'token_seal_invalid'
      | 'token_seal_unknown'
      | 'token_legacy_secret_missing'
      | 'token_synthetic_rejected',
  ) {
    super(code)
    this.name = 'SealError'
  }
}

const STRICT_ENVS = new Set(['staging', 'production'])

export function isStrictEnvironment(environment: string | undefined): boolean {
  return STRICT_ENVS.has((environment ?? '').trim().toLowerCase())
}

type MetaKeyEnv = {
  TOKEN_ENCRYPTION_KEY?: string
  META_TOKEN_SECRET?: string
  META_APP_SECRET?: string
  ENVIRONMENT?: string
}
type PixKeyEnv = { TOKEN_ENCRYPTION_KEY?: string; PIX_TOKEN_SECRET?: string; ENVIRONMENT?: string }

export function metaSealKeys(env: MetaKeyEnv): SealKeys {
  return {
    key: env.TOKEN_ENCRYPTION_KEY,
    legacySecret: env.META_TOKEN_SECRET ?? env.META_APP_SECRET,
    strict: isStrictEnvironment(env.ENVIRONMENT),
  }
}

export function pixSealKeys(env: PixKeyEnv): SealKeys {
  return {
    key: env.TOKEN_ENCRYPTION_KEY,
    legacySecret: env.PIX_TOKEN_SECRET,
    strict: isStrictEnvironment(env.ENVIRONMENT),
  }
}

export function isCurrentSeal(sealed: string): boolean {
  return sealed.startsWith(CURRENT_SEAL_PREFIX)
}

function b64url(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromB64url(text: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) throw new SealError('token_seal_invalid')
  const pad = text.length % 4 === 0 ? '' : '='.repeat(4 - (text.length % 4))
  const bin = atob(text.replace(/-/g, '+').replace(/_/g, '/') + pad)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

function usableKey(keys: SealKeys): string | null {
  const key = keys.key?.trim()
  if (!key) return null
  if (key.length < TOKEN_ENCRYPTION_KEY_MIN_LENGTH) throw new SealError('token_encryption_key_weak')
  return key
}

async function deriveAesKey(secret: string, purpose: SealPurpose): Promise<CryptoKey> {
  const enc = new TextEncoder()
  const ikm = await crypto.subtle.importKey('raw', enc.encode(secret), 'HKDF', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: enc.encode('tredane-token-seal'),
      info: enc.encode(`tredane-${purpose}-v2`),
    },
    ikm,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

function aad(purpose: SealPurpose): Uint8Array<ArrayBuffer> {
  return new Uint8Array(new TextEncoder().encode(`tredane:${purpose}:v2`))
}

export async function sealSecret(
  purpose: SealPurpose,
  plaintext: string,
  keys: SealKeys,
  mode: SealMode,
): Promise<string> {
  const key = usableKey(keys)
  if (!key) {
    if (mode === 'synthetic' && !keys.strict) return `synth:${plaintext}`
    throw new SealError('token_encryption_key_missing')
  }
  const aes = await deriveAesKey(key, purpose)
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: aad(purpose) },
    aes,
    new TextEncoder().encode(plaintext),
  )
  return `${CURRENT_SEAL_PREFIX}${b64url(iv)}.${b64url(new Uint8Array(ct))}`
}

async function openLegacyXor(purpose: SealPurpose, hex: string, secret: string): Promise<string> {
  if (hex.length % 2 !== 0 || !/^[0-9a-f]*$/i.test(hex)) throw new SealError('token_seal_invalid')
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`tredane-${purpose}-v1:${secret}`),
  )
  const k = new Uint8Array(digest)
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < out.length; i++) {
    out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16) ^ k[i % k.length]!
  }
  return new TextDecoder().decode(out)
}

export async function openSecret(
  purpose: SealPurpose,
  sealed: string,
  keys: SealKeys,
): Promise<string> {
  if (sealed.startsWith(CURRENT_SEAL_PREFIX)) {
    const key = usableKey(keys)
    if (!key) throw new SealError('token_encryption_key_missing')
    const [ivPart, ctPart, extra] = sealed.slice(CURRENT_SEAL_PREFIX.length).split('.')
    if (!ivPart || !ctPart || extra !== undefined) throw new SealError('token_seal_invalid')
    const iv = fromB64url(ivPart)
    if (iv.length !== 12) throw new SealError('token_seal_invalid')
    const aes = await deriveAesKey(key, purpose)
    try {
      const pt = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv, additionalData: aad(purpose) },
        aes,
        fromB64url(ctPart),
      )
      return new TextDecoder('utf-8', { fatal: true }).decode(pt)
    } catch {
      throw new SealError('token_seal_invalid')
    }
  }
  if (sealed.startsWith('v1:')) {
    const legacy = keys.legacySecret?.trim()
    if (!legacy) throw new SealError('token_legacy_secret_missing')
    return openLegacyXor(purpose, sealed.slice(3), legacy)
  }
  if (sealed.startsWith('synth:')) {
    if (keys.strict) throw new SealError('token_synthetic_rejected')
    return sealed.slice('synth:'.length)
  }
  throw new SealError('token_seal_unknown')
}
