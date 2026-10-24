/**
 * Tokens opacos de alta entropia. Apenas o hash SHA-256 (hex) é persistido.
 * Nunca registar o token em claro em logs, auditoria ou metadata_json.
 * Usa Web Crypto (Workers + Node 22) — sem node:crypto.
 */

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  const base64 = btoa(binary)
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export function generateOpaqueToken(byteLength = 32): string {
  const buf = new Uint8Array(byteLength)
  crypto.getRandomValues(buf)
  return bytesToBase64Url(buf)
}

export async function hashToken(token: string): Promise<string> {
  const data = new TextEncoder().encode(token)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return bytesToHex(new Uint8Array(digest))
}

export function hashesEqual(aHash: string, bHash: string): boolean {
  if (aHash.length !== bHash.length) return false
  let diff = 0
  for (let i = 0; i < aHash.length; i++) {
    diff |= aHash.charCodeAt(i) ^ bHash.charCodeAt(i)
  }
  return diff === 0
}

/** Remove campos sensíveis antes de qualquer serialização/log. */
const REDACT_KEYS = new Set([
  'token',
  'rawToken',
  'handoff',
  'handoffCode',
  'tokenHash',
  'handoffHash',
  'password',
  'secret',
])

export function redactSecrets<T>(value: T): T {
  return redactValue(value) as T
}

function redactValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactValue)
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = REDACT_KEYS.has(k) ? '[redacted]' : redactValue(v)
    }
    return out
  }
  return value
}
