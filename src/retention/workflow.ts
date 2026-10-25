/**
 * Cloudflare Workflow — expurgo de clínica com checkpoints/retries (#43 polish).
 * A fonte de verdade operacional continua a ser `tenant_deletion_commands` +
 * `purged_tenants`; o Workflow só melhora durabilidade (≤30 dias).
 */
import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
} from 'cloudflare:workers'
import { tickTenantPurgeOnEnv, ENV_PURGE_STEP_NAMES } from './env-orchestrator'
import type { TenantPurgeWorkflowParams } from './workflow-params'
import type { WorkerBindings } from '../worker/bindings'

/** Retries generosos — deadline de produto é 30 dias (DEC-011). */
const STEP_RETRY = {
  retries: {
    limit: 8,
    delay: '30 seconds' as const,
    backoff: 'exponential' as const,
  },
  timeout: '15 minutes' as const,
}

export class TenantPurgeWorkflow extends WorkflowEntrypoint<
  WorkerBindings,
  TenantPurgeWorkflowParams
> {
  async run(
    event: WorkflowEvent<TenantPurgeWorkflowParams>,
    step: WorkflowStep,
  ): Promise<{ done: boolean; lastStep: string | null; status: string }> {
    const params = event.payload
    let lastStep: string | null = null
    let status = 'queued'

    for (const stepName of ENV_PURGE_STEP_NAMES) {
      const result = await step.do(stepName, STEP_RETRY, async () => {
        const tick = await tickTenantPurgeOnEnv(this.env, params)
        // Se o passo esperado ainda não foi o actual (já avançado / fora de ordem),
        // devolver estado sem falhar — idempotência.
        if (tick.detail.error) {
          throw new Error(String(tick.detail.error))
        }
        return {
          stepped: tick.stepped,
          done: tick.done,
          lastStep: tick.lastStep,
          status: tick.status,
        }
      })
      lastStep = result.lastStep
      status = result.status
      if (result.done) {
        return { done: true, lastStep, status }
      }
      // Se o tick não avançou este passo (já completed noutro caminho), sair.
      if (result.stepped == null && status === 'completed') {
        return { done: true, lastStep, status }
      }
    }

    return { done: status === 'completed', lastStep, status }
  }
}
