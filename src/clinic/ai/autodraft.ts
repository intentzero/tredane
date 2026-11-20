/**
 * Rascunho automático da IA a cada mensagem da cliente (aprovado por Paulo, 27/10/2026).
 * - Debounce adaptativo DEC-111: 0 s botão/lista, 2–3 s pedido completo,
 *   300 ms abertura do hub (opção C, 04/11/2026), 7 s texto aberto.
 * - DEC-202: o chat não marca, não remarca e não cancela. Pedido de marcar, remarcar,
 *   cancelar ou de vaga recebe uma frase fixa e o botão «Abrir agenda» (página web da
 *   cliente, ADR-0018); com a pausa da owner ou sem link possível, passa à equipe.
 * - A IA só informa: catálogo, horário, preço, FAQ e, para pergunta aberta, o redator de
 *   exceção com validador (DEC-104).
 * - O texto da IA sai sozinho, sem clique em Enviar, com o botão de falar com a equipe.
 *   Injeção e assunto fora do agendamento pausam a IA (DEC-083). Modelo falhou / saída
 *   rejeitada → frase DEC-107 + alerta à equipe, sem pausar a IA (#404 / #489).
 */
import { AI_ACTOR_ID, AI_ACTOR_NAME } from '../ai-actor'
import { AI_TIMEOUT_MS, detectStrongInjectionSignals } from '../../ai'
import type { Clock } from '../../db/clock'
import type { ClinicCaller } from '../envelopes'
import { ClinicError } from '../errors'
import { ensureClinicSettings, isClinicAiAssistEnabled } from '../config/settings'
import { listServices } from '../config/services'
import { buildCancellationPolicyReply } from './policy-reply'
import { handleIdleTextReply } from '../followup/idle'
import { POST_BOOKING_BODY } from '../followup/post-booking'
import { pickTerminarFarewell } from '../followup/terminar-farewell'
import { suppressFollowupsAfterClientEnd } from '../followup/suppress-after-end'
import { needsAudienceLine } from './variant-line'
import { getConversation } from '../inbox/conversations'
import { isHumanStaffAuthor } from '../inbox/human-prefix'
import { sendOutboundMessageOp } from '../inbox/operations'
import {
  CLIENT_WEB_LINKS_PER_CONVERSATION,
  CLIENT_WEB_TIME_PICK_BODY,
  clientWebOfferBody,
  clientWebRouteBody,
  stripScheduleOffer,
  countRecentWebLinks,
  isOpenAgendaButtonTitle,
} from '../../clientweb/offer'
import { isGreetingOnly, isSlotTimePickByText, servicesCitedInText } from '../../clientweb/route-intent'
import {
  clientWebLinkFieldsFromText,
  clientWebSchedulePrefsFromText,
} from '../../clientweb/route-context'
import {
  clinicTodayOpenState,
  hubMeusBody,
  hubOpeningBody,
} from '../../clientweb/hub'
import { messagingWindowForConversation } from '../inbox/window'
import type { OutboxRow } from '../outbox'
import type { ClinicDb } from '../store'
import { classifyTurn } from './classify-turn'
import { catalogReply } from './catalog-reply'
import { priceFollowupInteractiveButtons } from '../followup/post-booking'
import {
  autodraftDebounceMs,
  interpretTurnForDebounce,
  shouldEnqueueTypingDuringDebounce,
} from './debounce'
import {
  AI_TRANSPARENCY_TEXT,
  OFF_TOPIC_SMALL_TALK_TEXT,
  handoffReason,
  humanTeamOfferButtons,
  inboundWarrantsHandoffResume,
  inboundWarrantsParallelHandoffAutomation,
  isFarewellWhileHandoffPaused,
  isHumanTeamOfferAllowed,
  notifyHumanHandoff,
  type AiReplyPauseReason,
  readAiReplyPause,
  replyAfterHoursHumanRequest,
  replyWhileHandoffPaused,
  resumeAiReply,
  shouldAcknowledgeWhileHandoffPaused,
} from './human-handoff'
import {
  isLocationMapOfferReply,
  locationMapOfferButtons,
  rewriteRawMapsUrlOutbound,
} from './location-map-offer'
import {
  clearMediaAskTextOnRealInbound,
  decideMediaOnlyTurn,
  markMediaAskTextAsked,
  MEDIA_ASK_TEXT,
} from './media-ask-text'
import { notifyModelFallback } from './model-fallback'
import {
  HOW_TO_END_REPLY,
  isHowToEndQuestion,
  markEndHelpHintSent,
} from './end-help-hint'
import {
  flagConversationForReview,
  isReviewFlagRequest,
  parseReviewFlagRequest,
  REVIEW_FLAG_CLIENT_ACK,
  reviewFlagAckInteractiveButtons,
} from '../inbox/review-flag'
import {
  classifySensitive,
  FAREWELL_RE,
  hasAiTransparencyQuestion,
  isOffTopicSmallTalk,
  wantsHumanPause,
  hasPolicyQuestion,
  hasSoftDeclineRequest,
  hasStopRequest,
} from './nlu/sensitive'
import { loadUpcomingAppointments } from './upcoming'
import { isConversationPaused } from './protection'
import { filledSlots, getBookingFrame } from './schedule-session'
import { getSuggestion, insertSuggestion, markSuggestionSuperseded } from './suggestions'
import type { AiAssistDeps, AiSuggestionRow } from './types'
import {
  deriveDropStep,
  getOpenBookingSession,
  touchBookingSessionOnTurn,
} from './booking-session'
import {
  emitTurnDecided,
  routeFromAutodraftOutcome,
  variantsChangedInTurn,
  zonesAskedBeforeTurn,
} from './turn-decided'
import { mergeFriction } from './turn-friction'
import { loadTurnContext } from './turn-context'
import { enqueueTypingIndicator } from './typing-indicator'
import { getAiDailyUsage, recordModelCallTowardDailyCap } from './usage'
import { checkAutomationQuota, contactIdForConversation, recordLimitReached } from './abuse-limits'
import { clinicCivilDateFromUtc } from '../scheduling/timezone'
import { generateExceptionReply } from './exception-reply'
import {
  promiseTeamFollowUp,
  textPromisesTeamFollowUp,
} from './promise-team-follow-up'
import { auditOutboundForFalseConfirmation } from '../../conversation-metrics/false-confirmation-audit'
import {
  normalizeOutboundForRepeatCheck,
  outboundLooksLikeMisunderstanding,
} from '../../conversation-metrics/detect'
import { getConversationQualityCentralDb } from '../../conversation-metrics/hook'
import { incrementMisunderstandingTurn } from '../../conversation-metrics/session-counters'
import { createLlmJob, hasOpenLlmJobForConversation } from './llm-jobs'
import { buildRedactSnapshot } from './llm-snapshot'

export const AUTODRAFT_ACTOR_ID = AI_ACTOR_ID
const AUTODRAFT_ACTOR_NAME = AI_ACTOR_NAME

/**
 * Depois deste prazo um job deixado em `generating` é órfão: o alarme anterior
 * não chegou a apagar a linha (fetch do gateway que não rejeita no abort, ou
 * isolate morto). O painel trata qualquer linha como spinner.
 */
export const AUTODRAFT_STALE_MS = AI_TIMEOUT_MS + 15_000

/** Teto do turno `alarm()` em `runDueAutoDrafts` (evita N× AI_TIMEOUT no mesmo isolate). */
export const AUTODRAFT_ALARM_BUDGET_MS = 45_000

export type AutoDraftJob = {
  conversationId: string
  messageId: string
  dueAt: number
  state: 'queued' | 'generating'
  createdAt: number
}

type JobSql = {
  conversation_id: string
  message_id: string
  due_at: number
  state: 'queued' | 'generating'
  created_at: number
}

function mapJob(r: JobSql): AutoDraftJob {
  return {
    conversationId: r.conversation_id,
    messageId: r.message_id,
    dueAt: r.due_at,
    state: r.state,
    createdAt: r.created_at,
  }
}

export function getAutoDraftJob(db: ClinicDb, tenantId: string, conversationId: string): AutoDraftJob | null {
  const r = db.get<JobSql>(
    `SELECT conversation_id, message_id, due_at, state, created_at FROM ai_autodraft_jobs
     WHERE tenant_id = ? AND conversation_id = ?`,
    tenantId,
    conversationId,
  )
  return r ? mapJob(r) : null
}

/** Agenda (ou reagenda) o rascunho. Mensagem nova empurra o prazo. Null se IA desligada. */
export function enqueueAutoDraft(
  db: ClinicDb,
  tenantId: string,
  input: { conversationId: string; messageId: string; fromInteractive?: boolean },
  clock: Clock,
): AutoDraftJob | null {
  if (!isClinicAiAssistEnabled(db, tenantId)) return null
  const now = clock.nowMs()
  const body =
    db.get<{ body: string }>(
      `SELECT body FROM messages WHERE tenant_id = ? AND id = ?`,
      tenantId,
      input.messageId,
    )?.body ?? ''
  // #475 S4 opção B: texto de verdade limpa «já pedi» mesmo com IA pausada (antes do return).
  clearMediaAskTextOnRealInbound(db, tenantId, input.conversationId, body, now)
  // DEC-157: «avaliar»/«feedback» é orthogonal à pausa DEC-083 — enfileira mesmo pausada.
  if (isConversationPaused(db, tenantId, input.conversationId) && !isReviewFlagRequest(body)) {
    const pause = readAiReplyPause(db, tenantId, input.conversationId)
    const reason = (pause?.reason ?? 'off_purpose') as AiReplyPauseReason
    const teamOpen = isHumanTeamOfferAllowed(db, tenantId, clock)
    const parallelAutomation =
      teamOpen &&
      inboundWarrantsParallelHandoffAutomation(body, reason, {
        db,
        tenantId,
        conversationId: input.conversationId,
        fromInteractive: input.fromInteractive,
      })
    if (
      !parallelAutomation &&
      !inboundWarrantsHandoffResume(body, reason) &&
      !shouldAcknowledgeWhileHandoffPaused(reason) &&
      !isFarewellWhileHandoffPaused(body, reason)
    ) {
      return null
    }
  }
  // Mesmo detector do caminho do hub em runDueAutoDrafts (TR-306).
  // Pedido completo (dia+período) sobrescreve o 300 ms mesmo se VAGUE_BOOK casar.
  // Quadro com serviço ou pedido não é abertura: o debounce curto do hub não aplica.
  const frameForDebounce = getBookingFrame(db, tenantId, input.conversationId)
  const hubOpening = isGreetingOnly(body)
  const tz = ensureClinicSettings(db, tenantId, clock).timezone
  const interpretation = interpretTurnForDebounce({
    turnText: body,
    messageId: input.messageId,
    today: clinicCivilDateFromUtc(tz, clock.nowMs()),
    services: listServices(db, tenantId).filter((s) => s.active),
    pending: frameForDebounce?.pending ?? null,
  })
  const waitMs = autodraftDebounceMs({
    text: body,
    fromInteractive: input.fromInteractive,
    hubOpening,
    pendingSlot: frameForDebounce?.pending?.slot ?? null,
    interpretation,
  })
  db.run(
    `INSERT INTO ai_autodraft_jobs (tenant_id, conversation_id, message_id, due_at, state, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'queued', ?, ?)
     ON CONFLICT (tenant_id, conversation_id) DO UPDATE SET
       message_id = excluded.message_id, due_at = excluded.due_at,
       state = 'queued', updated_at = excluded.updated_at`,
    tenantId,
    input.conversationId,
    input.messageId,
    now + waitMs,
    now,
    now,
  )
  // Typing cedo: hub/pending (DEC-111), pedido completo (#813) e interpretador confiante.
  if (shouldEnqueueTypingDuringDebounce(waitMs, body, interpretation)) {
    try {
      enqueueTypingIndicator(
        db,
        tenantId,
        { conversationId: input.conversationId, messageId: input.messageId },
        clock,
      )
    } catch {
      /* fail-soft: indicador nunca aborta o rascunho */
    }
  }
  return getAutoDraftJob(db, tenantId, input.conversationId)
}

/** Depois de devolver à IA: a mensagem que chegou durante a pausa ainda não tem resposta. */
export function enqueueLatestUnansweredInbound(
  db: ClinicDb,
  tenantId: string,
  conversationId: string,
  clock: Clock,
): AutoDraftJob | null {
  const row = db.get<{ id: string; direction: string }>(
    `SELECT id, direction FROM messages
     WHERE tenant_id = ? AND conversation_id = ?
     ORDER BY created_at DESC, rowid DESC
     LIMIT 1`,
    tenantId,
    conversationId,
  )
  if (!row || row.direction !== 'inbound') return null
  return enqueueAutoDraft(db, tenantId, { conversationId, messageId: row.id }, clock)
}

export function cancelAutoDraft(db: ClinicDb, tenantId: string, conversationId: string): void {
  db.run(`DELETE FROM ai_autodraft_jobs WHERE tenant_id = ? AND conversation_id = ?`, tenantId, conversationId)
}

export function nextAutoDraftDueAt(db: ClinicDb, tenantId: string): number | null {
  const r = db.get<{ due: number | null }>(
    `SELECT MIN(due_at) AS due FROM ai_autodraft_jobs WHERE tenant_id = ? AND state = 'queued'`,
    tenantId,
  )
  return r?.due ?? null
}

export type AutoDraftOutcome = {
  conversationId: string
  messageId: string
  status: 'ready' | 'failed' | 'skipped' | 'superseded' | 'cap_reached' | 'awaiting_llm'
  suggestion: AiSuggestionRow | null
  reason?: string
  /** Texto da IA enviado sem clique, quando não houve proposta. */
  replyOutbox?: OutboxRow[]
  /** Job enfileirado na `tredane-llm-*` (DEC-188). */
  llmQueueMessage?: import('./llm-queue-types').LlmQueueMessage
}

/**
 * Direção da última mensagem não-system. Empate em `created_at` → `rowid DESC`
 * (ordem de inserção). Não usar `id DESC`: `msg_*` é UUID aleatório (#638 Deploy
 * falhou em media-ask S3/S4 com `already_answered` flaky).
 */
function lastMessageDirection(db: ClinicDb, tenantId: string, conversationId: string): string | null {
  const r = db.get<{ direction: string }>(
    `SELECT direction FROM messages WHERE tenant_id = ? AND conversation_id = ? AND direction != 'system'
     ORDER BY created_at DESC, rowid DESC LIMIT 1`,
    tenantId,
    conversationId,
  )
  return r?.direction ?? null
}

/** Clique Confirmar da proposta — S5 trata; autodraft não deve reinterpretar. */
function isProposalConfirmButtonBody(body: string): boolean {
  return /^\[Botão\]\s*Confirmar\s*$/i.test(body.trim())
}

/**
 * Resposta interativa WhatsApp (`button_reply` / `list_reply`).
 * O ingest grava `[Botão]…` / `[Lista]…` e enfileira autodraft; o handler
 * dedicado (`handleProposalButtonClick` → choice / proposta / idle / handoff)
 * cancela o job. Se o alarme correr antes do cancel (debounce curto / race),
 * o autodraft reemite o que o clique já vai realizar:
 * - linha → ask-tipo com handoff + Opções (staging Paulo 09/11 ~11:56, #640);
 * - Sim do eco DEC-137 → duas ofertas Horários iguais (~12:20, #641);
 * - Escolher Feminino/Masculino da consulta DEC-142 → duas listas «Temos:»
 *   iguais (~13:42, catalog_consult + handleCatalogAudienceClick).
 */
export function isInteractiveReplyBody(body: string): boolean {
  return /^\[(Botão|Lista)\]\s+/i.test(body.trim())
}

/**
 * Um job `generating` no início do alarme é sempre órfão: este DO não corre
 * dois alarmes ao mesmo tempo, e o envio só acontece depois de apagar a linha.
 * Reabre para a mesma passagem. Sem isto o spinner fica preso para sempre.
 */
function reclaimOrphanGenerating(db: ClinicDb, tenantId: string, now: number): void {
  const rows = db.all<{ conversation_id: string }>(
    `SELECT conversation_id FROM ai_autodraft_jobs WHERE tenant_id = ? AND state = 'generating'`,
    tenantId,
  )
  let count = 0
  for (const row of rows) {
    // DEC-188: job à espera da fila LLM não é órfão — não reabrir.
    if (hasOpenLlmJobForConversation(db, tenantId, row.conversation_id)) continue
    db.run(
      `UPDATE ai_autodraft_jobs SET state = 'queued', due_at = ?, updated_at = ?
       WHERE tenant_id = ? AND conversation_id = ? AND state = 'generating'`,
      now,
      now,
      tenantId,
      row.conversation_id,
    )
    count += 1
  }
  if (count <= 0) return
  console.warn(
    JSON.stringify({
      level: 'warn',
      event: 'ai.autodraft_stale',
      tenantId,
      count,
    }),
  )
}

function isFlowPlaceholderInbound(body: string): boolean {
  return /^\[Flow\](?:\s|$)/i.test(body.trim())
}

function conversationAwaitingPostBookingFarewell(
  db: ClinicDb,
  tenantId: string,
  conversationId: string,
): boolean {
  const rows = db.all<{ body: string }>(
    `SELECT body FROM messages
     WHERE tenant_id = ? AND conversation_id = ? AND direction = 'outbound'
     ORDER BY created_at DESC LIMIT 8`,
    tenantId,
    conversationId,
  )
  let sawPostBooking = false
  let sawAgendado = false
  for (const row of rows) {
    const b = row.body.trim()
    if (b === POST_BOOKING_BODY) sawPostBooking = true
    if (/^(?:Agendado|Remarcado):/i.test(b)) sawAgendado = true
  }
  return sawPostBooking && sawAgendado
}

/** Processa os jobs vencidos. Chamado pelo alarme do DO. */
export async function runDueAutoDrafts(
  db: ClinicDb,
  caller: ClinicCaller,
  clock: Clock,
  deps: AiAssistDeps,
  opts: {
    limit?: number
    /**
     * DEC-188: após apply extract, o Worker retoma só a conversa do job
     * (evita empilhar N autodrafts due no mesmo isolate do apply).
     */
    conversationId?: string
    onStart?: (job: AutoDraftJob) => Promise<void> | void
    /**
     * DEC-136: despacha o outbox `whatsapp.typing_indicator` cedo (antes do LLM
     * ou do envio determinístico). Fail-soft no caller — não deve lançar.
     */
    onTyping?: (outbox: OutboxRow) => Promise<void> | void
    /** Fases por turno (ex.: extrator, runBookingTurn) para `do.step_timing`. */
    onTurnPhase?: (phase: string, durationMs: number) => void
  } = {},
): Promise<AutoDraftOutcome[]> {
  const tenantId = caller.tenantId
  const now = clock.nowMs()
  reclaimOrphanGenerating(db, tenantId, now)
  const limit = opts.limit ?? 10
  const due = (
    opts.conversationId
      ? db.all<JobSql>(
          `SELECT conversation_id, message_id, due_at, state, created_at FROM ai_autodraft_jobs
           WHERE tenant_id = ? AND state = 'queued' AND due_at <= ? AND conversation_id = ?
           ORDER BY due_at LIMIT ?`,
          tenantId,
          now,
          opts.conversationId,
          limit,
        )
      : db.all<JobSql>(
          `SELECT conversation_id, message_id, due_at, state, created_at FROM ai_autodraft_jobs
           WHERE tenant_id = ? AND state = 'queued' AND due_at <= ? ORDER BY due_at LIMIT ?`,
          tenantId,
          now,
          limit,
        )
  ).map(mapJob)

  const out: AutoDraftOutcome[] = []
  const alarmTurnStartedMs = now
  for (const job of due) {
    const elapsedMs = clock.nowMs() - alarmTurnStartedMs
    if (elapsedMs >= AUTODRAFT_ALARM_BUDGET_MS) {
      console.warn(
        JSON.stringify({
          level: 'warn',
          event: 'ai.autodraft_alarm_budget',
          tenantId,
          elapsedMs,
          processedJobs: out.length,
          dueRemaining: due.length - out.length,
        }),
      )
      break
    }
    const jobStarted = clock.nowMs()
    const debounceMs = Math.max(0, job.dueAt - job.createdAt)
    // DEC-143: quadro antes do turno, para medir se as variantes vieram deste texto.
    const frameBefore = getBookingFrame(db, tenantId, job.conversationId)
    const zonesAskedBefore = (): boolean => {
      if (!frameBefore?.serviceId) return false
      const svc = listServices(db, tenantId).find((s) => s.id === frameBefore.serviceId)
      const active = svc?.zones.filter((z) => z.active) ?? []
      return zonesAskedBeforeTurn(frameBefore, {
        activeZones: active.length,
        needsLine: needsAudienceLine(active),
      })
    }
    /** Uma vez por job: marca lida + typing nativo só quando vamos responder. */
    let typingSignaled = false
    const signalTyping = async (): Promise<void> => {
      if (typingSignaled) return
      typingSignaled = true
      const t0 = clock.nowMs()
      try {
        const typingOb = enqueueTypingIndicator(
          db,
          tenantId,
          { conversationId: job.conversationId, messageId: job.messageId },
          clock,
        )
        if (typingOb && opts.onTyping) await opts.onTyping(typingOb)
      } catch {
        // Fail-soft: indicador nunca aborta a resposta (DEC-136).
      } finally {
        opts.onTurnPhase?.('signal_typing', clock.nowMs() - t0)
      }
    }
    const record = (
      outcome: AutoDraftOutcome,
      extra: {
        modelCalled?: boolean
        modelCalls?: number
        textDiscarded?: boolean
        fallbackSent?: boolean
        decisionMs?: number
        sendMs?: number
      } = {},
    ): void => {
      // DEC-188: turno ainda à espera da fila — sem ai.turn_decided.
      if (outcome.status === 'awaiting_llm') {
        out.push(outcome)
        return
      }
      const modelCalls =
        extra.modelCalls ??
        (extra.modelCalled || outcome.suggestion ? 1 : 0)
      const route = routeFromAutodraftOutcome({
        status: outcome.status,
        reason: outcome.reason,
        proposalId: null,
        deterministicReply: false,
        fallbackSent: extra.fallbackSent,
        modelCalled: modelCalls > 0 || extra.modelCalled,
        textDiscarded: extra.textDiscarded,
      })
      // O quadro do turno é gravado na mesma TX do envio (ADR-0015), antes deste ponto.
      const frameAfter = getBookingFrame(db, tenantId, outcome.conversationId)
      const step = deriveDropStep(frameAfter ?? frameBefore)
      // T2: liga ao booking_sessions (T1) e conta o turno inbound.
      const openSession = getOpenBookingSession(db, tenantId, outcome.conversationId)
      const sessionId =
        touchBookingSessionOnTurn(db, tenantId, outcome.conversationId, step) ??
        openSession?.sessionId ??
        null
      const friction = mergeFriction(undefined)
      if (sessionId) {
        const replyText = ''
        const miss =
          route === 'fallback' ||
          friction.some((f) => f.flag === 'nao_encontrei') ||
          (replyText.length > 0 && outboundLooksLikeMisunderstanding(replyText))
        if (miss) incrementMisunderstandingTurn(db, sessionId)
        if (replyText.length > 0) {
          const folded = normalizeOutboundForRepeatCheck(replyText)
          const prev = db.get<{ body: string }>(
            `SELECT body FROM messages
             WHERE tenant_id = ? AND conversation_id = ? AND direction = 'outbound'
             ORDER BY created_at DESC LIMIT 1 OFFSET 1`,
            tenantId,
            outcome.conversationId,
          )
          if (prev && normalizeOutboundForRepeatCheck(prev.body) === folded) {
            incrementMisunderstandingTurn(db, sessionId)
          }
        }
      }
      emitTurnDecided(
        db,
        {
          tenantId,
          conversationId: outcome.conversationId,
          messageIds: [outcome.messageId],
          route,
          // DEC-142: audiência pode existir sem serviço — não filtrar por serviceId.
          slotsFilled: frameAfter ? filledSlots(frameAfter) : [],
          slotsMissing: [],
          variantsChanged: variantsChangedInTurn(frameBefore, frameAfter),
          pendingSlotBefore: frameBefore?.pending?.slot ?? null,
          zonesAskedBefore: zonesAskedBefore(),
          sessionId,
          step,
          friction,
          modelCalled: modelCalls > 0 || Boolean(extra.modelCalled ?? outcome.suggestion),
          modelCalls,
          textDiscarded: Boolean(
            extra.textDiscarded ??
              (outcome.suggestion?.status === 'failed' &&
                outcome.suggestion.warningCodes.includes('output_rejected')),
          ),
          model: outcome.suggestion?.model ?? null,
          latencyMs: {
            debounce: debounceMs,
            model: outcome.suggestion?.requestMeta.latencyMs ?? null,
            decision: extra.decisionMs ?? null,
            send: extra.sendMs ?? null,
          },
          tokens: {
            input: outcome.suggestion?.requestMeta.inputTokens ?? null,
            output: outcome.suggestion?.requestMeta.outputTokens ?? null,
          },
        },
        clock,
      )
      out.push(outcome)
    }
    const skip = (reason: string): void => {
      cancelAutoDraft(db, tenantId, job.conversationId)
      record({ ...job, status: 'skipped', suggestion: null, reason })
    }
    const conv = getConversation(db, tenantId, job.conversationId)
    if (!conv || conv.status === 'closed') { skip('conversation_closed'); continue }
    if (conv.assigneeClerkUserId && isHumanStaffAuthor(conv.assigneeClerkUserId)) {
      skip('human_assignee')
      continue
    }
    const inboundBody =
      db.get<{ body: string }>(
        `SELECT body FROM messages WHERE tenant_id = ? AND id = ?`,
        tenantId,
        job.messageId,
      )?.body ?? ''
    // Staging Paulo 09/11/2026: `[Botão] Confirmar` + pending choose_slot →
    // `esclarecer` depois do Agendado (race ingest→S5). S5 cancela o job; isto
    // cobre job já em generating / reentrega sem cancel.
    if (isProposalConfirmButtonBody(inboundBody)) {
      skip('proposal_confirm_button')
      continue
    }
    // Mesma race no funil M5 / DEC-137 / DEC-142: Feminina·Masculina·Opções·
    // Sim do eco·Escolher da consulta de catálogo enfileiram autodraft no
    // ingest. Sem este skip, o job reenvia ask-tipo / Horários / «Temos:»
    // depois (ou antes) do choice handler — Paulo 09/11 staging.
    if (isInteractiveReplyBody(inboundBody)) {
      skip('interactive_reply_button')
      continue
    }
    // Placeholder técnico do WhatsApp Flow — não é pedido de equipe.
    if (isFlowPlaceholderInbound(inboundBody)) {
      await signalTyping()
      let replyOutbox: OutboxRow[] = []
      try {
        const hours = clinicTodayOpenState(db, tenantId, clock)
        const body = hubOpeningBody(deps.clinicName, hours)
        const sent = sendOutboundMessageOp(
          db,
          caller,
          {
            conversationId: job.conversationId,
            body,
            clientRequestId: `ai-flow-placeholder:${job.messageId}`,
            authorClerkUserId: AUTODRAFT_ACTOR_ID,
            authorDisplayName: AUTODRAFT_ACTOR_NAME,
          },
          clock,
        )
        replyOutbox = sent.outbox
      } catch (err) {
        if (!(err instanceof ClinicError)) throw err
      }
      cancelAutoDraft(db, tenantId, job.conversationId)
      record({
        ...job,
        status: 'skipped',
        suggestion: null,
        reason: 'flow_placeholder',
        replyOutbox,
      })
      continue
    }
    // DEC-157 / DEC-166: «avaliar» / «feedback» (+ comentário opcional) no
    // corpo desta mensagem (não no turno agregado) — antes da pausa DEC-083,
    // AI off e funil/LLM.
    const reviewFlagMatch = parseReviewFlagRequest(inboundBody)
    if (reviewFlagMatch.matched) {
      if (!messagingWindowForConversation(db, tenantId, job.conversationId, now).open) {
        skip('window_closed')
        continue
      }
      await signalTyping()
      const replyOutbox: OutboxRow[] = []
      try {
        const flagged = flagConversationForReview(
          db,
          tenantId,
          job.conversationId,
          {
            source: 'client',
            reason: 'client_request',
            clientComment: reviewFlagMatch.clientComment,
          },
          clock,
        )
        replyOutbox.push(...flagged.outbox)
        const sent = sendOutboundMessageOp(
          db,
          caller,
          {
            conversationId: job.conversationId,
            body: REVIEW_FLAG_CLIENT_ACK,
            clientRequestId: `ai-review-flag:${job.messageId}`,
            authorClerkUserId: AUTODRAFT_ACTOR_ID,
            authorDisplayName: AUTODRAFT_ACTOR_NAME,
            interactive: {
              buttons: reviewFlagAckInteractiveButtons(job.conversationId),
            },
          },
          clock,
        )
        replyOutbox.push(...sent.outbox)
      } catch (err) {
        if (!(err instanceof ClinicError)) throw err
      }
      cancelAutoDraft(db, tenantId, job.conversationId)
      record({
        ...job,
        status: 'skipped',
        suggestion: null,
        reason: 'review_flag_request',
        replyOutbox,
      })
      continue
    }
    if (!isClinicAiAssistEnabled(db, tenantId)) { skip('ai_not_enabled'); continue }
    if (!messagingWindowForConversation(db, tenantId, job.conversationId, now).open) { skip('window_closed'); continue }
    const aiPause = readAiReplyPause(db, tenantId, job.conversationId)
    if (aiPause) {
      const pauseReason = aiPause.reason as AiReplyPauseReason
      const teamOpen = isHumanTeamOfferAllowed(db, tenantId, clock)
      const parallelAutomation =
        teamOpen &&
        inboundWarrantsParallelHandoffAutomation(inboundBody, pauseReason, {
          db,
          tenantId,
          conversationId: job.conversationId,
        })
      if (parallelAutomation) {
        /* alerta/equipe mantidos; automação de agendamento ou catálogo segue abaixo */
      } else if (inboundWarrantsHandoffResume(inboundBody, pauseReason)) {
        const resumeOutbox = resumeAiReply(db, tenantId, job.conversationId, clock)
        if (resumeOutbox.length > 0) {
          // evento de retomada — não conta como resposta à cliente
        }
      } else if (isFarewellWhileHandoffPaused(inboundBody, pauseReason)) {
        // TRE-39: «Adeus»/«Tchau» com alerta aberto não repetem HANDOFF_PAUSED_ACK.
        // Mesmo adeus do Terminar + limpa timeout/alerta (suppressFollowupsAfterClientEnd).
        await signalTyping()
        const settings = ensureClinicSettings(db, tenantId, clock)
        const tz = settings.timezone || 'America/Sao_Paulo'
        const farewell = pickTerminarFarewell({ timezone: tz, nowMs: clock.nowMs() })
        const endOutbox = suppressFollowupsAfterClientEnd(db, tenantId, job.conversationId, clock)
        let replyOutbox: OutboxRow[] = [...endOutbox]
        try {
          const sent = sendOutboundMessageOp(
            db,
            caller,
            {
              conversationId: job.conversationId,
              body: farewell,
              clientRequestId: `ai-handoff-farewell:${job.messageId}`,
              authorClerkUserId: AUTODRAFT_ACTOR_ID,
              authorDisplayName: AUTODRAFT_ACTOR_NAME,
            },
            clock,
          )
          replyOutbox = [...replyOutbox, ...sent.outbox]
        } catch (err) {
          if (!(err instanceof ClinicError)) throw err
        }
        cancelAutoDraft(db, tenantId, job.conversationId)
        record({
          ...job,
          status: 'skipped',
          suggestion: null,
          reason: 'handoff_paused_farewell',
          replyOutbox,
        })
        continue
      } else if (shouldAcknowledgeWhileHandoffPaused(pauseReason)) {
        const ack = replyWhileHandoffPaused(
          db,
          tenantId,
          { conversationId: job.conversationId, clientRequestId: `ai-handoff-ack:${job.messageId}` },
          clock,
        )
        cancelAutoDraft(db, tenantId, job.conversationId)
        record({
          ...job,
          status: 'skipped',
          suggestion: null,
          reason: 'handoff_paused_ack',
          replyOutbox: ack.outbox,
        })
        continue
      } else {
        skip('ai_reply_paused')
        continue
      }
    }
    // A atendente já respondeu durante a espera.
    if (lastMessageDirection(db, tenantId, job.conversationId) !== 'inbound') { skip('already_answered'); continue }
    // #411: uma leitura por job — catálogo, mensagens, sessão, turno, compromisso futuro.
    const turn = loadTurnContext(
      db,
      tenantId,
      {
        conversationId: job.conversationId,
        contactId: conv.contactId,
        messageId: job.messageId,
        inboundBody,
      },
      clock,
    )
    const turnText = turn.turnText
    const hasUpcoming = Boolean(turn.upcoming)
    // Título «Abrir agenda» sozinho após um CTA URL já enviado: não reenvia a frase «toque em…».
    // (Toque autenticado `cw:abrir-agenda` continua no handler dedicado e manda o CTA se ainda não saiu.)
    // Recolhido de #974 (supersedido pela opção B): útil com Agenda como reply na bolha de localização.
    if (
      isOpenAgendaButtonTitle(turnText) &&
      countRecentWebLinks(db, tenantId, job.conversationId, clock.nowMs()) > 0
    ) {
      skip('open_agenda_title_already_offered')
      continue
    }
    /**
     * DEC-202: o chat não marca, não remarca e não cancela. Envia o link «Abrir agenda» com o
     * propósito certo e, se reconheceu um serviço único, com ele. Sem link possível (pausa da owner,
     * sem número ativo, base sem https, envio recusado) passa à equipe.
     */
    const sendWebRoute = async (
      route: {
        purpose: 'home' | 'agendar' | 'remarcar' | 'cancelar'
        serviceId: string | null
        noUpcoming: boolean
        audienceLine?: 'feminino' | 'masculino' | null
        variantIds?: string[]
        preferredDate?: string | null
        dayPart?: 'manha' | 'tarde' | 'noite' | null
      },
      reasonLabel: string,
      bodyOverride?: string,
    ): Promise<void> => {
      // Trava de abuso: muitos links na mesma conversa numa hora → passa à equipe em vez de repetir.
      const overLimit =
        countRecentWebLinks(db, tenantId, job.conversationId, clock.nowMs()) >=
        CLIENT_WEB_LINKS_PER_CONVERSATION
      await signalTyping()
      let replyOutbox: OutboxRow[] = []
      let sentOk = false
      let reasonOut = reasonLabel
      const paused = deps.autoBookPaused === true || overLimit
      if (route.purpose === 'home' && bodyOverride) {
        if (!paused && deps.prepareClientWebOffer) {
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
            if (offered) {
              const sent = sendOutboundMessageOp(
                db,
                caller,
                {
                  conversationId: job.conversationId,
                  body: bodyOverride,
                  interactive: offered,
                  clientRequestId: `ai-web-${route.purpose}:${job.messageId}`,
                  authorClerkUserId: AUTODRAFT_ACTOR_ID,
                  authorDisplayName: AUTODRAFT_ACTOR_NAME,
                },
                clock,
              )
              replyOutbox = sent.outbox
              sentOk = true
            }
          } catch {
            /* cai no cumprimento só texto */
          }
        }
        if (!sentOk) {
          // Sem link (página off, base http, laboratório): cumprimento determinístico, sem handoff.
          try {
            const sent = sendOutboundMessageOp(
              db,
              caller,
              {
                conversationId: job.conversationId,
                body: bodyOverride,
                clientRequestId: `ai-web-${route.purpose}:${job.messageId}`,
                authorClerkUserId: AUTODRAFT_ACTOR_ID,
                authorDisplayName: AUTODRAFT_ACTOR_NAME,
              },
              clock,
            )
            replyOutbox = sent.outbox
            sentOk = true
          } catch (err) {
            if (!(err instanceof ClinicError)) throw err
          }
        }
      } else if (!paused && deps.prepareClientWebOffer) {
        let offered: Awaited<ReturnType<NonNullable<typeof deps.prepareClientWebOffer>>> = null
        try {
          const future = loadUpcomingAppointments(db, tenantId, conv.contactId, clock.nowMs(), 2)
          offered = await deps.prepareClientWebOffer({
            tenantId,
            conversationId: job.conversationId,
            purpose: route.purpose,
            appointmentId:
              (route.purpose === 'remarcar' || route.purpose === 'cancelar') && future.length === 1
                ? (future[0]?.id ?? null)
                : null,
            serviceId: route.serviceId,
            audienceLine: route.audienceLine ?? null,
            variantIds: route.variantIds ?? [],
            preferredDate: route.preferredDate ?? null,
            dayPart: route.dayPart ?? null,
          })
        } catch {
          offered = null
        }
        if (offered) {
          const serviceName = route.serviceId
            ? (turn.catalog.services.find((s) => s.id === route.serviceId)?.name ?? null)
            : null
          const body =
            bodyOverride ??
            clientWebRouteBody({
              purpose: route.purpose === 'home' ? 'agendar' : route.purpose,
              serviceName,
              noUpcoming: route.noUpcoming,
            })
          try {
            const sent = sendOutboundMessageOp(
              db,
              caller,
              {
                conversationId: job.conversationId,
                body,
                interactive: offered,
                clientRequestId: `ai-web-${route.purpose}:${job.messageId}`,
                authorClerkUserId: AUTODRAFT_ACTOR_ID,
                authorDisplayName: AUTODRAFT_ACTOR_NAME,
              },
              clock,
            )
            replyOutbox = sent.outbox
            sentOk = true
          } catch (err) {
            if (!(err instanceof ClinicError)) throw err
          }
        }
      }
      if (!sentOk) {
        const handoff = notifyHumanHandoff(
          db,
          tenantId,
          {
            conversationId: job.conversationId,
            reason: 'human_only',
            clientRequestId: `ai-web-handoff:${job.messageId}`,
            inboundText: turnText,
          },
          clock,
        )
        replyOutbox = handoff.outbox
        reasonOut = overLimit ? 'web_link_limit' : 'human_handoff'
      }
      cancelAutoDraft(db, tenantId, job.conversationId)
      record({ ...job, status: 'skipped', suggestion: null, reason: reasonOut, replyOutbox })
    }
    // DEC-087: texto livre «Terminar» / «Prosseguir» após o prompt idle. «Prosseguir» já não retoma
    // um funil (DEC-202): oferece o link «Abrir agenda».
    {
      const idleText = handleIdleTextReply(
        db,
        {
          tenantId,
          conversationId: job.conversationId,
          text: turnText,
          providerEventKey: job.messageId,
        },
        clock,
      )
      if (idleText.handled) {
        if (idleText.action === 'continue') {
          await sendWebRoute({ purpose: 'agendar', serviceId: null, noUpcoming: false }, 'idle_continue_text')
          continue
        }
        cancelAutoDraft(db, tenantId, job.conversationId)
        record({
          ...job,
          status: 'skipped',
          suggestion: null,
          reason: 'idle_end_text',
          replyOutbox: idleText.outbox,
        })
        continue
      }
    }
    // CF-26 / DEC-119 / DEC-130: áudio/imagem sem texto → pedir texto; comprovativo ou
    // segunda mídia após o pedido → equipe (DEC-083). Antes do funil e do modelo.
    const mediaDecision = decideMediaOnlyTurn(
      db,
      tenantId,
      {
        conversationId: job.conversationId,
        contactId: conv.contactId,
        messageId: job.messageId,
        body: inboundBody,
      },
      clock,
    )
    if (mediaDecision.action === 'handoff') {
      await signalTyping()
      const handoff = notifyHumanHandoff(
        db,
        tenantId,
        {
          conversationId: job.conversationId,
          reason: mediaDecision.reason,
          clientRequestId: `ai-media-handoff:${job.messageId}`,
        },
        clock,
      )
      cancelAutoDraft(db, tenantId, job.conversationId)
      record({
        ...job,
        status: 'skipped',
        suggestion: null,
        reason: 'human_handoff',
        replyOutbox: handoff.outbox,
      })
      continue
    }
    if (mediaDecision.action === 'ask_text') {
      await signalTyping()
      let replyOutbox: OutboxRow[] = []
      try {
        const sent = sendOutboundMessageOp(
          db,
          caller,
          {
            conversationId: job.conversationId,
            body: MEDIA_ASK_TEXT,
            interactive: (() => {
              const buttons = humanTeamOfferButtons(db, tenantId, clock)
              return buttons.length > 0 ? { buttons } : undefined
            })(),
            clientRequestId: `ai-media-ask:${job.messageId}`,
            authorClerkUserId: AUTODRAFT_ACTOR_ID,
            authorDisplayName: AUTODRAFT_ACTOR_NAME,
            afterPersist: (ctx) => {
              markMediaAskTextAsked(ctx.db, ctx.tenantId, ctx.conversationId, ctx.now)
              return []
            },
          },
          clock,
        )
        replyOutbox = sent.outbox
      } catch (err) {
        if (!(err instanceof ClinicError)) throw err
      }
      cancelAutoDraft(db, tenantId, job.conversationId)
      record({
        ...job,
        status: 'skipped',
        suggestion: null,
        reason: 'media_ask_text',
        replyOutbox,
      })
      continue
    }
    // CF-04 / E-06: pergunta condicional → política cadastrada, sem pausa.
    // DEC-180: texto de sinal = mesmo efectivo que cobrança/Recebimento.
    const sensitiveHits = classifySensitive(turnText)
    if (hasPolicyQuestion(sensitiveHits)) {
      // DEC-210: sinal (Recebimento) + regras gerais (Assistente), juntos.
      const policy = buildCancellationPolicyReply(db, tenantId, clock)
      if (policy) {
        await signalTyping()
        let replyOutbox: OutboxRow[] = []
        try {
          const sent = sendOutboundMessageOp(
            db,
            caller,
            {
              conversationId: job.conversationId,
              body: policy,
              interactive: (() => {
                const buttons = humanTeamOfferButtons(db, tenantId, clock)
                return buttons.length > 0 ? { buttons } : undefined
              })(),
              clientRequestId: `ai-policy:${job.messageId}`,
              authorClerkUserId: AUTODRAFT_ACTOR_ID,
              authorDisplayName: AUTODRAFT_ACTOR_NAME,
            },
            clock,
          )
          replyOutbox = sent.outbox
        } catch (err) {
          if (!(err instanceof ClinicError)) throw err
        }
        cancelAutoDraft(db, tenantId, job.conversationId)
        record({
          ...job,
          status: 'skipped',
          suggestion: null,
          reason: 'catalog_reply',
          replyOutbox,
        })
        continue
      }
    }
    // DEC-114: pedido para parar — pausa + alerta, sem mensagem automática.
    if (hasStopRequest(sensitiveHits)) {
      const handoff = notifyHumanHandoff(
        db,
        tenantId,
        {
          conversationId: job.conversationId,
          reason: 'customer_requested',
          clientRequestId: `ai-stop:${job.messageId}`,
          silent: true,
        },
        clock,
      )
      cancelAutoDraft(db, tenantId, job.conversationId)
      record({
        ...job,
        status: 'skipped',
        suggestion: null,
        reason: 'human_handoff',
        replyOutbox: handoff.outbox,
      })
      continue
    }
    // DEC-115: transparência sobre IA — frase fixa + botão, sem pausar.
    if (hasAiTransparencyQuestion(sensitiveHits)) {
      await signalTyping()
      let replyOutbox: OutboxRow[] = []
      try {
        const sent = sendOutboundMessageOp(
          db,
          caller,
          {
            conversationId: job.conversationId,
            body: AI_TRANSPARENCY_TEXT,
            interactive: (() => {
              const buttons = humanTeamOfferButtons(db, tenantId, clock)
              return buttons.length > 0 ? { buttons } : undefined
            })(),
            clientRequestId: `ai-transparency:${job.messageId}`,
            authorClerkUserId: AUTODRAFT_ACTOR_ID,
            authorDisplayName: AUTODRAFT_ACTOR_NAME,
          },
          clock,
        )
        replyOutbox = sent.outbox
      } catch (err) {
        if (!(err instanceof ClinicError)) throw err
      }
      cancelAutoDraft(db, tenantId, job.conversationId)
      record({
        ...job,
        status: 'skipped',
        suggestion: null,
        reason: 'catalog_reply',
        replyOutbox,
      })
      continue
    }
    // Meta «como termino?» — DEC-152 ensina o comando; não encerra, não handoff, sem LLM.
    if (isHowToEndQuestion(turnText)) {
      await signalTyping()
      let replyOutbox: OutboxRow[] = []
      try {
        const sent = sendOutboundMessageOp(
          db,
          caller,
          {
            conversationId: job.conversationId,
            body: HOW_TO_END_REPLY,
            clientRequestId: `ai-how-to-end:${job.messageId}`,
            authorClerkUserId: AUTODRAFT_ACTOR_ID,
            authorDisplayName: AUTODRAFT_ACTOR_NAME,
          },
          clock,
        )
        replyOutbox = sent.outbox
        markEndHelpHintSent(db, tenantId, job.conversationId)
      } catch (err) {
        if (!(err instanceof ClinicError)) throw err
      }
      cancelAutoDraft(db, tenantId, job.conversationId)
      record({
        ...job,
        status: 'skipped',
        suggestion: null,
        reason: 'how_to_end',
        replyOutbox,
      })
      continue
    }
    // P24: piada e conversa fiada redirecionam; não pausam. Injeção forte continua handoff.
    if (isOffTopicSmallTalk(turnText) && !wantsHumanPause(sensitiveHits)) {
      await signalTyping()
      let replyOutbox: OutboxRow[] = []
      try {
        const sent = sendOutboundMessageOp(
          db,
          caller,
          {
            conversationId: job.conversationId,
            body: OFF_TOPIC_SMALL_TALK_TEXT,
            clientRequestId: `ai-off-topic:${job.messageId}`,
            authorClerkUserId: AUTODRAFT_ACTOR_ID,
            authorDisplayName: AUTODRAFT_ACTOR_NAME,
          },
          clock,
        )
        replyOutbox = sent.outbox
      } catch (err) {
        if (!(err instanceof ClinicError)) throw err
      }
      cancelAutoDraft(db, tenantId, job.conversationId)
      record({
        ...job,
        status: 'skipped',
        suggestion: null,
        reason: 'off_topic_redirect',
        replyOutbox,
      })
      continue
    }
    // DEC-202 / P3 (Proposto): a ordem de decisão vive em `classifyTurn` (classify-turn.ts, TURN_ORDER).
    // Cumprimento, remarcar e cancelar próprios vêm antes do handoff léxico (P24).
    const turnClass = classifyTurn({
      text: turnText,
      services: turn.catalog.services,
      hasUpcoming,
      handoffReason: () => handoffReason(db, tenantId, turnText, clock, turn),
      isFarewell: () =>
        hasSoftDeclineRequest(sensitiveHits) ||
        (FAREWELL_RE.test(turnText.trim()) &&
          conversationAwaitingPostBookingFarewell(db, tenantId, job.conversationId)),
    })
  {
    const earlyRoute = turnClass.kind === 'link_early' ? turnClass.route : null
    if (earlyRoute) {
      const greeting = earlyRoute.purpose === 'home'
      const hubBody = greeting
        ? hubOpeningBody(deps.clinicName, clinicTodayOpenState(db, tenantId, clock))
        : undefined
      const bodyOverride = hubBody
        ? deps.autoBookPaused === true
          ? hubBody
          : clientWebOfferBody(hubBody)
        : undefined
      await sendWebRoute(
        earlyRoute,
        greeting ? 'hub_opening' : `web_${earlyRoute.purpose}_link`,
        bodyOverride,
      )
      continue
    }
  }
    if (turnClass.kind === 'handoff') {
      const reason = turnClass.reason
      await signalTyping()
      // DEC-155: pedido explícito de equipe fora do expediente → horário, IA activa (sem pausa).
      // Stop (DEC-114) já saiu acima; aqui customer_requested = pedir_pessoa.
      if (reason === 'customer_requested' && !isHumanTeamOfferAllowed(db, tenantId, clock)) {
        const afterHours = replyAfterHoursHumanRequest(
          db,
          tenantId,
          {
            conversationId: job.conversationId,
            clientRequestId: `ai-handoff-after-hours:${job.messageId}`,
            messageId: job.messageId,
          },
          clock,
        )
        cancelAutoDraft(db, tenantId, job.conversationId)
        record({
          ...job,
          status: 'skipped',
          suggestion: null,
          reason: 'after_hours_human_keep_ai',
          replyOutbox: afterHours.outbox,
        })
        continue
      }
      const handoff = notifyHumanHandoff(
        db,
        tenantId,
        {
          conversationId: job.conversationId,
          reason,
          clientRequestId: `ai-handoff:${job.messageId}`,
          inboundText: turnText,
        },
        clock,
      )
      cancelAutoDraft(db, tenantId, job.conversationId)
      record({
        ...job,
        status: 'skipped',
        suggestion: null,
        reason: 'human_handoff',
        replyOutbox: handoff.outbox,
      })
      continue
    }
    // «Terminar» e desistências educadas (DEC-147/152) fecham com a despedida; o agradecimento depois
    // de um agendamento também.
    if (turnClass.kind === 'farewell') {
      await signalTyping()
      const settings = ensureClinicSettings(db, tenantId, clock)
      const tz = settings.timezone || 'America/Sao_Paulo'
      const farewell = pickTerminarFarewell({ timezone: tz, nowMs: clock.nowMs() })
      const endOutbox = suppressFollowupsAfterClientEnd(db, tenantId, job.conversationId, clock)
      let replyOutbox: OutboxRow[] = [...endOutbox]
      try {
        const sent = sendOutboundMessageOp(
          db,
          caller,
          {
            conversationId: job.conversationId,
            body: farewell,
            clientRequestId: `ai-post-booking-farewell:${job.messageId}`,
            authorClerkUserId: AUTODRAFT_ACTOR_ID,
            authorDisplayName: AUTODRAFT_ACTOR_NAME,
          },
          clock,
        )
        replyOutbox = [...replyOutbox, ...sent.outbox]
      } catch (err) {
        if (!(err instanceof ClinicError)) throw err
      }
      cancelAutoDraft(db, tenantId, job.conversationId)
      record({
        ...job,
        status: 'skipped',
        suggestion: null,
        reason: 'post_booking_farewell',
        replyOutbox,
      })
      continue
    }
    // «Meus agendamentos» em texto livre — mesmo corpo do hub Flow (FL-07), sem LLM
    // e sem handoff. Depois de handoffReason para «falar com a equipe» continuar a ganhar.
    // Evita a promessa falsa «a equipe vai verificar» do redator de exceção.
    if (turnClass.kind === 'my_appointments') {
      await signalTyping()
      const body = conv.contactId
        ? hubMeusBody(db, tenantId, conv.contactId, clock)
        : hubMeusBody(db, tenantId, '', clock)
      let replyOutbox: OutboxRow[] = []
      try {
        const sent = sendOutboundMessageOp(
          db,
          caller,
          {
            conversationId: job.conversationId,
            body,
            clientRequestId: `ai-hub-meus:${job.messageId}`,
            authorClerkUserId: AUTODRAFT_ACTOR_ID,
            authorDisplayName: AUTODRAFT_ACTOR_NAME,
          },
          clock,
        )
        replyOutbox = sent.outbox
      } catch (err) {
        if (!(err instanceof ClinicError)) throw err
      }
      cancelAutoDraft(db, tenantId, job.conversationId)
      record({
        ...job,
        status: 'skipped',
        suggestion: null,
        reason: 'hub_meus',
        replyOutbox,
      })
      continue
    }
    // DEC-142 / DEC-202: «quais serviços?» é informação: lista em texto, sem estado nem botões de escolha.
    // Antes do encaminhamento para o link, para «ver os serviços» não virar pedido de marcar.
    if (turnClass.kind === 'catalog_list') {
      const catalogListText = turnClass.text
      await signalTyping()
      let replyOutbox: OutboxRow[] = []
      try {
        const buttons = humanTeamOfferButtons(db, tenantId, clock)
        const sent = sendOutboundMessageOp(
          db,
          caller,
          {
            conversationId: job.conversationId,
            body: catalogListText,
            interactive: buttons.length > 0 ? { buttons } : undefined,
            clientRequestId: `ai-catalog-list:${job.messageId}`,
            authorClerkUserId: AUTODRAFT_ACTOR_ID,
            authorDisplayName: AUTODRAFT_ACTOR_NAME,
          },
          clock,
        )
        replyOutbox = sent.outbox
      } catch (err) {
        if (!(err instanceof ClinicError)) throw err
      }
      cancelAutoDraft(db, tenantId, job.conversationId)
      record({ ...job, status: 'skipped', suggestion: null, reason: 'catalog_consult', replyOutbox })
      continue
    }
    // DEC-202: pedido de marcar ou de vaga → link (depois de «meus agendamentos» e handoff).
    {
      const route = turnClass.kind === 'link_route' ? turnClass.route : null
      if (route) {
        const today = clinicCivilDateFromUtc(turn.settings.timezone || 'America/Sao_Paulo', clock.nowMs())
        const scheduleOnly = clientWebSchedulePrefsFromText(turnText, today)
        const linkFields =
          route.purpose === 'agendar' && route.serviceId
            ? clientWebLinkFieldsFromText(turnText, route.serviceId, turn.catalog.services, today)
            : route.purpose === 'agendar'
              ? { audienceLine: null, variantIds: [] as string[], ...scheduleOnly }
              : {
                  audienceLine: null,
                  variantIds: [] as string[],
                  preferredDate: null,
                  dayPart: null,
                }
        let bodyOverride: string | undefined
        // DEC-202: «Pode ser as 10:15» — corpo próprio (não repetir a frase de remarcar; INV-08).
        if (isSlotTimePickByText(turnText)) {
          bodyOverride = CLIENT_WEB_TIME_PICK_BODY
        } else if ('mixed' in route && route.mixed && deps.autoBookPaused !== true) {
          const serviceName = route.serviceId
            ? (turn.catalog.services.find((s) => s.id === route.serviceId)?.name ?? null)
            : null
          let answer = catalogReply(db, tenantId, turnText, clock, {
            conversationId: job.conversationId,
            turn,
          })
          if (!answer && serviceName && /quanto|valor|pre[cç]o|custa/i.test(turnText)) {
            answer = catalogReply(db, tenantId, `Quanto custa ${serviceName}?`, clock, {
              conversationId: job.conversationId,
              turn,
            })
          }
          if (answer) {
            // O link já convida a escolher o horário: tira a pergunta «Quer ver horários?» do preço.
            answer = stripScheduleOffer(answer)
            const combined = `${answer}\n\n${clientWebRouteBody({ purpose: 'agendar', serviceName })}`
            if (combined.length <= 1000) bodyOverride = combined
          }
        }
        await sendWebRoute(
          { ...route, ...linkFields },
          `web_${route.purpose}_link`,
          bodyOverride,
        )
        continue
      }
    }
    // Informação: horário, endereço, preço, duração, quem faz, FAQ (DEC-104). Marcar já saiu acima.
    const catalogText = catalogReply(db, tenantId, turnText, clock, {
      conversationId: job.conversationId,
      turn,
    })
    // P6 (Paulo, 18/11/2026): preço ou duração de um serviço único → resposta e «Abrir agenda» com esse serviço.
    if (
      catalogText &&
      deps.autoBookPaused !== true &&
      deps.prepareClientWebOffer &&
      countRecentWebLinks(db, tenantId, job.conversationId, clock.nowMs()) < CLIENT_WEB_LINKS_PER_CONVERSATION
    ) {
      const answer = stripScheduleOffer(catalogText)
      const cited = servicesCitedInText(turn.catalog.services, turnText)
      const single = cited.length === 1 ? cited[0]! : null
      const isServiceFact =
        /R\$\s*\d|\b\d+\s*min\b/i.test(answer) &&
        !answer.includes('?') &&
        (answer.match(/R\$/g) ?? []).length <= 1
      if (single && isServiceFact) {
        const today = clinicCivilDateFromUtc(turn.settings.timezone || 'America/Sao_Paulo', clock.nowMs())
        const linkFields = clientWebLinkFieldsFromText(turnText, single.id, turn.catalog.services, today)
        const combined = `${answer}\n\n${clientWebRouteBody({ purpose: 'agendar', serviceName: single.name })}`
        if (combined.length <= 1000) {
          await sendWebRoute(
            { purpose: 'agendar', serviceId: single.id, noUpcoming: false, ...linkFields },
            'web_agendar_link',
            combined,
          )
          continue
        }
      }
    }
    if (catalogText) {
      await signalTyping()
      let replyOutbox: OutboxRow[] = []
      // T3 (Paulo 09/11/2026): após preço total → Marcar outro | Terminar.
      const isPriceTotal =
        /\bNo total, ficam\b/i.test(catalogText) ||
        /\bSomando tudo, ficam\b/i.test(catalogText)
      // DEC-216: informação + «Falar com a equipe» leva também «Abrir agenda»; serviço único do léxico pré-escolhe.
      // Localização (opção B): Abrir mapa · Abrir agenda · Equipe — mapa abre cta_url no toque.
      const catalogCited = servicesCitedInText(turn.catalog.services, turnText)
      const catalogServiceId = catalogCited.length === 1 ? catalogCited[0]!.id : null
      const catalogButtons = isPriceTotal
        ? priceFollowupInteractiveButtons()
        : isLocationMapOfferReply(catalogText)
          ? locationMapOfferButtons(db, tenantId, clock, { serviceId: catalogServiceId })
          : humanTeamOfferButtons(db, tenantId, clock, { serviceId: catalogServiceId })
      try {
        const sent = sendOutboundMessageOp(
          db,
          caller,
          {
            conversationId: job.conversationId,
            body: catalogText,
            interactive: catalogButtons.length > 0 ? { buttons: catalogButtons } : undefined,
            clientRequestId: `ai-catalog:${job.messageId}`,
            authorClerkUserId: AUTODRAFT_ACTOR_ID,
            authorDisplayName: AUTODRAFT_ACTOR_NAME,
          },
          clock,
        )
        replyOutbox = sent.outbox
      } catch (err) {
        if (!(err instanceof ClinicError)) throw err
      }
      cancelAutoDraft(db, tenantId, job.conversationId)
      record({ ...job, status: 'skipped', suggestion: null, reason: 'catalog_reply', replyOutbox })
      continue
    }
    if (getAiDailyUsage(db, tenantId, clock).capReached) {
      cancelAutoDraft(db, tenantId, job.conversationId)
      record({ ...job, status: 'cap_reached', suggestion: null })
      continue
    }
    // S7 (#178): quota por contato (só automações; a equipe continua a poder pedir sugestão).
    // #491: o extrator NÃO entra em autoDraftsPerContact — essa quota conta rascunhos
    // (`ai_suggestions` origin=auto), não chamadas internas de NLU. O custo do extrator
    // entra no teto diário da clínica (`ai_daily_usage`). Quando o turno gera sugestão
    // (determinística ou redator), a quota S7 continua a aplicar-se via a sugestão.
    const contactId = contactIdForConversation(db, tenantId, job.conversationId)
    if (deps.abuseLimits?.enabled && contactId) {
      const decision = checkAutomationQuota(db, deps.abuseLimits, { tenantId, contactId, effect: 'auto_draft' }, clock)
      if (!decision.allowed) {
        recordLimitReached(db, deps.abuseLimits, { tenantId, contactId, effect: 'auto_draft', decision }, clock)
        skip(`abuse_limit:${decision.limit}`)
        continue
      }
    }

    db.run(
      `UPDATE ai_autodraft_jobs SET state = 'generating', updated_at = ?
       WHERE tenant_id = ? AND conversation_id = ? AND message_id = ?`,
      now,
      tenantId,
      job.conversationId,
      job.messageId,
    )
    // DEC-136: typing cedo — o LLM/extrator pode demorar; a resposta (ou DEC-107) sai depois.
    await signalTyping()
    await opts.onStart?.(job)

    // DEC-202: sem funil. Pergunta aberta fora do catálogo → redator de exceção (DEC-104), com
    // validador; falha → frase DEC-107 e alerta, sem pausar a IA.
    let suggestion: AiSuggestionRow | null = null
    let modelCalled = false
    let modelCalls = 0
    const liveTurn = turn
    const needsOpenReply = true
    if (needsOpenReply) {
      if (getAiDailyUsage(db, tenantId, clock).capReached) {
        cancelAutoDraft(db, tenantId, job.conversationId)
        record({ ...job, status: 'cap_reached', suggestion: null })
        continue
      }
      if (deps.llmOutOfDo) {
        const snapshot = await buildRedactSnapshot(db, caller, clock, deps, {
          conversationId: job.conversationId,
          messageId: job.messageId,
          question: liveTurn.turnText,
          turn: liveTurn,
          classify: deps.intentLlmEnabled === true,
        })
        const created = createLlmJob(
          db,
          tenantId,
          {
            conversationId: job.conversationId,
            messageId: job.messageId,
            purpose: 'redact',
            frameVersion: snapshot.frameVersion,
            snapshot,
          },
          clock,
        )
        if (deps.enqueueLlmJob) {
          try {
            await deps.enqueueLlmJob(created.queueMessage)
          } catch (err) {
            console.warn(
              JSON.stringify({
                level: 'warn',
                event: 'llm.enqueue_failed',
                tenantId,
                purpose: 'redact',
                error: err instanceof Error ? err.message : 'unknown',
              }),
            )
            const fb = notifyModelFallback(
              db,
              tenantId,
              { conversationId: job.conversationId, messageId: job.messageId },
              clock,
            )
            cancelAutoDraft(db, tenantId, job.conversationId)
            record({
              ...job,
              status: 'failed',
              suggestion: null,
              reason: 'llm_enqueue_failed',
              replyOutbox: fb.outbox,
            })
            continue
          }
        }
        record({
          ...job,
          status: 'awaiting_llm',
          suggestion: null,
          reason: 'redact',
          llmQueueMessage: created.queueMessage,
        })
        continue
      }
      try {
        const exception = await generateExceptionReply(db, caller, clock, deps, {
          conversationId: job.conversationId,
          question: liveTurn.turnText,
          turn: liveTurn,
        })
        modelCalled = true
        if (exception.modelCalled) {
          modelCalls += 1
          // #491: redator de exceção também conta no teto (extrator + redator).
          recordModelCallTowardDailyCap(db, tenantId, clock)
        }
        if (exception.ok && exception.text.trim()) {
          suggestion = insertSuggestion(db, {
            tenantId,
            conversationId: job.conversationId,
            kind: 'reply',
            status: 'pending',
            provider: deps.mode,
            model: exception.model ?? 'none',
            suggestedText: exception.text,
            internalNotes: exception.notes,
            warningCodes: [],
            warningLabels: [],
            sourceRefs: [],
            requestMeta: {
              latencyMs: exception.latencyMs ?? 0,
              inputTokens: exception.inputTokens,
              outputTokens: exception.outputTokens,
              messageCount: liveTurn.messages.length,
              mode: deps.mode,
            },
            errorCode: null,
            requestedByClerkUserId: AUTODRAFT_ACTOR_ID,
            requestedByDisplayName: 'Rascunho automático',
            parentSuggestionId: null,
            replyToMessageId: job.messageId,
            origin: 'auto',
            createdAt: clock.nowMs(),
          })
        } else {
          // DEC-104 + DEC-107 (#489): frase de fallback e alerta alter_awaiting_team,
          // sem pausar a IA. Pausa completa fica para DEC-083.
          suggestion = insertSuggestion(db, {
            tenantId,
            conversationId: job.conversationId,
            kind: 'reply',
            status: 'failed',
            provider: deps.mode,
            model: exception.model ?? 'none',
            suggestedText: '',
            internalNotes: exception.rejection ?? '',
            warningCodes: ['output_rejected'],
            warningLabels: ['Saída rejeitada'],
            sourceRefs: [],
            requestMeta: {
              latencyMs: exception.latencyMs ?? 0,
              inputTokens: exception.inputTokens,
              outputTokens: exception.outputTokens,
              messageCount: liveTurn.messages.length,
              mode: deps.mode,
            },
            errorCode: 'invalid_response',
            requestedByClerkUserId: AUTODRAFT_ACTOR_ID,
            requestedByDisplayName: 'Rascunho automático',
            parentSuggestionId: null,
            replyToMessageId: job.messageId,
            origin: 'auto',
            createdAt: clock.nowMs(),
          })
        }
      } catch (err) {
        const code = err instanceof ClinicError ? err.code : 'autodraft_error'
        if (code === 'ai_daily_cap_reached' || code === 'ai_not_enabled') {
          cancelAutoDraft(db, tenantId, job.conversationId)
          record({
            ...job,
            status: code === 'ai_daily_cap_reached' ? 'cap_reached' : 'failed',
            suggestion: null,
            reason: code,
          })
          continue
        }
        modelCalled = true
        suggestion = insertSuggestion(db, {
          tenantId,
          conversationId: job.conversationId,
          kind: 'reply',
          status: 'failed',
          provider: 'none',
          model: 'none',
          suggestedText: '',
          internalNotes: '',
          warningCodes: [],
          warningLabels: [],
          sourceRefs: [],
          requestMeta: {
            latencyMs: 0,
            inputTokens: null,
            outputTokens: null,
            messageCount: 0,
            mode: deps.mode,
          },
          errorCode: code,
          requestedByClerkUserId: AUTODRAFT_ACTOR_ID,
          requestedByDisplayName: 'Rascunho automático',
          parentSuggestionId: null,
          replyToMessageId: null,
          origin: 'auto',
          createdAt: clock.nowMs(),
        })
      }
    }

    // Chegou outra mensagem durante a decisão/geração → descarta este; o job novo segue.
    const current = getAutoDraftJob(db, tenantId, job.conversationId)
    if (current && current.messageId !== job.messageId) {
      if (suggestion) markSuggestionSuperseded(db, tenantId, suggestion.id, clock.nowMs())
      record({
        ...job,
        status: 'superseded',
        suggestion: suggestion ? getSuggestion(db, tenantId, suggestion.id) : null,
      })
      continue
    }
    cancelAutoDraft(db, tenantId, job.conversationId)

    let replyOutbox: OutboxRow[] | undefined
    const draftText = suggestion?.suggestedText.trim() ?? ''
    const injectionSuspected =
      Boolean(suggestion?.warningCodes.includes('injection_suspected')) &&
      detectStrongInjectionSignals(turnText)
    if (injectionSuspected && suggestion) {
      const handoff = notifyHumanHandoff(
        db,
        tenantId,
        {
          conversationId: job.conversationId,
          reason: 'off_purpose',
          clientRequestId: `ai-handoff:${suggestion.id}`,
        },
        clock,
      )
      replyOutbox = handoff.outbox
    } else if (suggestion?.status === 'pending' && draftText) {
      try {
        // Race S5: Agendado/`Posso ajudar` podem ter saído durante o redator.
        if (lastMessageDirection(db, tenantId, job.conversationId) !== 'inbound') {
          markSuggestionSuperseded(db, tenantId, suggestion.id, clock.nowMs())
          record({
            ...job,
            status: 'skipped',
            suggestion: getSuggestion(db, tenantId, suggestion.id),
            reason: 'already_answered',
          })
          continue
        }
        // Opção B: se o redator colou o URL da clínica, troca pelo CTA Abrir mapa.
        const mapsUrl = ensureClinicSettings(db, tenantId, clock).googleBusinessUrl
        const rewritten = rewriteRawMapsUrlOutbound(draftText, job.conversationId, mapsUrl)
        const body = rewritten.body
        const buttons = rewritten.useMapButtons
          ? locationMapOfferButtons(db, tenantId, clock)
          : humanTeamOfferButtons(db, tenantId, clock)
        const sent = sendOutboundMessageOp(
          db,
          caller,
          {
            conversationId: job.conversationId,
            body,
            interactive: buttons.length > 0 ? { buttons } : null,
            clientRequestId: `ai-reply:${suggestion.id}`,
            authorClerkUserId: AUTODRAFT_ACTOR_ID,
            authorDisplayName: AUTODRAFT_ACTOR_NAME,
            aiSuggestionId: suggestion.id,
          },
          clock,
        )
        replyOutbox = [...(replyOutbox ?? []), ...sent.outbox]
        // TR-487: redator / frase DEC-125 que promete equipe → alerta sem pausa.
        if (textPromisesTeamFollowUp(body)) {
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
        void auditOutboundForFalseConfirmation(
          db,
          getConversationQualityCentralDb(),
          {
            tenantId,
            conversationId: job.conversationId,
            messageId: job.messageId,
            body,
          },
          clock,
        )
        suggestion = getSuggestion(db, tenantId, suggestion.id) ?? suggestion
      } catch (err) {
        if (!(err instanceof ClinicError)) throw err
      }
    }
    let hasOutbound = Boolean(replyOutbox && replyOutbox.length > 0)
    let fallbackSent = false
    if (!injectionSuspected && !hasOutbound) {
      // DEC-107 (#489): falha do redator / modelo → frase fixa + alerta, IA activa.
      const fallback = notifyModelFallback(
        db,
        tenantId,
        { conversationId: job.conversationId, messageId: job.messageId },
        clock,
      )
      replyOutbox = fallback.outbox
      fallbackSent = fallback.sent || fallback.already
      hasOutbound = Boolean(replyOutbox && replyOutbox.length > 0)
    }
    record(
      {
        ...job,
        status: suggestion?.status === 'failed' ? 'failed' : 'ready',
        suggestion,
        replyOutbox,
      },
      {
        modelCalled,
        modelCalls,
        textDiscarded: modelCalled && suggestion?.status === 'failed',
        fallbackSent,
        decisionMs: Math.max(0, clock.nowMs() - jobStarted),
      },
    )
  }
  return out
}
