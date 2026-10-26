import { describe, expect, it } from 'vitest'
import { openAccessToken, sealAccessToken } from '../whatsapp/crypto'
import { openPixAppId, sealPixAppId } from '../pix/crypto'
import {
  isCurrentSeal,
  metaSealKeys,
  openSecret,
  pixSealKeys,
  sealSecret,
  type SealKeys,
} from './sealed-secret'

const KEY = 'k'.repeat(16) + 'test-token-encryption-key-0123456789'
const OTHER_KEY = 'o'.repeat(48)
const LEGACY = 'legacy-meta-token-secret'
const keys: SealKeys = { key: KEY, legacySecret: LEGACY, strict: true }

/** Reproduz a cifra XOR anterior (v1) para validar a migração. */
async function legacyXorSeal(purpose: 'wa' | 'pix', plaintext: string, secret: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`tredane-${purpose}-v1:${secret}`))
  const k = new Uint8Array(digest)
  const plain = new TextEncoder().encode(plaintext)
  return `v1:${[...plain].map((b, i) => (b ^ k[i % k.length]!).toString(16).padStart(2, '0')).join('')}`
}

function flip(sealed: string, part: 0 | 1): string {
  const [iv, ct] = sealed.slice(3).split('.') as [string, string]
  const target = part === 0 ? iv : ct
  const swapped = target.slice(0, 2) + (target[2] === 'A' ? 'B' : 'A') + target.slice(3)
  return part === 0 ? `v2:${swapped}.${ct}` : `v2:${iv}.${swapped}`
}

describe('sealed-secret AES-GCM (A2)', () => {
  it('roundtrip wa e pix, formato v2 versionado, IV aleatório por valor', async () => {
    const a = await sealAccessToken('EAAG-meta-token', keys, 'live')
    const b = await sealAccessToken('EAAG-meta-token', keys, 'live')
    expect(a.startsWith('v2:')).toBe(true)
    expect(isCurrentSeal(a)).toBe(true)
    expect(a).not.toBe(b)
    expect(a).not.toContain('EAAG')
    expect(await openAccessToken(a, keys)).toBe('EAAG-meta-token')
    const p = await sealPixAppId('woovi-app-id-xyz', keys, 'sandbox')
    expect(await openPixAppId(p, keys)).toBe('woovi-app-id-xyz')
  })

  it('cifra mesmo em modo synthetic quando há chave', async () => {
    const s = await sealSecret('wa', 'synthetic-token', keys, 'synthetic')
    expect(s.startsWith('v2:')).toBe(true)
  })

  it('detecta adulteração (IV, ciphertext, prefixo, finalidade, chave errada)', async () => {
    const s = await sealSecret('wa', 'secret-value', keys, 'live')
    await expect(openSecret('wa', flip(s, 0), keys)).rejects.toThrow('token_seal_invalid')
    await expect(openSecret('wa', flip(s, 1), keys)).rejects.toThrow('token_seal_invalid')
    await expect(openSecret('wa', `${s}.x`, keys)).rejects.toThrow('token_seal_invalid')
    await expect(openSecret('wa', 'v2:garbage', keys)).rejects.toThrow('token_seal_invalid')
    await expect(openSecret('pix', s, keys)).rejects.toThrow('token_seal_invalid')
    await expect(openSecret('wa', s, { ...keys, key: OTHER_KEY })).rejects.toThrow('token_seal_invalid')
    await expect(openSecret('wa', 'v9:abc', keys)).rejects.toThrow('token_seal_unknown')
  })

  it('chave ausente falha fechado em live/sandbox e em strict (staging/production)', async () => {
    await expect(sealSecret('wa', 'x', {}, 'live')).rejects.toThrow('token_encryption_key_missing')
    await expect(sealSecret('pix', 'x', {}, 'sandbox')).rejects.toThrow('token_encryption_key_missing')
    await expect(sealSecret('wa', 'x', { strict: true }, 'synthetic')).rejects.toThrow(
      'token_encryption_key_missing',
    )
    const s = await sealSecret('wa', 'x', keys, 'live')
    await expect(openSecret('wa', s, { legacySecret: LEGACY })).rejects.toThrow('token_encryption_key_missing')
    await expect(sealSecret('wa', 'x', { key: 'short' }, 'live')).rejects.toThrow('token_encryption_key_weak')
  })

  it('synth: só em desenvolvimento sem chave; rejeitado em strict', async () => {
    expect(await sealSecret('wa', 'fixture', {}, 'synthetic')).toBe('synth:fixture')
    expect(await openSecret('wa', 'synth:fixture', {})).toBe('fixture')
    await expect(openSecret('wa', 'synth:fixture', keys)).rejects.toThrow('token_synthetic_rejected')
  })

  it('migração: decifra v1 XOR legado e re-cifra em v2 na escrita', async () => {
    const legacy = await legacyXorSeal('wa', 'old-meta-token', LEGACY)
    expect(isCurrentSeal(legacy)).toBe(false)
    const plain = await openAccessToken(legacy, keys)
    expect(plain).toBe('old-meta-token')
    const resealed = await sealAccessToken(plain, keys, 'live')
    expect(isCurrentSeal(resealed)).toBe(true)
    expect(await openAccessToken(resealed, keys)).toBe('old-meta-token')

    const legacyPix = await legacyXorSeal('pix', 'old-app-id', 'pix-legacy')
    expect(await openPixAppId(legacyPix, { key: KEY, legacySecret: 'pix-legacy' })).toBe('old-app-id')
    await expect(openPixAppId(legacyPix, { key: KEY })).rejects.toThrow('token_legacy_secret_missing')
  })

  it('helpers de env: strict em staging/production; segredo legado correcto', () => {
    expect(metaSealKeys({ ENVIRONMENT: 'staging', TOKEN_ENCRYPTION_KEY: KEY, META_APP_SECRET: 'a' })).toEqual({
      key: KEY,
      legacySecret: 'a',
      strict: true,
    })
    expect(metaSealKeys({ ENVIRONMENT: 'production', META_TOKEN_SECRET: 't', META_APP_SECRET: 'a' }).legacySecret).toBe('t')
    expect(pixSealKeys({ ENVIRONMENT: 'development', PIX_TOKEN_SECRET: 'p' })).toEqual({
      key: undefined,
      legacySecret: 'p',
      strict: false,
    })
  })
})
