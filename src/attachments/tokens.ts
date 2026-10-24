/**
 * Tokens efémeros HMAC para download (#34).
 * Não são URLs públicas R2: o Worker revalida assinatura + expiry + tenant
 * e só depois lê o objecto. Credenciais R2 nunca vão ao cliente.
 */
import { RETENTION } from './policy'

function toBase64Url(bytes: Uint8Array): string {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function fromBase64Url(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4))
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + pad
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(`tredane-att-v1:${secret}`),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  )
}

export type AttachmentDownloadClaims = {
  v: 1
  tenantId: string
  attachmentId: string
  sub: string
  exp: number
}

export function resolveAttachmentTokenSecret(env: {
  ATTACHMENT_TOKEN_SECRET?: string
  META_TOKEN_SECRET?: string
  META_APP_SECRET?: string
  ENVIRONMENT?: string
}): string {
  const explicit =
    env.ATTACHMENT_TOKEN_SECRET?.trim() ||
    env.META_TOKEN_SECRET?.trim() ||
    env.META_APP_SECRET?.trim()
  if (explicit) return explicit
  // Synthetic / local: segredo estável e não-secreto (só harness).
  return `synth-attachment-token:${env.ENVIRONMENT ?? 'development'}`
}

export async function mintAttachmentDownloadToken(input: {
  secret: string
  tenantId: string
  attachmentId: string
  subjectClerkUserId: string
  nowMs?: number
  ttlMs?: number
}): Promise<{ token: string; expiresAt: number }> {
  const now = input.nowMs ?? Date.now()
  const ttl = input.ttlMs ?? RETENTION.ephemeralDownloadTtlMs
  const exp = now + ttl
  const claims: AttachmentDownloadClaims = {
    v: 1,
    tenantId: input.tenantId,
    attachmentId: input.attachmentId,
    sub: input.subjectClerkUserId,
    exp,
  }
  const payload = toBase64Url(new TextEncoder().encode(JSON.stringify(claims)))
  const key = await hmacKey(input.secret)
  const sig = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(payload),
  )
  return { token: `${payload}.${toBase64Url(new Uint8Array(sig))}`, expiresAt: exp }
}

export type VerifyAttachmentTokenResult =
  | { ok: true; claims: AttachmentDownloadClaims }
  | { ok: false; code: 'malformed' | 'bad_signature' | 'expired' | 'tenant_mismatch' | 'subject_mismatch' }

export async function verifyAttachmentDownloadToken(input: {
  secret: string
  token: string
  expectedTenantId: string
  expectedAttachmentId: string
  /** Se informado, o subject do token tem de coincidir (revogação / sessão). */
  expectedSubjectClerkUserId?: string
  nowMs?: number
}): Promise<VerifyAttachmentTokenResult> {
  const parts = input.token.split('.')
  if (parts.length !== 2) return { ok: false, code: 'malformed' }
  const [payload, sigB64] = parts as [string, string]
  const key = await hmacKey(input.secret)
  const sigBytes = fromBase64Url(sigB64)
  const sigCopy = new Uint8Array(sigBytes.byteLength)
  sigCopy.set(sigBytes)
  const valid = await crypto.subtle.verify(
    'HMAC',
    key,
    sigCopy,
    new TextEncoder().encode(payload),
  )
  if (!valid) return { ok: false, code: 'bad_signature' }

  let claims: AttachmentDownloadClaims
  try {
    claims = JSON.parse(new TextDecoder().decode(fromBase64Url(payload))) as AttachmentDownloadClaims
  } catch {
    return { ok: false, code: 'malformed' }
  }
  if (claims.v !== 1 || !claims.tenantId || !claims.attachmentId || !claims.sub) {
    return { ok: false, code: 'malformed' }
  }
  const now = input.nowMs ?? Date.now()
  if (!Number.isFinite(claims.exp) || claims.exp <= now) {
    return { ok: false, code: 'expired' }
  }
  if (claims.tenantId !== input.expectedTenantId) {
    return { ok: false, code: 'tenant_mismatch' }
  }
  if (claims.attachmentId !== input.expectedAttachmentId) {
    return { ok: false, code: 'tenant_mismatch' }
  }
  if (
    input.expectedSubjectClerkUserId &&
    claims.sub !== input.expectedSubjectClerkUserId
  ) {
    return { ok: false, code: 'subject_mismatch' }
  }
  return { ok: true, claims }
}
