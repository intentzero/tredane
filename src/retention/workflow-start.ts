/**
 * Arranque idempotente do Workflow de expurgo.
 * Sem binding (CI/unit sem conta CF) → no-op; máquina sync continua a servir.
 */
import {
  tenantPurgeWorkflowInstanceId,
  type TenantPurgeWorkflowParams,
} from './workflow-params'

/** Subconjunto tipado do binding Workflow (evita import de cloudflare:workers aqui). */
export type TenantPurgeWorkflowBinding = {
  create: (options: {
    id?: string
    params?: TenantPurgeWorkflowParams
  }) => Promise<{ id: string }>
  get: (id: string) => Promise<{ id: string; status: () => Promise<{ status: string }> }>
}

export type StartTenantPurgeWorkflowResult =
  | { started: true; instanceId: string; reused: boolean }
  | { started: false; reason: 'binding_unavailable' | 'create_failed'; detail?: string }

export async function startTenantPurgeWorkflow(
  binding: TenantPurgeWorkflowBinding | null | undefined,
  params: TenantPurgeWorkflowParams,
): Promise<StartTenantPurgeWorkflowResult> {
  if (!binding) {
    return { started: false, reason: 'binding_unavailable' }
  }
  const instanceId = tenantPurgeWorkflowInstanceId(params.commandId)
  try {
    const instance = await binding.create({ id: instanceId, params })
    return { started: true, instanceId: instance.id, reused: false }
  } catch (err) {
    // Id já existe → reutilizar (anti-replay / retries de API).
    try {
      const existing = await binding.get(instanceId)
      return { started: true, instanceId: existing.id, reused: true }
    } catch {
      const detail = err instanceof Error ? err.message : 'workflow_create_failed'
      return { started: false, reason: 'create_failed', detail }
    }
  }
}
