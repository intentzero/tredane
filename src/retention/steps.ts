/**
 * Passos do expurgo físico de tenant (#43 / REQ-071).
 * Fonte de verdade: `tenant_deletion_commands` (checkpoints/retries).
 * Driver durável em produção: Cloudflare Workflow `TENANT_PURGE`
 * (`TenantPurgeWorkflow`); CI/unit continua na máquina sync + tick.
 */
export const TENANT_PURGE_STEPS = [
  'claim',
  'integrations_frozen',
  'push_cleared',
  'r2_prefix_cleared',
  'clinic_sqlite_wiped',
  'd1_scrubbed',
  'financial_noted',
  'completed',
] as const

export type TenantPurgeStep = (typeof TENANT_PURGE_STEPS)[number]

export function nextPurgeStep(current: string | null | undefined): TenantPurgeStep | null {
  if (!current || current === 'queued') return 'claim'
  const idx = TENANT_PURGE_STEPS.indexOf(current as TenantPurgeStep)
  if (idx < 0) return 'claim'
  if (idx >= TENANT_PURGE_STEPS.length - 1) return null
  return TENANT_PURGE_STEPS[idx + 1]!
}

export function isTerminalPurgeStep(step: string | null | undefined): boolean {
  return step === 'completed'
}
