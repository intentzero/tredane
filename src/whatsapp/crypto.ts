/**
 * Tokens Meta em repouso no D1 — AES-GCM autenticado (A2), ver
 * `src/security/sealed-secret.ts`. Lê `v1:` (XOR legado) para migração.
 */
import { openSecret, sealSecret, type SealKeys } from '../security/sealed-secret'

export type { SealKeys }

export async function sealAccessToken(
  plaintext: string,
  keys: SealKeys,
  mode: 'synthetic' | 'live',
): Promise<string> {
  return sealSecret('wa', plaintext, keys, mode)
}

export async function openAccessToken(sealed: string, keys: SealKeys): Promise<string> {
  return openSecret('wa', sealed, keys)
}
