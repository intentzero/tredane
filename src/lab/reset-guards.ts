/**
 * Guardas de `lab_reset` (DEC-186): default-deny antes de tocar dados.
 */
import { DEMO_CLINIC_TENANT_ID } from '../clinic/demo/ids'
import type { WorkerBindings } from '../worker/bindings'
import { LAB_RESET_ALLOWED_TENANT_IDS } from './reset-protected'

export class LabResetGuardError extends Error {
  readonly code = 'lab_reset_refused'
  constructor(message: string) {
    super(message)
    this.name = 'LabResetGuardError'
  }
}

const ALLOWED = new Set<string>(LAB_RESET_ALLOWED_TENANT_IDS)

export function assertLabResetEnvironment(
  env: Pick<WorkerBindings, 'ENVIRONMENT'> | undefined,
): void {
  const e = env?.ENVIRONMENT
  if (!e || typeof e !== 'string') {
    throw new LabResetGuardError('Ambiente indeterminado; lab_reset recusado.')
  }
  if (e !== 'staging') {
    throw new LabResetGuardError('lab_reset só é permitido com ENVIRONMENT=staging.')
  }
}

export function assertLabResetTenant(tenantId: string | null | undefined): void {
  if (!tenantId || typeof tenantId !== 'string') {
    throw new LabResetGuardError('Tenant indeterminado; lab_reset recusado.')
  }
  if (!ALLOWED.has(tenantId)) {
    throw new LabResetGuardError(
      `lab_reset só para tenants autorizados (${LAB_RESET_ALLOWED_TENANT_IDS.join(', ')}).`,
    )
  }
}

export function resolveLabResetTenantId(raw: unknown): string {
  if (raw === undefined || raw === null || raw === '') {
    return DEMO_CLINIC_TENANT_ID
  }
  if (typeof raw !== 'string' || !raw.startsWith('tenant_')) {
    throw new LabResetGuardError('tenantId inválido.')
  }
  assertLabResetTenant(raw)
  return raw
}

export function assertLabResetAllowed(
  env: Pick<WorkerBindings, 'ENVIRONMENT'> | undefined,
  tenantId: string | null | undefined,
): void {
  assertLabResetEnvironment(env)
  assertLabResetTenant(tenantId)
}