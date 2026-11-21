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
import {
  humanTeamOfferButtons,
  notifyHumanHandoff,
  replyHumanTeamOffer,
} from './human-handoff'
import {
  isLocationMapOfferReply,
  locationMapOfferInteractive,
  rewriteRawMapsUrlOutbound,
} from './location-map-offer'
import {
  closedCatalogOrTeamLabel,
  intentLinkPurpose,
  isClosedIntent,
} from '../../ai/intent-classifier'
import { logIntentLlm, type IntentLlmOutcome } from '../../ai/intent-llm-log'
import { catalogReply } from './catalog-reply'
import { FAQ_MISSING_DETAIL_BODY, isFaqWhichServiceBody } from './faq-clarification'
import { ClinicError } from '../errors'
import {
  CLIENT_WEB_LINKS_PER_CONVERSATION,
  clientWebAbrirAgendaLinkPurpose,
  clientWebRouteBody,
  countRecentWebLinks,
  isWebScheduleIntentExemptFromLinkLimit,
  looksLikeClosingAssistOutbound,
  openAgendaReplyButton,
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

  // Classificador correu mas não fechou (aberto / baixa confiança / sombra) → redator.
  if (result.intent && snapshot.classify && !snapshot.classifyShadow) {
    const closed = isClosedIntent(result.intent)
    logIntentLlm({
      tenantId,
      conversationId: job.conversationId,
      jobId: job.id,
      messageId: job.messageId,
      origin: 'llm',
      mode: 'live',
      label: result.intent.label,
      raw: result.intent.raw,
      confidence: result.intent.confidence,
      closed,
      outcome: rejection || !suggestedText.trim() ? 'fallback' : 'redactor',
      model: result.intent.model,
      inputTokens: result.intent.inputTokens,
      outputTokens: result.intent.outputTokens,
    })
  }

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

  // Opção B: redator que cola o URL da clínica → corpo sem link + cta_url Abrir mapa (um toque).
  // TRE-82: fecho («Tudo bem, então…») → cta_url Abrir agenda (não reply+Equipe).
  const mapsUrl = ensureClinicSettings(db, tenantId, clock).googleBusinessUrl
  const rewritten = rewriteRawMapsUrlOutbound(suggestedText, job.conversationId, mapsUrl)
  const outboundBody = rewritten.body
  const mapInteractive = rewritten.useMapButtons
    ? locationMapOfferInteractive(mapsUrl, db, tenantId, clock)
    : null
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
  // Preferência 21/11: redator → cta_url Abrir agenda (home) quando possível; senão só Equipe
  // (nunca reply Abrir agenda + Equipe). Fecho / mapa já têm cta próprio.
  let infoCta: Awaited<ReturnType<NonNullable<AiAssistDeps['prepareClientWebOffer']>>> = null
  if (
    !mapInteractive &&
    !closingCta &&
    deps.autoBookPaused !== true &&
    deps.prepareClientWebOffer
  ) {
    try {
      infoCta = await deps.prepareClientWebOffer({
        tenantId,
        conversationId: job.conversationId,
        purpose: 'home',
        appointmentId: null,
        serviceId: null,
        audienceLine: null,
        variantIds: [],
      })
      if (!infoCta?.ctaUrl) infoCta = null
    } catch {
      infoCta = null
    }
  }
  const buttons =
    mapInteractive || closingCta || infoCta
      ? null
      : humanTeamOfferButtons(db, tenantId, clock)
  const sent = sendOutboundMessageOp(
    db,
    caller,
    {
      conversationId: job.conversationId,
      body: outboundBody,
      interactive: mapInteractive
        ? mapInteractive
        : closingCta
          ? closingCta
          : infoCta
            ? infoCta
            : buttons && buttons.length > 0
              ? { buttons }
              : null,
      omitHumanTeamAugment: Boolean(closingCta || infoCta || mapInteractive?.ctaUrl),
      clientRequestId:
        closingCta || infoCta ? `ai-web-agendar:${job.messageId}` : `ai-reply:${suggestion.id}`,
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
 * DEC-221 / staging: classificador etiquetou agenda/misto/remarcar/cancelar. Envia frase fixa +
 * Abrir agenda (cta_url) em vez do redator. Pausa da owner / teto / sem marcação futura = regras do léxico.
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
  // Mesma regra do léxico (DEC-202): remarcar ou cancelar sem marcação futura → frase de agendar.
  const noUpcoming = (purpose === 'remarcar' || purpose === 'cancelar') && future.length === 0
  const bodyPurpose = noUpcoming ? 'agendar' : purpose
  // DEC-220: token do Abrir agenda → home (excepto remarcar/cancelar com marcação).
  const issuedPurpose = clientWebAbrirAgendaLinkPurpose(bodyPurpose)
  const overLimit =
    countRecentWebLinks(db, tenantId, job.conversationId, clock.nowMs()) >= CLIENT_WEB_LINKS_PER_CONVERSATION
  const exemptFromLinkLimit = isWebScheduleIntentExemptFromLinkLimit({
    purpose: bodyPurpose,
    noUpcoming,
  })
  // Teto bloqueia cta só em «quero marcar»; remarca/cancela ainda recebem cta_url (DEC-220).
  const allowCta = deps.autoBookPaused !== true && (!overLimit || exemptFromLinkLimit)

  let offered: Awaited<ReturnType<NonNullable<AiAssistDeps['prepareClientWebOffer']>>> = null
  if (allowCta && deps.prepareClientWebOffer) {
    try {
      offered = await deps.prepareClientWebOffer({
        tenantId,
        conversationId: job.conversationId,
        purpose: issuedPurpose,
        appointmentId:
          (issuedPurpose === 'remarcar' || issuedPurpose === 'cancelar') && future.length === 1
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

  const logLink = (outcome: IntentLlmOutcome, sent: boolean) =>
    logIntentLlm({
      tenantId,
      conversationId: job.conversationId,
      jobId: job.id,
      messageId: job.messageId,
      origin: 'llm',
      mode: 'live',
      label: input.result.intent?.label,
      raw: input.result.intent?.raw,
      confidence: input.result.intent?.confidence,
      closed: true,
      linkPurpose: issuedPurpose,
      handler: 'link',
      outcome,
      sent,
      model: input.result.intent?.model,
      inputTokens: input.result.intent?.inputTokens,
      outputTokens: input.result.intent?.outputTokens,
    })

  const body = clientWebRouteBody({ purpose: bodyPurpose, serviceName: null, noUpcoming })
  if (offered) {
    const sent = sendOutboundMessageOp(
      db,
      caller,
      {
        conversationId: job.conversationId,
        body,
        interactive: offered,
        clientRequestId: `ai-web-${issuedPurpose}:${job.messageId}`,
        authorClerkUserId: AI_ACTOR_ID,
        authorDisplayName: AI_ACTOR_NAME,
      },
      clock,
    )
    logLink('cta', true)
    return { status: 'applied', job: getLlmJob(db, tenantId, job.id), outbox: sent.outbox, resumeAutodraft: false }
  }
  // DEC-202 / TRE-83: sem cta_url (lab/http) → frase + reply; remarca/cancela com URL usam cta acima.
  if (allowCta) {
    try {
      const sent = sendOutboundMessageOp(
        db,
        caller,
        {
          conversationId: job.conversationId,
          body,
          interactive: { buttons: [openAgendaReplyButton()] },
          clientRequestId: `ai-web-${issuedPurpose}:${job.messageId}`,
          authorClerkUserId: AI_ACTOR_ID,
          authorDisplayName: AI_ACTOR_NAME,
        },
        clock,
      )
      logLink('cta_reply', true)
      return { status: 'applied', job: getLlmJob(db, tenantId, job.id), outbox: sent.outbox, resumeAutodraft: false }
    } catch {
      /* cai no handoff só se owner/teto de marcar; senão tenta texto */
    }
    try {
      const sent = sendOutboundMessageOp(
        db,
        caller,
        {
          conversationId: job.conversationId,
          body,
          clientRequestId: `ai-web-${issuedPurpose}:${job.messageId}`,
          authorClerkUserId: AI_ACTOR_ID,
          authorDisplayName: AI_ACTOR_NAME,
        },
        clock,
      )
      logLink('cta_reply', true)
      return { status: 'applied', job: getLlmJob(db, tenantId, job.id), outbox: sent.outbox, resumeAutodraft: false }
    } catch {
      /* envio recusado */
    }
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
  logLink('handoff', handoff.outbox.length > 0)
  return {
    status: 'applied',
    job: getLlmJob(db, tenantId, job.id),
    outbox: handoff.outbox,
    resumeAutodraft: false,
    reason: overLimit && !exemptFromLinkLimit ? 'web_link_limit' : 'human_handoff',
  }
}

/**
 * DEC-221 / staging: etiqueta fechada `price` | `team` | `faq_catalog` | `faq_clinic`
 * → handlers determinísticos (`catalogReply`, oferta de equipe, FAQ DEC-185). Nunca redige.
 */
export async function applyClosedHandlerOp(
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
  const kind = closedCatalogOrTeamLabel(input.result.intent)
  if (!snapshot || snapshot.purpose !== 'redact' || !kind) {
    markLlmJobFailed(db, tenantId, { jobId: job.id, errorCode: 'bad_snapshot' }, clock)
    return { status: 'failed', job: getLlmJob(db, tenantId, job.id), outbox: [], resumeAutodraft: false, reason: 'bad_snapshot' }
  }
  recordModelCallTowardDailyCap(db, tenantId, clock)
  markLlmJobDone(db, tenantId, { jobId: job.id, result: { ...input.result, intentOrigin: 'llm' } }, clock)
  cancelAutoDraft(db, tenantId, job.conversationId)

  const logClosed = (outcome: IntentLlmOutcome, sent: boolean) =>
    logIntentLlm({
      tenantId,
      conversationId: job.conversationId,
      jobId: job.id,
      messageId: job.messageId,
      origin: 'llm',
      mode: 'live',
      label: input.result.intent?.label,
      raw: input.result.intent?.raw,
      confidence: input.result.intent?.confidence,
      closed: true,
      handler: kind,
      outcome,
      sent,
      model: input.result.intent?.model,
      inputTokens: input.result.intent?.inputTokens,
      outputTokens: input.result.intent?.outputTokens,
    })

  if (kind === 'team') {
    const offer = replyHumanTeamOffer(db, tenantId, {
      conversationId: job.conversationId,
      clientRequestId: `ai-team-offer:${job.messageId}`,
    }, clock)
    logClosed('team', offer.outbox.length > 0)
    return { status: 'applied', job: getLlmJob(db, tenantId, job.id), outbox: offer.outbox, resumeAutodraft: false }
  }

  // Sem conversationId: a pergunta do snapshot é a fonte (não misturar com o inbound
  // original que só abriu o job de redact — senão price/FAQ leem a frase errada).
  // TRE-113: `faq_catalog` força o handler de cadastro (sem depender de cues).
  // Telemetria TRE-115: `usedMissing` distingue cadastro vazio de hit de catálogo.
  const question = snapshot.question
  let body =
    catalogReply(db, tenantId, question, clock, {
      forceFaqCatalog: kind === 'faq_catalog',
    }) ?? null
  const usedMissing = !body && kind === 'faq_catalog'
  if (usedMissing) body = FAQ_MISSING_DETAIL_BODY
  if (!body) {
    // Preço / FAQ institucional sem facto: oferta de equipe (não inventar com LLM).
    const offer = replyHumanTeamOffer(db, tenantId, {
      conversationId: job.conversationId,
      clientRequestId: `ai-closed-fallback:${job.messageId}`,
    }, clock)
    logClosed('team', offer.outbox.length > 0)
    return { status: 'applied', job: getLlmJob(db, tenantId, job.id), outbox: offer.outbox, resumeAutodraft: false }
  }
  const catalogOutcome: IntentLlmOutcome = usedMissing ? 'catalog_missing' : 'catalog'

  const locationOffer = isLocationMapOfferReply(body)
  const mapsUrl = locationOffer ? ensureClinicSettings(db, tenantId, clock).googleBusinessUrl : ''
  const locationInteractive = locationOffer
    ? locationMapOfferInteractive(mapsUrl, db, tenantId, clock)
    : null
  const whichService = isFaqWhichServiceBody(body)

  // DEC-185 / faq_clinic: texto publicado sem Abrir agenda por defeito.
  // TRE-113: «De qual serviço?» também sem CTA de agenda.
  const allowAgendaCta = kind !== 'faq_clinic' && !whichService
  let agendaCta: Awaited<ReturnType<NonNullable<AiAssistDeps['prepareClientWebOffer']>>> = null
  if (allowAgendaCta && !locationOffer && deps.autoBookPaused !== true && deps.prepareClientWebOffer) {
    try {
      const offered = await deps.prepareClientWebOffer({
        tenantId,
        conversationId: job.conversationId,
        purpose: 'home',
        appointmentId: null,
        serviceId: null,
        audienceLine: null,
        variantIds: [],
      })
      agendaCta = offered?.ctaUrl ? offered : null
    } catch {
      agendaCta = null
    }
  }

  const interactive = agendaCta
    ? agendaCta
    : locationInteractive
      ? locationInteractive
      : locationOffer || !allowAgendaCta
        ? undefined
        : { buttons: [openAgendaReplyButton()] }

  try {
    const sent = sendOutboundMessageOp(
      db,
      caller,
      {
        conversationId: job.conversationId,
        body,
        interactive,
        omitHumanTeamAugment: true,
        clientRequestId: agendaCta
          ? `ai-web-home:${job.messageId}`
          : `ai-closed-${kind}:${job.messageId}`,
        authorClerkUserId: AI_ACTOR_ID,
        authorDisplayName: AI_ACTOR_NAME,
      },
      clock,
    )
    // Missing fixo prevalece (mede redator indevido vs cadastro vazio); senão cta vs catalog.
    const outcome: IntentLlmOutcome = usedMissing
      ? 'catalog_missing'
      : agendaCta
        ? 'cta'
        : catalogOutcome
    logClosed(outcome, sent.outbox.length > 0)
    return { status: 'applied', job: getLlmJob(db, tenantId, job.id), outbox: sent.outbox, resumeAutodraft: false }
  } catch (err) {
    if (!(err instanceof ClinicError)) throw err
    logClosed('send_refused', false)
    return {
      status: 'applied',
      job: getLlmJob(db, tenantId, job.id),
      outbox: [],
      resumeAutodraft: false,
      reason: 'send_refused',
    }
  }
}
