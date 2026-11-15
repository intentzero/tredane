/**
 * Consumer da fila `tredane-llm-*` (DEC-188 / #784).
 * Claim no DO → Claude via AI Gateway → apply/fail no DO.
 * Nunca lê SQLite de outra clínica; o snapshot vem no job.
 */
import {
  AI_MODEL_EXTRACT,
  AI_MODEL_EXCEPTION,
  AI_TIMEOUT_MS,
  AI_MAX_OUTPUT_TOKENS_REPLY,
  EXTRACTOR_STABLE_SYSTEM,
  EXTRACT_TOOL_NAME,
  EXCEPTION_STABLE_SYSTEM,
  buildAiAdapter,
  buildExtractTool,
  buildExtractorUserContent,
  buildExceptionUserContent,
  resolveAiMode,
  type AiContextPayload,
  type AiGenerateResult,
} from './index'
import { clinicDurableObjectName } from '../clinic/demo/do-name'
import { queueCaller } from '../clinic'
import { systemClock, type Clock } from '../db/clock'
import type { WorkerBindings } from '../worker/bindings'
import type { ClinicDurableObject } from '../worker/clinic-do'
import {
  isLlmQueueMessage,
  type LlmQueueMessage,
} from '../clinic/ai/llm-queue-types'
import type {
  ExtractModelResult,
  ExtractSnapshot,
  RedactModelResult,
  RedactSnapshot,
} from '../clinic/ai/llm-snapshot'
import type { ExtractorRaw } from '../clinic/ai/llm-extractor'

export type LlmProcessOutcome = 'ack' | { retryDelaySeconds: number }

export type LlmClinicStub = {
  claimLlmJob: (
    caller: ReturnType<typeof queueCaller>,
    input: { jobId: string; idempotencyKey: string },
  ) => Promise<{
    status: string
    job?: { id: string; snapshotJson: string; purpose: string; state: string; resultJson?: string | null }
  }>
  applyLlmResult: (
    caller: ReturnType<typeof queueCaller>,
    input: {
      jobId: string
      idempotencyKey: string
      result: ExtractModelResult | RedactModelResult
    },
  ) => Promise<{ status: string; resumeAutodraft?: boolean }>
  failLlmJob: (
    caller: ReturnType<typeof queueCaller>,
    input: { jobId: string; idempotencyKey: string; errorCode: string },
  ) => Promise<{ status: string }>
}

function clinicFromEnv(env: WorkerBindings, tenantId: string): LlmClinicStub {
  const id = env.CLINIC.idFromName(clinicDurableObjectName(tenantId))
  return env.CLINIC.get(id) as unknown as LlmClinicStub
}

function emptyContext(): AiContextPayload {
  return {
    contactFirstName: null,
    stage: null,
    services: [],
    messages: [],
    hasClinicOutbound: false,
    clinicOutboundCount: 0,
  }
}

function parseRaw(text: string): ExtractorRaw | null {
  try {
    const v = JSON.parse(text) as ExtractorRaw
    if (!v || typeof v !== 'object') return null
    return v
  } catch {
    return null
  }
}

function parseSnapshotJson<T>(json: string): T | null {
  try {
    return JSON.parse(json) as T
  } catch {
    return null
  }
}

async function callExtract(
  env: WorkerBindings,
  snapshot: ExtractSnapshot,
): Promise<ExtractModelResult> {
  const mode = resolveAiMode(env.AI_MODE)
  const adapter = buildAiAdapter({
    mode,
    gateway: {
      accountId: env.CF_ACCOUNT_ID ?? '',
      gatewayId: env.AI_GATEWAY_ID ?? 'default',
      gatewayToken: env.AI_GATEWAY_TOKEN ?? '',
      anthropicApiKey: env.ANTHROPIC_API_KEY,
      ...(env.AI_GATEWAY_BYOK_ALIAS ? { byokAlias: env.AI_GATEWAY_BYOK_ALIAS } : {}),
    },
  })
  const tool = buildExtractTool(snapshot.catalog)
  const userContent = buildExtractorUserContent({
    turnText: snapshot.turnText,
    pending: snapshot.pending
      ? { slot: snapshot.pending.slot, options: snapshot.pending.options }
      : null,
    catalog: snapshot.catalog,
  })
  const gen = await adapter.generate({
    kind: 'reply',
    profile: 'extract',
    context: emptyContext(),
    warnings: [],
    servicesWithoutPrice: [],
    servicesWithoutExplanation: [],
    explanationSources: [],
    maxOutputTokens: 512,
    timeoutMs: AI_TIMEOUT_MS,
    model: AI_MODEL_EXTRACT,
    systemPromptOverride: EXTRACTOR_STABLE_SYSTEM,
    userContentOverride: userContent,
    tools: [tool],
    toolChoice: { type: 'tool', name: EXTRACT_TOOL_NAME },
    promptCache: true,
  })
  return toExtractResult(gen)
}

function toExtractResult(gen: AiGenerateResult): ExtractModelResult {
  if (!gen.ok) {
    return {
      ok: false,
      text: '',
      raw: null,
      model: gen.model,
      inputTokens: null,
      outputTokens: null,
      latencyMs: gen.latencyMs,
      code: gen.code,
    }
  }
  return {
    ok: true,
    text: gen.text,
    raw: parseRaw(gen.text),
    model: gen.model,
    inputTokens: gen.inputTokens,
    outputTokens: gen.outputTokens,
    latencyMs: gen.latencyMs,
  }
}

async function callRedact(
  env: WorkerBindings,
  snapshot: RedactSnapshot,
): Promise<RedactModelResult> {
  const mode = resolveAiMode(env.AI_MODE)
  const adapter = buildAiAdapter({
    mode,
    gateway: {
      accountId: env.CF_ACCOUNT_ID ?? '',
      gatewayId: env.AI_GATEWAY_ID ?? 'default',
      gatewayToken: env.AI_GATEWAY_TOKEN ?? '',
      anthropicApiKey: env.ANTHROPIC_API_KEY,
      ...(env.AI_GATEWAY_BYOK_ALIAS ? { byokAlias: env.AI_GATEWAY_BYOK_ALIAS } : {}),
    },
  })
  const userContent = buildExceptionUserContent({
    context: snapshot.context as AiContextPayload,
    question: snapshot.question,
    computedFacts: snapshot.computedFacts,
  })
  const gen = await adapter.generate({
    kind: 'reply',
    profile: 'exception',
    context: snapshot.context as AiContextPayload,
    warnings: [],
    servicesWithoutPrice: [],
    servicesWithoutExplanation: [],
    explanationSources: [],
    maxOutputTokens: AI_MAX_OUTPUT_TOKENS_REPLY,
    timeoutMs: AI_TIMEOUT_MS,
    model: AI_MODEL_EXCEPTION,
    systemPromptOverride: EXCEPTION_STABLE_SYSTEM,
    userContentOverride: userContent,
    promptCache: true,
  })
  if (!gen.ok) {
    return {
      ok: false,
      text: '',
      model: gen.model,
      inputTokens: null,
      outputTokens: null,
      latencyMs: gen.latencyMs,
      code: gen.code,
    }
  }
  return {
    ok: true,
    text: gen.text,
    model: gen.model,
    inputTokens: gen.inputTokens,
    outputTokens: gen.outputTokens,
    latencyMs: gen.latencyMs,
  }
}

export type ProcessLlmJobDeps = {
  env: WorkerBindings
  clock?: Clock
  clinicStub?: (tenantId: string) => LlmClinicStub
  log?: (entry: {
    level: 'info' | 'warn' | 'error'
    event: string
    detail: Record<string, unknown>
  }) => void
}

/**
 * Processa uma mensagem da fila LLM (ou invocação inline do Lab).
 */
export async function processLlmJob(
  msg: LlmQueueMessage,
  deps: ProcessLlmJobDeps,
): Promise<LlmProcessOutcome> {
  const clock = deps.clock ?? systemClock
  const log =
    deps.log ??
    ((e) => {
      console[e.level === 'info' ? 'info' : e.level === 'warn' ? 'warn' : 'error'](
        JSON.stringify({ level: e.level, event: e.event, ...e.detail, at: clock.nowMs() }),
      )
    })
  const stub = deps.clinicStub?.(msg.tenantId) ?? clinicFromEnv(deps.env, msg.tenantId)
  const caller = queueCaller(msg.tenantId)

  const claim = await stub.claimLlmJob(caller, {
    jobId: msg.jobId,
    idempotencyKey: msg.idempotencyKey,
  })

  if (claim.status === 'done') return 'ack'
  if (claim.status === 'missing' || claim.status === 'failed' || claim.status === 'resolved_stale') {
    if (claim.status === 'resolved_stale' || claim.status === 'failed') {
      try {
        await stub.failLlmJob(caller, {
          jobId: msg.jobId,
          idempotencyKey: msg.idempotencyKey,
          errorCode: claim.status === 'resolved_stale' ? 'claim_lease_expired' : 'job_failed',
        })
      } catch {
        /* best-effort */
      }
    }
    return 'ack'
  }
  if (claim.status === 'in_flight') {
    return { retryDelaySeconds: 5 }
  }
  if (claim.status !== 'claimed' || !claim.job) {
    return { retryDelaySeconds: 5 }
  }

  const snapshotJson = claim.job.snapshotJson
  try {
    if (msg.purpose === 'extract') {
      const snapshot = parseSnapshotJson<ExtractSnapshot>(snapshotJson)
      if (!snapshot || snapshot.purpose !== 'extract') {
        await stub.failLlmJob(caller, {
          jobId: msg.jobId,
          idempotencyKey: msg.idempotencyKey,
          errorCode: 'bad_snapshot',
        })
        return 'ack'
      }
      const result = await callExtract(deps.env, snapshot)
      const applied = await stub.applyLlmResult(caller, {
        jobId: msg.jobId,
        idempotencyKey: msg.idempotencyKey,
        result,
      })
      // applyLlmResult no DO já retoma o autodraft (booking / enqueue redact).
      log({
        level: 'info',
        event: 'llm.job_applied',
        detail: {
          tenantId: msg.tenantId,
          jobId: msg.jobId,
          purpose: 'extract',
          applyStatus: applied.status,
        },
      })
      return 'ack'
    }

    const snapshot = parseSnapshotJson<RedactSnapshot>(snapshotJson)
    if (!snapshot || snapshot.purpose !== 'redact') {
      await stub.failLlmJob(caller, {
        jobId: msg.jobId,
        idempotencyKey: msg.idempotencyKey,
        errorCode: 'bad_snapshot',
      })
      return 'ack'
    }
    const result = await callRedact(deps.env, snapshot)
    const applied = await stub.applyLlmResult(caller, {
      jobId: msg.jobId,
      idempotencyKey: msg.idempotencyKey,
      result,
    })
    log({
      level: 'info',
      event: 'llm.job_applied',
      detail: {
        tenantId: msg.tenantId,
        jobId: msg.jobId,
        purpose: 'redact',
        applyStatus: applied.status,
      },
    })
    return 'ack'
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown'
    log({
      level: 'error',
      event: 'llm.job_error',
      detail: { tenantId: msg.tenantId, jobId: msg.jobId, error: message },
    })
    try {
      await stub.failLlmJob(caller, {
        jobId: msg.jobId,
        idempotencyKey: msg.idempotencyKey,
        errorCode: 'consumer_error',
      })
    } catch {
      /* best-effort */
    }
    return 'ack'
  }
}

export async function handleLlmQueueBatch(
  batch: MessageBatch<LlmQueueMessage>,
  env: WorkerBindings,
): Promise<void> {
  for (const message of batch.messages) {
    const body = message.body
    if (!isLlmQueueMessage(body)) {
      message.ack()
      continue
    }
    const outcome = await processLlmJob(body, { env })
    if (outcome === 'ack') message.ack()
    else message.retry({ delaySeconds: outcome.retryDelaySeconds })
  }
}

export type ClinicDurableObjectLlm = Pick<
  ClinicDurableObject,
  'claimLlmJob' | 'applyLlmResult' | 'failLlmJob' | 'runAutoDrafts'
>
