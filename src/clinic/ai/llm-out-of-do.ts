/**
 * DEC-188 — feature flag para Claude autodraft fora do Clinic DO.
 * `off` (omisso) | `demo` (só tenant demo) | `on` (todos os tenants do ambiente).
 */
import { isDemoTenantId } from '../demo/ids'

export type LlmOutOfDoMode = 'off' | 'demo' | 'on'

export function parseLlmOutOfDoMode(raw: string | undefined): LlmOutOfDoMode {
  const v = (raw ?? 'off').trim().toLowerCase()
  if (v === 'on' || v === 'true' || v === 'all') return 'on'
  if (v === 'demo') return 'demo'
  return 'off'
}

export function llmOutOfDoEnabled(
  env: { LLM_OUT_OF_DO?: string } | undefined,
  tenantId: string,
): boolean {
  const mode = parseLlmOutOfDoMode(env?.LLM_OUT_OF_DO)
  if (mode === 'off') return false
  if (mode === 'demo') return isDemoTenantId(tenantId)
  return true
}
