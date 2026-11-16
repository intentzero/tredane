/**
 * Guardas de `lab_reset` (DEC-186): default-deny antes de tocar dados.
 */
import { DEMO_CLINIC_TENANT_ID, LAB_FORBIDDEN_TENANT_IDS } from '../clinic/demo/ids'
import type { WorkerBindings } from '../worker/bindings'

export class LabResetGuardError extends Error {
  readonly code = 'lab_reset_refused'
  constructor(message: string) {
    super(message)
    this.name = 'LabResetGuardError'
  }
}

const LAB_RESET_ALLOWED_TENANT_ID = DEMO_CLINIC_TENANT_ID

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
  if (LAB_FORBIDDEN_TENANT_IDS.has(tenantId)) {
    throw new LabResetGuardError('lab_reset recusado: tenant da Clínica Teste Paulo não é permitido.')
  }
  if (tenantId !== LAB_RESET_ALLOWED_TENANT_ID) {
    throw new LabResetGuardError(
      `lab_reset só para a clínica demo do laboratório (${LAB_RESET_ALLOWED_TENANT_ID}).`,
    )
  }
}

export function assertLabResetAllowed(
  env: Pick<WorkerBindings, 'ENVIRONMENT'> | undefined,
  tenantId: string | null | undefined,
): void {
  assertLabResetEnvironment(env)
  assertLabResetTenant(tenantId)
}