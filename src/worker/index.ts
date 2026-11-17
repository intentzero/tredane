import { app } from './app'
import { handleInboundQueue } from '../whatsapp/queue-consumer'
import { handleLlmQueueBatch } from '../ai/llm-queue-consumer'
import {
  isLlmQueueEnvelope,
  type LlmQueueEnvelope,
} from '../clinic/ai/llm-queue-types'
import { runReviewSamplesPurge } from '../review-samples'
import { purgeExpiredClientWebRows } from '../clientweb/cleanup'
import { purgeSupportRecords } from '../support/retention'
import { systemClock } from '../db/clock'
import { HEALTH_CRON, runHealthRefresh } from '../ops/health-cron'
import type { WorkerBindings } from './bindings'
import type { InboundQueueMessage } from '../whatsapp/queue-types'

export { ClinicDurableObject } from './clinic-do'
/** Workflow de expurgo — binding TENANT_PURGE em wrangler.jsonc. */
export { TenantPurgeWorkflow } from '../retention/workflow'

function isLlmQueueName(name: string): boolean {
  return /tredane-llm-/i.test(name)
}

/**
 * Worker: HTTP (Hono) + consumer INBOUND_EVENTS (#32) + LLM_JOBS (DEC-188)
 * + Workflow TenantPurgeWorkflow (expurgo ≤30 dias)
 * + cron DEC-159 (purge TTL amostras de revisão).
 */
const worker = {
  fetch: app.fetch.bind(app),
  async queue(
    batch: MessageBatch<InboundQueueMessage | LlmQueueEnvelope>,
    env: WorkerBindings,
    ctx: ExecutionContext,
  ): Promise<void> {
    if (isLlmQueueName(batch.queue) || batch.messages.some((m) => isLlmQueueEnvelope(m.body))) {
      await handleLlmQueueBatch(batch as MessageBatch<LlmQueueEnvelope>, env)
      return
    }
    await handleInboundQueue(batch as MessageBatch<InboundQueueMessage>, env, ctx)
  },
  async scheduled(
    controller: ScheduledController,
    env: WorkerBindings,
  ): Promise<void> {
    // Dois crons em `wrangler.jsonc`: o diário (purge, DEC-159) e o de 10 min (saúde, DEC-193).
    if (controller.cron === HEALTH_CRON) {
      await runHealthRefresh(env)
      return
    }
    await runReviewSamplesPurge(env)
    // ADR-0018 §7a: links, sessões e contadores expirados da página da cliente.
    if (env.DB) await purgeExpiredClientWebRows(env.DB, systemClock)
    // VAL-09 / decisão 3 (17/11/2026, #896): registos de suporte com mais de 5 anos.
    if (env.DB) await purgeSupportRecords(env.DB, systemClock)
  },
}

export default worker
