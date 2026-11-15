/**
 * DEC-188 — Lab espera o apply LLM no Worker (não no Clinic DO).
 * Poll interno até ~15–20 s; timeout → failLlmJob (DEC-107).
 */
import { processLlmJob } from '../ai/llm-queue-consumer'
import type { LlmQueueMessage } from '../clinic/ai/llm-queue-types'
import { LAB_LLM_POLL_MS, LAB_LLM_WAIT_MS } from '../clinic/ai/llm-queue-types'
import type { ClinicCaller } from '../clinic/envelopes'
import type { WorkerBindings } from '../worker/bindings'
import type { ClinicDurableObject } from '../worker/clinic-do'

export type LabLlmStub = {
  listOpenLlmJobs: ClinicDurableObject['listOpenLlmJobs']
  claimLlmJob: ClinicDurableObject['claimLlmJob']
  applyLlmResult: ClinicDurableObject['applyLlmResult']
  failLlmJob: ClinicDurableObject['failLlmJob']
}

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms))
}

/**
 * Processa jobs LLM abertos da conversa (inline no Worker) até vazio ou timeout.
 * Se a lista estiver vazia mas ainda houver tempo (race enqueue), espera `pollMs`.
 */
export async function waitLabLlmJobs(
  env: WorkerBindings,
  stub: LabLlmStub,
  caller: ClinicCaller,
  conversationId: string,
  opts: { waitMs?: number; pollMs?: number } = {},
): Promise<{ timedOut: boolean; processed: number }> {
  const waitMs = opts.waitMs ?? LAB_LLM_WAIT_MS
  const pollMs = opts.pollMs ?? LAB_LLM_POLL_MS
  const deadline = Date.now() + waitMs
  let processed = 0
  let emptyStreak = 0

  while (Date.now() < deadline) {
    const open = await stub.listOpenLlmJobs(caller, { conversationId })
    if (open.length === 0) {
      // Já processámos pelo menos um job e a fila esvaziou → sucesso.
      if (processed > 0) return { timedOut: false, processed }
      // Ainda sem job: breve espera (race enqueue DO → list).
      emptyStreak += 1
      if (emptyStreak > 3) return { timedOut: false, processed }
      await sleep(pollMs)
      continue
    }
    emptyStreak = 0
    const job: LlmQueueMessage = open[0]!
    await processLlmJob(job, {
      env,
      clinicStub: () => stub,
    })
    processed += 1
    // extract → apply resume pode enfileirar redact; loop continua.
  }

  const leftover = await stub.listOpenLlmJobs(caller, { conversationId })
  for (const job of leftover) {
    try {
      await stub.failLlmJob(caller, {
        jobId: job.jobId,
        idempotencyKey: job.idempotencyKey,
        errorCode: 'lab_llm_timeout',
      })
    } catch {
      /* best-effort DEC-107 */
    }
  }
  return { timedOut: leftover.length > 0, processed }
}

export { sleep }
