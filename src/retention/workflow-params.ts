/**
 * Parâmetros do Workflow de expurgo (#43 polish).
 * Sem import de `cloudflare:workers` — seguro em testes Node.
 */
export type TenantPurgeWorkflowParams = {
  tenantId: string
  commandId: string
  actorClerkUserId: string
}

/** Id estável da instância — anti-replay / create idempotente por comando. */
export function tenantPurgeWorkflowInstanceId(commandId: string): string {
  return `tenant-purge-${commandId}`
}
