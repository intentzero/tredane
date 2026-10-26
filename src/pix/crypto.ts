/**
 * App ID Woovi em repouso (Clinic DO SQLite) — AES-GCM autenticado (A2), ver
 * `src/security/sealed-secret.ts`. Lê `v1:` (XOR legado) para migração.
 * Nunca serializar plaintext nem cipher na API do cliente.
 */
import { openSecret, sealSecret, type SealKeys } from '../security/sealed-secret'

export async function sealPixAppId(
  plaintext: string,
  keys: SealKeys,
  mode: 'synthetic' | 'sandbox' | 'live',
): Promise<string> {
  return sealSecret('pix', plaintext, keys, mode)
}

export async function openPixAppId(sealed: string, keys: SealKeys): Promise<string> {
  return openSecret('pix', sealed, keys)
}

/** Últimos caracteres para UI — nunca o App ID completo. */
export function appIdHint(appId: string): string {
  const trimmed = appId.trim()
  if (trimmed.length <= 4) return '••••'
  return `••••${trimmed.slice(-4)}`
}
