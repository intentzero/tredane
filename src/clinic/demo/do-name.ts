/**
 * Nome do Durable Object da clínica.
 *
 * O tenant demo em staging pode precisar de um sufixo (`:do-vN`) para abandonar
 * uma instância corrompida (espiral de CPU no alarme) sem mudar o tenantId.
 * Só afecta o idFromName; o tenantId lógico continua `DEMO_CLINIC_TENANT_ID`.
 */
import { DEMO_CLINIC_TENANT_ID, isDemoTenantId } from './ids'

/** Bump quando a instância DO da demo ficar irrecuperável (CPU death spiral). */
export const DEMO_CLINIC_DO_GENERATION = 'do-v10'

export function clinicDurableObjectName(tenantId: string): string {
  if (isDemoTenantId(tenantId)) {
    return `${DEMO_CLINIC_TENANT_ID}:${DEMO_CLINIC_DO_GENERATION}`
  }
  return tenantId
}
