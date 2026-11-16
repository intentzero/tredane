/**
 * Clínica demo de staging (backlog item 3). Id no formato real `tenant_<24 hex>`
 * para passar pelas mesmas rotas autenticadas do painel.
 * Tenants demo nunca enviam WhatsApp (contatos fictícios).
 */
export const DEMO_CLINIC_TENANT_ID = 'tenant_dec0de000000000000000001'
export const DEMO_CLINIC_NAME = 'Clínica Bella Pele (demo)'

/** Clínica Teste Paulo (staging) — sondas reais; nunca alvo do laboratório. */
export const STAGING_TESTE_PAULO_TENANT_ID = 'tenant_b40dc579540c30130840b9ac'

const DEMO_TENANT_IDS: ReadonlySet<string> = new Set([DEMO_CLINIC_TENANT_ID])

/** Tenants explicitamente bloqueados para `lab_reset` (default-deny além da demo). */
export const LAB_FORBIDDEN_TENANT_IDS: ReadonlySet<string> = new Set([STAGING_TESTE_PAULO_TENANT_ID])

export function isDemoTenantId(tenantId: string | null | undefined): boolean {
  return typeof tenantId === 'string' && DEMO_TENANT_IDS.has(tenantId)
}
