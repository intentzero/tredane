/**
 * Gate do MCP de laboratório (DEC-182). Só staging, só com secret e flag.
 * Fora disso a rota responde 404 e o DO recusa os métodos `lab*`.
 */
import type { WorkerBindings } from '../worker/bindings'

export const LAB_DEFAULT_MAX_TURNS_DAILY = 400

export function isLabEnabled(
  env: Pick<WorkerBindings, 'ENVIRONMENT' | 'LAB_ENABLED' | 'LAB_TOKEN'> | undefined,
): boolean {
  if (!env) return false
  if (env.ENVIRONMENT !== 'staging') return false
  if ((env.LAB_ENABLED ?? '').trim().toLowerCase() !== 'true') return false
  return typeof env.LAB_TOKEN === 'string' && env.LAB_TOKEN.length >= 32
}

export function labMaxTurnsDaily(env: Pick<WorkerBindings, 'LAB_MAX_TURNS_DAILY'> | undefined): number {
  const n = Number(env?.LAB_MAX_TURNS_DAILY)
  return Number.isInteger(n) && n > 0 && n <= 5000 ? n : LAB_DEFAULT_MAX_TURNS_DAILY
}

export function safeEqual(a: string, b: string): boolean {
  const ae = new TextEncoder().encode(a)
  const be = new TextEncoder().encode(b)
  let diff = ae.length ^ be.length
  for (let i = 0; i < Math.max(ae.length, be.length); i++) diff |= (ae[i] ?? 0) ^ (be[i] ?? 0)
  return diff === 0
}

export function bearerMatches(header: string | null | undefined, token: string): boolean {
  const given = /^Bearer\s+(\S+)$/i.exec((header ?? '').trim())?.[1] ?? ''
  return given.length > 0 && safeEqual(given, token)
}

/** Números do laboratório: prefixo 5500 (DDD inexistente), nunca um número real. */
export const LAB_DEFAULT_WA_ID = '550000000001'
export const LAB_WA_ID_RE = /^5500\d{8,11}$/

export function resolveLabWaId(raw: unknown): string | null {
  if (raw === undefined || raw === null || raw === '') return LAB_DEFAULT_WA_ID
  return typeof raw === 'string' && LAB_WA_ID_RE.test(raw) ? raw : null
}
