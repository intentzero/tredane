/**
 * Validação de x-webhook-signature (RSA-SHA256) — Web Crypto / Workers.
 * Chaves públicas: GET /api/v1/webhook/public-keys (cacheáveis).
 */

function pemToSpki(pem: string): ArrayBuffer {
  const b64 = pem
    .replace(/-----BEGIN PUBLIC KEY-----/g, '')
    .replace(/-----END PUBLIC KEY-----/g, '')
    .replace(/\s+/g, '')
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes.buffer
}

export async function importWooviPublicKey(pem: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'spki',
    pemToSpki(pem),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify'],
  )
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64.replace(/\s+/g, ''))
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

/**
 * Verifica assinatura RSA-SHA256 do corpo bruto.
 * Aceita qualquer chave da lista (rotação).
 */
export async function verifyWooviWebhookSignature(
  body: string,
  signatureBase64: string,
  publicKeyPems: readonly string[],
): Promise<boolean> {
  if (!signatureBase64 || publicKeyPems.length === 0) return false
  const data = new TextEncoder().encode(body)
  const signatureBytes = base64ToBytes(signatureBase64)
  const signature = new Uint8Array(signatureBytes).buffer
  for (const pem of publicKeyPems) {
    try {
      const key = await importWooviPublicKey(pem)
      const ok = await crypto.subtle.verify(
        { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
        key,
        signature,
        data,
      )
      if (ok) return true
    } catch {
      /* tenta próxima chave */
    }
  }
  return false
}

export type WooviPublicKeyEntry = {
  key_identifier: string
  is_current: boolean
  key: string
}

export type PublicKeyCache = {
  keys: WooviPublicKeyEntry[]
  fetchedAtMs: number
}

const DEFAULT_TTL_MS = 60 * 60 * 1000

export async function fetchWooviPublicKeys(
  baseUrl: string,
  fetchImpl: typeof fetch = fetch,
  cache?: { current: PublicKeyCache | null; ttlMs?: number; nowMs?: number },
): Promise<string[]> {
  const now = cache?.nowMs ?? Date.now()
  const ttl = cache?.ttlMs ?? DEFAULT_TTL_MS
  if (cache?.current && now - cache.current.fetchedAtMs < ttl) {
    return cache.current.keys.map((k) => k.key)
  }
  const url = `${baseUrl.replace(/\/$/, '')}/api/v1/webhook/public-keys`
  const res = await fetchImpl(url)
  if (!res.ok) {
    if (cache?.current?.keys.length) {
      return cache.current.keys.map((k) => k.key)
    }
    throw new Error(`woovi_public_keys_http_${res.status}`)
  }
  const json = (await res.json()) as { public_keys?: WooviPublicKeyEntry[] }
  const keys = json.public_keys ?? []
  if (cache) {
    cache.current = { keys, fetchedAtMs: now }
  }
  return keys.map((k) => k.key)
}

/** Assina corpo com chave privada (só fixtures/testes). */
export async function signWooviWebhookBody(
  body: string,
  privateKey: CryptoKey,
): Promise<string> {
  const data = new TextEncoder().encode(body)
  const sig = await crypto.subtle.sign(
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    privateKey,
    data,
  )
  const bytes = new Uint8Array(sig)
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary)
}

export async function generateWooviTestKeyPair(): Promise<{
  publicKey: CryptoKey
  privateKey: CryptoKey
  publicPem: string
}> {
  const pair = await crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['sign', 'verify'],
  )
  const spki = await crypto.subtle.exportKey('spki', pair.publicKey)
  const bytes = new Uint8Array(spki)
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  const b64 = btoa(binary)
  const publicPem = `-----BEGIN PUBLIC KEY-----\n${b64.match(/.{1,64}/g)?.join('\n') ?? b64}\n-----END PUBLIC KEY-----\n`
  return {
    publicKey: pair.publicKey,
    privateKey: pair.privateKey,
    publicPem,
  }
}
