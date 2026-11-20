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
import type { OutboxRow } from '../outbox'
import { AI_ACTOR_ID, AI_ACTOR_NAME } from '../ai-actor'
import {
  cancelAutoDraft,
  getAutoDraftJob,
} from './autodraft'
import { ensureClinicSettings } from '../config/settings'
import { sendOutboundMessageOp } from '../inbox/operations'
import { humanTeamOfferButtons, notifyHumanHandoff } from './human-handoff'
import { locationMapOfferButtons, rewriteRawMapsUrlOutbound } from './location-map-offer'
import { intentLinkPurpose } from '../../ai/intent-classifier'
import {
  CLIENT_WEB_LINKS_PER_CONVERSATION,
  clientWebRouteBody,
  countRecentWebLinks,
  looksLikeClosingAssistOutbound,
} from '../../clientweb/offer'
import { loadUpcomingAppointments } from './upcoming'
import {
  claimLlmJobOp,
  getLlmJob,
  markLlmJobDone,
  markLlmJobFailed,
  parseSnapshot,
  type ClaimLlmJobResult,
  type LlmJobRow,
} from './llm-jobs'
import { type RedactModelResult, type RedactSnapshot, frameVersionOf } from './llm-snapshot'
import { notifyModelFallback } from './model-fallback'
import { validateClientOutbound } from './outbound-validate'
import { insertSuggestion } from './suggestions'
import type { AiAssistDeps } from './types'
import { recordModelCallTowardDailyCap } from './usage'
import {
  promiseTeamFollowUp,
  textPromisesTeamFollowUp,
} from './promise-team-follow-up'

export type ApplyLlmResultInput = {
  jobId: string
  idempotencyKey: string
  /** Resultado do modelo (redator de exceção). */
  result: RedactModelResult
}

export type ApplyLlmResultOutcome = {
  status: 'applied' | 'stale' | 'done' | 'failed' | 'missing'
  job: LlmJobRow | null
  /** Outbox a fan-out (WhatsApp / typing). */
  outbox: OutboxRow[]
  /** Mantido por compatibilidade com o consumer; hoje é sempre falso (sem extrator). */
  resumeAutodraft: boolean
  reason?: string
}

export type FailLlmJobInput = {
  jobId: string
  idempotencyKey: string
  errorCode: string
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
 * Aplica o resultado do redator de exceção: sugestão + envio, ou DEC-107 em falha.
 */
export async function applyLlmResultOp(
  db: ClinicDb,
  caller: ClinicCaller,
  clock: Clock,
  deps: AiAssistDeps,
  input: ApplyLlmResultInput,
): Promise<ApplyLlmResultOutcome> {
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

  // Opção B: redator que cola o URL da clínica → corpo sem link + Abrir mapa.
  // TRE-82: fecho («Tudo bem, então…») → cta_url Abrir agenda (não reply+Equipe).
  const mapsUrl = ensureClinicSettings(db, tenantId, clock).googleBusinessUrl
  const rewritten = rewriteRawMapsUrlOutbound(suggestedText, job.conversationId, mapsUrl)
  const outboundBody = rewritten.body
  let closingCta: Awaited<ReturnType<NonNullable<AiAssistDeps['prepareClientWebOffer']>>> = null
  if (
    !rewritten.useMapButtons &&
    looksLikeClosingAssistOutbound(outboundBody) &&
    deps.autoBookPaused !== true &&
    deps.prepareClientWebOffer
  ) {
    try {
      closingCta = await deps.prepareClientWebOffer({
        tenantId,
        conversationId: job.conversationId,
        purpose: 'agendar',
        appointmentId: null,
        serviceId: null,
        audienceLine: null,
        variantIds: [],
      })
      if (!closingCta?.ctaUrl) closingCta = null
    } catch {
      closingCta = null
    }
  }
  const buttons = rewritten.useMapButtons
    ? locationMapOfferButtons(db, tenantId, clock)
    : closingCta
      ? null
      : humanTeamOfferButtons(db, tenantId, clock)
  const sent = sendOutboundMessageOp(
    db,
    caller,
    {
      conversationId: job.conversationId,
      body: outboundBody,
      interactive: closingCta
        ? closingCta
        : buttons && buttons.length > 0
          ? { buttons }
          : null,
      omitHumanTeamAugment: Boolean(closingCta),
      clientRequestId: closingCta ? `ai-web-agendar:${job.messageId}` : `ai-reply:${suggestion.id}`,
      authorClerkUserId: AI_ACTOR_ID,
      authorDisplayName: AI_ACTOR_NAME,
      aiSuggestionId: suggestion.id,
    },
    clock,
  )
  if (textPromisesTeamFollowUp(outboundBody)) {
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

/**
 * P4 (Proposto, só staging): o classificador LLM reconheceu um pedido de agenda que o léxico
 * deixou passar. Envia o link «Abrir agenda» com a frase fixa em vez da resposta do redator; com a
 * pausa da owner, sem link possível ou acima do limite, passa à equipe. A classe e a confiança
 * ficam no resultado do job (origem = LLM).
 */
export async function applyIntentLinkOp(
  db: ClinicDb,
  caller: ClinicCaller,
  clock: Clock,
  deps: AiAssistDeps,
  input: ApplyLlmResultInput,
): Promise<ApplyLlmResultOutcome> {
  const tenantId = caller.tenantId
  const job = getLlmJob(db, tenantId, input.jobId)
  if (!job || job.idempotencyKey !== input.idempotencyKey) {
    return { status: 'missing', job: null, outbox: [], resumeAutodraft: false }
  }
  if (job.state === 'done') return { status: 'done', job, outbox: [], resumeAutodraft: false }
  if (job.state === 'failed' || job.state === 'stale') {
    return { status: 'failed', job, outbox: [], resumeAutodraft: false, reason: job.errorCode ?? 'failed' }
  }
  if (!isAutodraftStillCurrent(db, tenantId, job.conversationId, job.messageId)) {
    markLlmJobFailed(db, tenantId, { jobId: job.id, errorCode: 'stale_message' }, clock)
    return { status: 'stale', job: getLlmJob(db, tenantId, job.id), outbox: [], resumeAutodraft: false, reason: 'stale_message' }
  }
  const snapshot = parseSnapshot<RedactSnapshot>(job)
  const purpose = intentLinkPurpose(input.result.intent)
  if (!snapshot || snapshot.purpose !== 'redact' || !purpose) {
    markLlmJobFailed(db, tenantId, { jobId: job.id, errorCode: 'bad_snapshot' }, clock)
    return { status: 'failed', job: getLlmJob(db, tenantId, job.id), outbox: [], resumeAutodraft: false, reason: 'bad_snapshot' }
  }
  recordModelCallTowardDailyCap(db, tenantId, clock)

  const conv = db.get<{ contact_id: string }>(
    'SELECT contact_id FROM conversations WHERE tenant_id = ? AND id = ?',
    tenantId,
    job.conversationId,
  )
  const future = conv ? loadUpcomingAppointments(db, tenantId, conv.contact_id, clock.nowMs(), 2) : []
  // Mesma regra do léxico (DEC-202): remarcar ou cancelar sem marcação futura abre em agendar.
  const noUpcoming = (purpose === 'remarcar' || purpose === 'cancelar') && future.length === 0
  const linkPurpose = noUpcoming ? 'agendar' : purpose
  const overLimit =
    countRecentWebLinks(db, tenantId, job.conversationId, clock.nowMs()) >= CLIENT_WEB_LINKS_PER_CONVERSATION
  const paused = deps.autoBookPaused === true || overLimit

  let offered: Awaited<ReturnType<NonNullable<AiAssistDeps['prepareClientWebOffer']>>> = null
  if (!paused && deps.prepareClientWebOffer) {
    try {
      offered = await deps.prepareClientWebOffer({
        tenantId,
        conversationId: job.conversationId,
        purpose: linkPurpose,
        appointmentId:
          (linkPurpose === 'remarcar' || linkPurpose === 'cancelar') && future.length === 1
            ? (future[0]?.id ?? null)
            : null,
        serviceId: null,
        audienceLine: null,
        variantIds: [],
      })
    } catch {
      offered = null
    }
  }

  markLlmJobDone(db, tenantId, { jobId: job.id, result: { ...input.result, intentOrigin: 'llm' } }, clock)
  cancelAutoDraft(db, tenantId, job.conversationId)
  console.info(
    JSON.stringify({
      level: 'info',
      event: 'ai.intent_llm',
      tenantId,
      conversationId: job.conversationId,
      origin: 'llm',
      label: input.result.intent?.label,
      confidence: input.result.intent?.confidence,
      linkPurpose,
      sent: Boolean(offered),
    }),
  )

  if (offered) {
    const sent = sendOutboundMessageOp(
      db,
      caller,
      {
        conversationId: job.conversationId,
        body: clientWebRouteBody({ purpose: linkPurpose, serviceName: null, noUpcoming }),
        interactive: offered,
        clientRequestId: `ai-web-${linkPurpose}:${job.messageId}`,
        authorClerkUserId: AI_ACTOR_ID,
        authorDisplayName: AI_ACTOR_NAME,
      },
      clock,
    )
    return { status: 'applied', job: getLlmJob(db, tenantId, job.id), outbox: sent.outbox, resumeAutodraft: false }
  }
  const handoff = notifyHumanHandoff(
    db,
    tenantId,
    {
      conversationId: job.conversationId,
      reason: 'human_only',
      clientRequestId: `ai-web-handoff:${job.messageId}`,
      inboundText: snapshot.question,
    },
    clock,
  )
  return {
    status: 'applied',
    job: getLlmJob(db, tenantId, job.id),
    outbox: handoff.outbox,
    resumeAutodraft: false,
    reason: overLimit ? 'web_link_limit' : 'human_handoff',
  }
}
