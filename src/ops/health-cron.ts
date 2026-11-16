/**
 * Cron de saúde (DEC-193, #833): a cada 10 minutos lê o snapshot operacional de cada clínica
 * ativa e grava o resumo no D1. Falha por clínica não pára as outras.
 */
import { workerCaller } from '../clinic'
import { clinicDurableObjectName } from '../clinic/demo/do-name'
import { fromD1 } from '../db/admin/async-store'
import type { WorkerBindings } from '../worker/bindings'
import { refreshAllHealth } from './health-summary'
import { emitOpsLog, newCorrelationId } from './log'

/** Tem de coincidir com `triggers.crons` em `wrangler.jsonc`. */
export const HEALTH_CRON = '*/10 * * * *'

export async function runHealthRefresh(
  env: WorkerBindings,
  nowMs = Date.now(),
): Promise<{ ok: number; unreachable: number }> {
  const result = await refreshAllHealth(
    fromD1(env.DB),
    (tenantId) => env.CLINIC.get(env.CLINIC.idFromName(clinicDurableObjectName(tenantId))).getOpsSnapshot(workerCaller(tenantId)),
    nowMs,
  )
  emitOpsLog({
    level: result.unreachable > 0 ? 'warn' : 'info',
    channel: 'ops',
    event: 'ops.health.refresh',
    correlationId: newCorrelationId('health'),
    operation: 'ops.health.refresh',
    outcome: result.unreachable > 0 ? 'partial' : 'ok',
    detail: { ok: result.ok, unreachable: result.unreachable },
  })
  return result
}
