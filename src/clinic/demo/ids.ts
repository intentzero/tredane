/**
 * Clínica demo de staging (backlog item 3). Id no formato real `tenant_<24 hex>`
 * para passar pelas mesmas rotas autenticadas do painel.
 * Tenants demo nunca enviam WhatsApp (contatos fictícios).
 */
export const DEMO_CLINIC_TENANT_ID = 'tenant_dec0de000000000000000001'
export const DEMO_CLINIC_NAME = 'Clínica Bella Pele (demo)'

const DEMO_TENANT_IDS: ReadonlySet<string> = new Set([DEMO_CLINIC_TENANT_ID])

export function isDemoTenantId(tenantId: string | null | undefined): boolean {
  return typeof tenantId === 'string' && DEMO_TENANT_IDS.has(tenantId)
}
