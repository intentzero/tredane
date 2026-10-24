/**
 * Protecção mínima de tokens Meta em repouso no D1.
 * Em synthetic: prefixo explícito (nunca devolver na API).
 * Em live: XOR com chave derivada de META_TOKEN_SECRET (ou APP_SECRET).
 * Não é HSM — gate de produção exige revisão (#18).
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
  const data = new TextEncoder().encode(`tredane-wa-v1:${secret}`)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return new Uint8Array(digest)
}

export async function sealAccessToken(
  plaintext: string,
  secret: string | undefined,
  mode: 'synthetic' | 'live',
): Promise<string> {
  if (mode === 'synthetic' || !secret) {
    // Prefixo identifica material sintético; ainda assim nunca serializar na API.
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

export async function openAccessToken(
  sealed: string,
  secret: string | undefined,
): Promise<string> {
  if (sealed.startsWith('synth:')) {
    return sealed.slice('synth:'.length)
  }
  if (!sealed.startsWith('v1:')) {
    throw new Error('unknown_token_seal')
  }
  if (!secret) throw new Error('token_secret_missing')
  const key = await deriveKey(secret)
  const raw = fromHex(sealed.slice(3))
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) {
    out[i] = raw[i]! ^ key[i % key.length]!
  }
  return new TextDecoder().decode(out)
}
