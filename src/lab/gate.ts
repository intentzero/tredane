/**
 * Gate do MCP de laboratório (DEC-182). Só staging, com a flag e com o OAuth MCP configurado (OAUTH_KV).
 * Fora disso a rota responde 404 e o DO recusa os métodos `lab*`.
 */
import type { WorkerBindings } from '../worker/bindings'

export const LAB_DEFAULT_MAX_TURNS_DAILY = 400

export function isLabEnabled(
  env: Pick<WorkerBindings, 'ENVIRONMENT' | 'LAB_ENABLED' | 'OAUTH_KV'> | undefined,
): boolean {
  if (!env) return false
  if (env.ENVIRONMENT !== 'staging') return false
  if ((env.LAB_ENABLED ?? '').trim().toLowerCase() !== 'true') return false
  return Boolean(env.OAUTH_KV)
}

export function labMaxTurnsDaily(env: Pick<WorkerBindings, 'LAB_MAX_TURNS_DAILY'> | undefined): number {
  const n = Number(env?.LAB_MAX_TURNS_DAILY)
  return Number.isInteger(n) && n > 0 && n <= 5000 ? n : LAB_DEFAULT_MAX_TURNS_DAILY
}

/** Números do laboratório: prefixo 5500 (DDD inexistente), nunca um número real. */
export const LAB_DEFAULT_WA_ID = '550000000001'
export const LAB_WA_ID_RE = /^5500\d{8,11}$/

export function resolveLabWaId(raw: unknown): string | null {
  if (raw === undefined || raw === null || raw === '') return LAB_DEFAULT_WA_ID
  return typeof raw === 'string' && LAB_WA_ID_RE.test(raw) ? raw : null
}
