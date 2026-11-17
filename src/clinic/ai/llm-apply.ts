/**
 * Apply/fail de resultados LLM no Clinic DO (DEC-188).
 * Valida saída, aplica slots / sugestão, DEC-107 em falha — sem chamar o Gateway.
 */
import {
  AI_MODEL_EXCEPTION,
  applyDraftContinuity,
  guardReplyOutput,
  REPLY_OUTPUT_MAX_MESSAGE_CHARS,
  type AiContextPayload,
} from '../../ai'
import type { Clock } from '../../db/clock'
import type { ClinicCaller } from '../envelopes'
import type { ClinicDb } from '../store'
import { listServices } from '../config/services'
import type { OutboxRow } from '../outbox'
import { readCatalogVersion } from './turn-context'
import { applyBookingUpdate } from './apply-booking-update'
import { AI_ACTOR_ID, AI_ACTOR_NAME } from '../ai-actor'
import {
  cancelAutoDraft,
  getAutoDraftJob,
} from './autodraft'
import { sendOutboundMessageOp } from '../inbox/operations'
import { humanTeamOfferButtons } from './human-handoff'
import {
  claimLlmJobOp,
  getLlmJob,
  markLlmJobDone,
  markLlmJobFailed,
  parseSnapshot,
  type ClaimLlmJobResult,
  type LlmJobRow,
} from './llm-jobs'
import {
  type ExtractModelResult,
  type ExtractSnapshot,
  type RedactModelResult,
  type RedactSnapshot,
  frameVersionOf,
} from './llm-snapshot'
import {
  DEFAULT_INTERPRETER_FALLBACK,
  logInterpreterFallbackApplied,
  type InterpreterFallbackConfig,
} from './interpreter-fallback'
import {
  COVERAGE_THRESHOLD,
  type ExtractorRaw,
  validateExtractorOutput,
} from './llm-extractor'
import { notifyModelFallback } from './model-fallback'
import { validateClientOutbound } from './outbound-validate'
import {
  getBookingFrame,
  saveBookingFrame,
  type ScheduleAudienceLine,
  type SchedulePeriod,
} from './schedule-session'
import { insertSuggestion } from './suggestions'
import type { AiAssistDeps } from './types'
import { recordModelCallTowardDailyCap } from './usage'
import {
  promiseTeamFollowUp,
  textPromisesTeamFollowUp,
} from './promise-team-follow-up'
import type { TurnInterpretation } from './nlu/interpret'

export type ApplyLlmResultInput = {
  jobId: string
  idempotencyKey: string
  /** Resultado do modelo (extract ou redact). */
  result: ExtractModelResult | RedactModelResult
}

export type ApplyLlmResultOutcome = {
  status: 'applied' | 'stale' | 'done' | 'failed' | 'missing'
  job: LlmJobRow | null
  /** Outbox a fan-out (WhatsApp / typing). */
  outbox: OutboxRow[]
  /** Autodraft deve ser re-corrido após extract (sem Claude). */
  resumeAutodraft: boolean
  reason?: string
}

export type FailLlmJobInput = {
  jobId: string
  idempotencyKey: string
  errorCode: string
}

/**
 * Aplica slots do extract (DEC-188 Queue). Validação = `validateExtractorOutput`
 * (DEC-190: serviceId por id de catálogo quando léxico none + marcar).
 */
function applyExtractSlots(
  db: ClinicDb,
  tenantId: string,
  snapshot: ExtractSnapshot,
  raw: ExtractorRaw | null,
  clock: Clock,
  fallbackConfig: InterpreterFallbackConfig = DEFAULT_INTERPRETER_FALLBACK,
): { applied: boolean; interpretation: TurnInterpretation; discarded: string[] } {
  const services = listServices(db, tenantId)
  const professionals = snapshot.catalog.professionals
  const frame = getBookingFrame(db, tenantId, snapshot.conversationId)
  if (!raw) {
    return {
      applied: false,
      interpretation: snapshot.base,
      discarded: ['parse'],
    }
  }
  const validated = validateExtractorOutput(raw, {
    messageId: snapshot.messageId,
    turnText: snapshot.turnText,
    today: snapshot.today,
    services,
    professionals,
    pending: snapshot.pending,
    base: snapshot.base,
    fallbackConfig,
  })
  if (validated.fallbackApplied && validated.slots.serviceId?.fonte === 'llm') {
    logInterpreterFallbackApplied({
      level: 'info',
      event: 'ai.interpreter_fallback_applied',
      tenantId,
      conversationId: snapshot.conversationId,
      messageId: snapshot.messageId,
      fields: ['service'],
      serviceId: validated.slots.serviceId.value,
    })
  }
  const coverage = Math.max(
    snapshot.base.coverage,
    validated.discarded.includes('parse') ? 0 : 0.7,
  )
  const interpretation: TurnInterpretation = {
    acts: validated.acts,
    slots: validated.slots,
    coverage,
    needsExtractor: coverage < COVERAGE_THRESHOLD || validated.acts.includes('desconhecido'),
  }
  let applied = false
  const s = validated.slots
  const serviceId = frame?.serviceId ?? s.serviceId?.value ?? null
  if (serviceId) {
    const update = applyBookingUpdate({
      frame,
      serviceId,
      catalogVersion: readCatalogVersion(db, tenantId),
      evidence: { source: 'extractor', sourceMessageId: snapshot.messageId },
      intent: {
        type: 'extractor_fill',
        candidates: {
          ...(s.serviceId ? { serviceId: s.serviceId.value } : {}),
          ...(s.line ? { line: s.line.value as ScheduleAudienceLine } : {}),
          ...(s.variantIds ? { variantIds: s.variantIds.value } : {}),
          ...(s.date ? { date: s.date.value } : {}),
          ...(s.period ? { period: s.period.value as SchedulePeriod } : {}),
          ...(s.time ? { time: s.time.value } : {}),
          ...(s.professionalId ? { professionalPref: s.professionalId.value } : {}),
        },
      },
    })
    const wroteSlot = [
      'line',
      'variantIds',
      'date',
      'period',
      'time',
      'professionalPref',
      'phase',
    ].some((key) => (update.patch as Record<string, unknown>)[key] !== undefined)
    const wroteService = Boolean(update.patch.serviceId && !frame?.serviceId)
    if (wroteSlot || wroteService) {
      saveBookingFrame(db, tenantId, snapshot.conversationId, update.patch, clock)
      applied = true
    }
  }
  return { applied, interpretation, discarded: validated.discarded }
}

function isAutodraftStillCurrent(
  db: ClinicDb,
  tenantId: string,
  conversationId: string,
  messageId: string,
): boolean {
  const job = getAutoDraftJob(db, tenantId, conversationId)
  // Sem job: já cancelado / concluído — apply stale.
  if (!job) return false
  return job.messageId === messageId
}

/**
 * Claim RPC — consumer chama antes do Gateway.
 */
export function claimLlmJobForTenant(
  db: ClinicDb,
  tenantId: string,
  input: { jobId: string; idempotencyKey: string; staleAfterMs?: number },
  clock: Clock,
): ClaimLlmJobResult {
  return claimLlmJobOp(db, tenantId, input, clock)
}

/**
 * Aplica resultado do modelo. Extract → slots + resume autodraft.
 * Redact → sugestão + envio ou DEC-107.
 */
export function applyLlmResultOp(
  db: ClinicDb,
  caller: ClinicCaller,
  clock: Clock,
  deps: AiAssistDeps,
  input: ApplyLlmResultInput,
): ApplyLlmResultOutcome {
  const tenantId = caller.tenantId
  const job = getLlmJob(db, tenantId, input.jobId)
  if (!job || job.idempotencyKey !== input.idempotencyKey) {
    return { status: 'missing', job: null, outbox: [], resumeAutodraft: false }
  }
  if (job.state === 'done') {
    return { status: 'done', job, outbox: [], resumeAutodraft: false }
  }
  if (job.state === 'failed' || job.state === 'stale') {
    return { status: 'failed', job, outbox: [], resumeAutodraft: false, reason: job.errorCode ?? 'failed' }
  }

  if (!isAutodraftStillCurrent(db, tenantId, job.conversationId, job.messageId)) {
    markLlmJobFailed(db, tenantId, { jobId: job.id, errorCode: 'stale_message' }, clock)
    return {
      status: 'stale',
      job: getLlmJob(db, tenantId, job.id),
      outbox: [],
      resumeAutodraft: false,
      reason: 'stale_message',
    }
  }

  if (job.purpose === 'extract') {
    const snapshot = parseSnapshot<ExtractSnapshot>(job)
    const result = input.result as ExtractModelResult
    if (!snapshot || snapshot.purpose !== 'extract') {
      markLlmJobFailed(db, tenantId, { jobId: job.id, errorCode: 'bad_snapshot' }, clock)
      const fb = notifyModelFallback(
        db,
        tenantId,
        { conversationId: job.conversationId, messageId: job.messageId },
        clock,
      )
      cancelAutoDraft(db, tenantId, job.conversationId)
      return {
        status: 'failed',
        job: getLlmJob(db, tenantId, job.id),
        outbox: fb.outbox,
        resumeAutodraft: false,
        reason: 'bad_snapshot',
      }
    }
    recordModelCallTowardDailyCap(db, tenantId, clock)
    applyExtractSlots(
      db,
      tenantId,
      snapshot,
      result.raw,
      clock,
      deps.interpreterFallback ?? DEFAULT_INTERPRETER_FALLBACK,
    )
    markLlmJobDone(db, tenantId, { jobId: job.id, result }, clock)
    // Reabre autodraft para booking + eventual redact (extrator já done).
    const now = clock.nowMs()
    db.run(
      `UPDATE ai_autodraft_jobs SET state = 'queued', due_at = ?, updated_at = ?
       WHERE tenant_id = ? AND conversation_id = ? AND message_id = ?`,
      now,
      now,
      tenantId,
      job.conversationId,
      job.messageId,
    )
    return {
      status: 'applied',
      job: getLlmJob(db, tenantId, job.id),
      outbox: [],
      resumeAutodraft: true,
    }
  }

  // redact
  const snapshot = parseSnapshot<RedactSnapshot>(job)
  const result = input.result as RedactModelResult
  if (!snapshot || snapshot.purpose !== 'redact') {
    markLlmJobFailed(db, tenantId, { jobId: job.id, errorCode: 'bad_snapshot' }, clock)
    const fb = notifyModelFallback(
      db,
      tenantId,
      { conversationId: job.conversationId, messageId: job.messageId },
      clock,
    )
    cancelAutoDraft(db, tenantId, job.conversationId)
    return {
      status: 'failed',
      job: getLlmJob(db, tenantId, job.id),
      outbox: fb.outbox,
      resumeAutodraft: false,
      reason: 'bad_snapshot',
    }
  }

  const currentFrame = frameVersionOf(db, tenantId, job.conversationId)
  if (snapshot.frameVersion !== currentFrame) {
    markLlmJobFailed(db, tenantId, { jobId: job.id, errorCode: 'stale_frame' }, clock)
    return {
      status: 'stale',
      job: getLlmJob(db, tenantId, job.id),
      outbox: [],
      resumeAutodraft: false,
      reason: 'stale_frame',
    }
  }

  recordModelCallTowardDailyCap(db, tenantId, clock)

  let suggestedText = ''
  let rejection: string | null = null
  let notes = ''
  if (!result.ok || !result.text.trim()) {
    rejection = result.code ?? 'provider_error'
  } else {
    const guarded = guardReplyOutput(result.text)
    if (!guarded.ok) {
      rejection = guarded.reason
    } else {
      const ctx = snapshot.context as AiContextPayload
      const out = validateClientOutbound(guarded.message, {
        source: 'llm',
        context: ctx,
        requireSingleQuestion: false,
        maxChars: REPLY_OUTPUT_MAX_MESSAGE_CHARS,
      })
      if (!out.ok) {
        rejection = out.detail ?? out.reason
      } else {
        suggestedText = applyDraftContinuity(guarded.message, ctx.messages ?? [])
        notes = guarded.notes
      }
    }
  }

  cancelAutoDraft(db, tenantId, job.conversationId)

  if (rejection || !suggestedText.trim()) {
    markLlmJobDone(db, tenantId, { jobId: job.id, result: { ...result, rejection } }, clock)
    insertSuggestion(db, {
      tenantId,
      conversationId: job.conversationId,
      kind: 'reply',
      status: 'failed',
      provider: deps.mode,
      model: result.model ?? AI_MODEL_EXCEPTION,
      suggestedText: '',
      internalNotes: rejection ?? '',
      warningCodes: ['output_rejected'],
      warningLabels: ['Saída rejeitada'],
      sourceRefs: [],
      requestMeta: {
        latencyMs: result.latencyMs ?? 0,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        messageCount: 0,
        mode: deps.mode,
      },
      errorCode: 'invalid_response',
      requestedByClerkUserId: AI_ACTOR_ID,
      requestedByDisplayName: AI_ACTOR_NAME,
      parentSuggestionId: null,
      replyToMessageId: job.messageId,
      origin: 'auto',
      createdAt: clock.nowMs(),
    })
    const fb = notifyModelFallback(
      db,
      tenantId,
      { conversationId: job.conversationId, messageId: job.messageId },
      clock,
    )
    return {
      status: 'applied',
      job: getLlmJob(db, tenantId, job.id),
      outbox: fb.outbox,
      resumeAutodraft: false,
      reason: rejection ?? 'empty',
    }
  }

  markLlmJobDone(db, tenantId, { jobId: job.id, result }, clock)
  const suggestion = insertSuggestion(db, {
    tenantId,
    conversationId: job.conversationId,
    kind: 'reply',
    status: 'pending',
    provider: deps.mode,
    model: result.model ?? AI_MODEL_EXCEPTION,
    suggestedText,
    internalNotes: notes,
    warningCodes: [],
    warningLabels: [],
    sourceRefs: [],
    requestMeta: {
      latencyMs: result.latencyMs ?? 0,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      messageCount: 0,
      mode: deps.mode,
    },
    errorCode: null,
    requestedByClerkUserId: AI_ACTOR_ID,
    requestedByDisplayName: AI_ACTOR_NAME,
    parentSuggestionId: null,
    replyToMessageId: job.messageId,
    origin: 'auto',
    createdAt: clock.nowMs(),
  })

  const buttons = humanTeamOfferButtons(db, tenantId, clock)
  const sent = sendOutboundMessageOp(
    db,
    caller,
    {
      conversationId: job.conversationId,
      body: suggestedText,
      interactive: buttons.length > 0 ? { buttons } : null,
      clientRequestId: `ai-reply:${suggestion.id}`,
      authorClerkUserId: AI_ACTOR_ID,
      authorDisplayName: AI_ACTOR_NAME,
      aiSuggestionId: suggestion.id,
    },
    clock,
  )
  if (textPromisesTeamFollowUp(suggestedText)) {
    promiseTeamFollowUp(
      db,
      tenantId,
      {
        conversationId: job.conversationId,
        detailText: 'Resposta automática prometeu retorno da equipe. A conversa continua aberta à IA.',
        messageId: job.messageId,
      },
      clock,
    )
  }

  return {
    status: 'applied',
    job: getLlmJob(db, tenantId, job.id),
    outbox: sent.outbox,
    resumeAutodraft: false,
  }
}

export function failLlmJobOp(
  db: ClinicDb,
  caller: ClinicCaller,
  clock: Clock,
  input: FailLlmJobInput,
): ApplyLlmResultOutcome {
  const tenantId = caller.tenantId
  const job = getLlmJob(db, tenantId, input.jobId)
  if (!job || job.idempotencyKey !== input.idempotencyKey) {
    return { status: 'missing', job: null, outbox: [], resumeAutodraft: false }
  }
  if (job.state === 'done') {
    return { status: 'done', job, outbox: [], resumeAutodraft: false }
  }
  markLlmJobFailed(db, tenantId, { jobId: job.id, errorCode: input.errorCode }, clock)
  const still = isAutodraftStillCurrent(db, tenantId, job.conversationId, job.messageId)
  let outbox: OutboxRow[] = []
  if (still) {
    cancelAutoDraft(db, tenantId, job.conversationId)
    const fb = notifyModelFallback(
      db,
      tenantId,
      { conversationId: job.conversationId, messageId: job.messageId },
      clock,
    )
    outbox = fb.outbox
  }
  return {
    status: 'failed',
    job: getLlmJob(db, tenantId, job.id),
    outbox,
    resumeAutodraft: false,
    reason: input.errorCode,
  }
}
