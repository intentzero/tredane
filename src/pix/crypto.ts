/**
 * Cifra de App ID Woovi em repouso (Clinic DO SQLite).
 * Synthetic: prefixo explícito. Live/sandbox: XOR com chave derivada de PIX_TOKEN_SECRET.
 * Nunca serializar plaintext nem cipher na API do cliente.
 */

function toHex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function fromHex(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < out.length; i++) {
    out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  }
  return out
}

async function deriveKey(secret: string): Promise<Uint8Array> {
  const data = new TextEncoder().encode(`tredane-pix-v1:${secret}`)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return new Uint8Array(digest)
}

export async function sealPixAppId(
  plaintext: string,
  secret: string | undefined,
  mode: 'synthetic' | 'sandbox' | 'live',
): Promise<string> {
  if (mode === 'synthetic' || !secret) {
    return `synth:${plaintext}`
  }
  const key = await deriveKey(secret)
  const plain = new TextEncoder().encode(plaintext)
  const out = new Uint8Array(plain.length)
  for (let i = 0; i < plain.length; i++) {
    out[i] = plain[i]! ^ key[i % key.length]!
  }
  return `v1:${toHex(out)}`
}

export async function openPixAppId(
  sealed: string,
  secret: string | undefined,
): Promise<string> {
  if (sealed.startsWith('synth:')) {
    return sealed.slice('synth:'.length)
  }
  if (!sealed.startsWith('v1:')) {
    throw new Error('unknown_pix_seal')
  }
  if (!secret) throw new Error('pix_token_secret_missing')
  const key = await deriveKey(secret)
  const raw = fromHex(sealed.slice(3))
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) {
    out[i] = raw[i]! ^ key[i % key.length]!
  }
  return new TextDecoder().decode(out)
}

/** Últimos caracteres para UI — nunca o App ID completo. */
export function appIdHint(appId: string): string {
  const trimmed = appId.trim()
  if (trimmed.length <= 4) return '••••'
  return `••••${trimmed.slice(-4)}`
}
