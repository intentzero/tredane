/**
 * Rascunho automático da IA a cada mensagem da cliente (aprovado por Paulo, 27/10/2026).
 * - Debounce adaptativo DEC-111: 0 s botão/lista, 2–3 s pedido completo, 7 s texto aberto.
 * - Ordem CA-03 (#413) + M6 (#416): interpretar → extrator se cobertura baixa →
 *   decidir (autobook) → redator de exceção só para pergunta aberta (DEC-104).
 * - O caminho automático não usa o prompt monolítico de `src/ai/prompt.ts`.
 * - Quando dia, horário e serviço ficam claros, o backend envia a proposta e não manda
 *   a pergunta «Confirma…?» (autobook.ts), salvo pausa da owner.
 * - Nos outros casos, o texto da IA sai sozinho, sem clique em Enviar, com o botão
 *   de falar com a equipe. Injeção e assunto fora do agendamento pausam a IA
 *   (DEC-083). Modelo falhou / saída rejeitada → frase DEC-107 (#404); falha do
 *   redator de exceção passa à equipe (DEC-104).
 */
import { AI_TIMEOUT_MS, detectStrongInjectionSignals } from '../../ai'
import type { Clock } from '../../db/clock'
import type { ClinicCaller } from '../envelopes'
import { ClinicError } from '../errors'
import { isClinicAiAssistEnabled } from '../config/settings'
import { getConversation } from '../inbox/conversations'
import { sendOutboundMessageOp } from '../inbox/operations'
import { toSendInteractive } from './choice-offer'
import { messagingWindowForConversation } from '../inbox/window'
import type { OutboxRow } from '../outbox'
import type { ClinicDb } from '../store'
import { tryAiAutoBook, type AutoBookOutcome } from './autobook'
import { catalogReply } from './catalog-reply'
import {
  createDeferredBookingFrame,
  type DeferredBookingFrame,
} from './deferred-booking-frame'
import type { SendOutboundInput } from '../inbox/types'
import { autodraftDebounceMs } from './debounce'
import { logPolicyShadow } from './policy-shadow'
import {
  AI_TRANSPARENCY_TEXT,
  HUMAN_HANDOFF_BUTTON_ID,
  HUMAN_HANDOFF_BUTTON_TITLE,
  handoffReason,
  notifyHumanHandoff,
} from './human-handoff'
import {
  clearMediaAskTextOnRealInbound,
  decideMediaOnlyTurn,
  markMediaAskTextAsked,
  MEDIA_ASK_TEXT,
} from './media-ask-text'
import { notifyModelFallback } from './model-fallback'
import {
  classifySensitive,
  hasAiTransparencyQuestion,
  hasPolicyQuestion,
  hasStopRequest,
} from './nlu/sensitive'
import { isCancelIntent, isRescheduleIntent, tryAiReschedule } from './reschedule'
import { isConversationPaused } from './protection'
import { getScheduleSession } from './schedule-session'
import { getSuggestion, insertSuggestion, markSuggestionSuperseded } from './suggestions'
import type { AiAssistDeps, AiSuggestionRow } from './types'
import { emitTurnDecided, routeFromAutodraftOutcome } from './turn-decided'
import { loadTurnContext } from './turn-context'
import { getAiDailyUsage } from './usage'
import { checkAutomationQuota, contactIdForConversation, recordLimitReached } from './abuse-limits'
import { runRestrictedExtractor } from './llm-extractor'
import { generateExceptionReply } from './exception-reply'

/** ADR-0015: anexa afterPersist do frame diferido ao envio outbound. */
function withDeferredFrame(
  input: SendOutboundInput,
  deferred: DeferredBookingFrame | undefined,
  clock: Clock,
): SendOutboundInput {
  if (!deferred?.hasWork) return input
  return { ...input, afterPersist: deferred.toAfterPersist(clock) }
}

export const AUTODRAFT_ACTOR_ID = 'system:ai-autodraft'
const AUTODRAFT_ACTOR_NAME = 'IA'

/**
 * Depois deste prazo um job deixado em `generating` é órfão: o alarme anterior
 * não chegou a apagar a linha (fetch do gateway que não rejeita no abort, ou
 * isolate morto). O painel trata qualquer linha como spinner.
 */
export const AUTODRAFT_STALE_MS = AI_TIMEOUT_MS + 15_000

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
  if (isConversationPaused(db, tenantId, input.conversationId)) return null
  const waitMs = autodraftDebounceMs({ text: body, fromInteractive: input.fromInteractive })
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
     ORDER BY created_at DESC, id DESC
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
  status: 'ready' | 'failed' | 'skipped' | 'superseded' | 'cap_reached'
  suggestion: AiSuggestionRow | null
  reason?: string
  /** Tentativa de agendamento pela IA (só com rascunho pronto). */
  autoBook?: AutoBookOutcome
  /** Texto da IA enviado sem clique, quando não houve proposta. */
  replyOutbox?: OutboxRow[]
}

function lastMessageDirection(db: ClinicDb, tenantId: string, conversationId: string): string | null {
  const r = db.get<{ direction: string }>(
    `SELECT direction FROM messages WHERE tenant_id = ? AND conversation_id = ? AND direction != 'system'
     ORDER BY created_at DESC LIMIT 1`,
    tenantId,
    conversationId,
  )
  return r?.direction ?? null
}

/**
 * Um job `generating` no início do alarme é sempre órfão: este DO não corre
 * dois alarmes ao mesmo tempo, e o envio só acontece depois de apagar a linha.
 * Reabre para a mesma passagem. Sem isto o spinner fica preso para sempre.
 */
function reclaimOrphanGenerating(db: ClinicDb, tenantId: string, now: number): void {
  const row = db.get<{ n: number }>(
    `SELECT COUNT(*) AS n FROM ai_autodraft_jobs WHERE tenant_id = ? AND state = 'generating'`,
    tenantId,
  )
  const count = Number(row?.n ?? 0)
  if (count <= 0) return
  db.run(
    `UPDATE ai_autodraft_jobs SET state = 'queued', due_at = ?, updated_at = ?
     WHERE tenant_id = ? AND state = 'generating'`,
    now,
    now,
    tenantId,
  )
  console.warn(
    JSON.stringify({
      level: 'warn',
      event: 'ai.autodraft_stale',
      tenantId,
      count,
    }),
  )
}

/** Processa os jobs vencidos. Chamado pelo alarme do DO. */
export async function runDueAutoDrafts(
  db: ClinicDb,
  caller: ClinicCaller,
  clock: Clock,
  deps: AiAssistDeps,
  opts: { limit?: number; onStart?: (job: AutoDraftJob) => Promise<void> | void } = {},
): Promise<AutoDraftOutcome[]> {
  const tenantId = caller.tenantId
  const now = clock.nowMs()
  reclaimOrphanGenerating(db, tenantId, now)
  const due = db
    .all<JobSql>(
      `SELECT conversation_id, message_id, due_at, state, created_at FROM ai_autodraft_jobs
       WHERE tenant_id = ? AND state = 'queued' AND due_at <= ? ORDER BY due_at LIMIT ?`,
      tenantId,
      now,
      opts.limit ?? 10,
    )
    .map(mapJob)

  const out: AutoDraftOutcome[] = []
  for (const job of due) {
    const jobStarted = clock.nowMs()
    const debounceMs = Math.max(0, job.dueAt - job.createdAt)
    const record = (
      outcome: AutoDraftOutcome,
      extra: {
        modelCalled?: boolean
        textDiscarded?: boolean
        fallbackSent?: boolean
        decisionMs?: number
        sendMs?: number
      } = {},
    ): void => {
      const route = routeFromAutodraftOutcome({
        status: outcome.status,
        reason: outcome.reason,
        proposalId: outcome.autoBook?.proposalId ?? null,
        deterministicReply: Boolean(outcome.autoBook?.replyText?.trim()),
        fallbackSent: extra.fallbackSent,
        modelCalled: extra.modelCalled,
        textDiscarded: extra.textDiscarded,
      })
      emitTurnDecided(
        db,
        {
          tenantId,
          conversationId: outcome.conversationId,
          messageIds: [outcome.messageId],
          route,
          slotsFilled: [],
          slotsMissing: [],
          modelCalled: Boolean(extra.modelCalled ?? outcome.suggestion),
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
    if (!isClinicAiAssistEnabled(db, tenantId)) { skip('ai_not_enabled'); continue }
    if (!messagingWindowForConversation(db, tenantId, job.conversationId, now).open) { skip('window_closed'); continue }
    if (isConversationPaused(db, tenantId, job.conversationId)) { skip('ai_reply_paused'); continue }
    // A atendente já respondeu durante a espera.
    if (lastMessageDirection(db, tenantId, job.conversationId) !== 'inbound') { skip('already_answered'); continue }
    const inboundBody =
      db.get<{ body: string }>(
        `SELECT body FROM messages WHERE tenant_id = ? AND id = ?`,
        tenantId,
        job.messageId,
      )?.body ?? ''
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
      let replyOutbox: OutboxRow[] = []
      try {
        const sent = sendOutboundMessageOp(
          db,
          caller,
          {
            conversationId: job.conversationId,
            body: MEDIA_ASK_TEXT,
            interactive: {
              buttons: [{ id: HUMAN_HANDOFF_BUTTON_ID, title: HUMAN_HANDOFF_BUTTON_TITLE }],
            },
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
    // DEC-091: remarcação com compromisso futuro — antes do handoff e do funil de zonas.
    const upcoming = turn.upcoming
    if (
      !isCancelIntent(turnText) &&
      isRescheduleIntent(turnText, { hasUpcoming: Boolean(upcoming), priorOffer: false })
    ) {
      const reschedule = await tryAiReschedule(db, caller, clock, {
        conversationId: job.conversationId,
        inboundText: turnText,
        capability: deps.autoBookPaused !== true,
        abuseLimits: deps.abuseLimits,
        forecast: deps.forecast,
      })
      if (reschedule) {
        let replyOutbox: OutboxRow[] = [...reschedule.outbox]
        if (reschedule.replyText.trim()) {
          try {
            const sent = sendOutboundMessageOp(
              db,
              caller,
              withDeferredFrame(
                {
                  conversationId: job.conversationId,
                  body: reschedule.replyText,
                  interactive: { buttons: [{ id: HUMAN_HANDOFF_BUTTON_ID, title: HUMAN_HANDOFF_BUTTON_TITLE }] },
                  clientRequestId: `ai-reschedule:${job.messageId}`,
                  authorClerkUserId: AUTODRAFT_ACTOR_ID,
                  authorDisplayName: AUTODRAFT_ACTOR_NAME,
                },
                reschedule.deferredFrame,
                clock,
              ),
              clock,
            )
            replyOutbox = [...replyOutbox, ...sent.outbox]
          } catch (err) {
            if (!(err instanceof ClinicError)) throw err
          }
        }
        cancelAutoDraft(db, tenantId, job.conversationId)
        record({
          ...job,
          status: 'skipped',
          suggestion: null,
          reason: 'reschedule_flow',
          replyOutbox,
        })
        continue
      }
      // Pedido de remarcar sem compromisso futuro → equipe.
      const handoff = notifyHumanHandoff(
        db,
        tenantId,
        {
          conversationId: job.conversationId,
          reason: 'human_only',
          clientRequestId: `ai-handoff:${job.messageId}`,
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
    // Continuação da oferta de remarcação (escolha de horário / outro dia).
    if (upcoming) {
      const cont = await tryAiReschedule(db, caller, clock, {
        conversationId: job.conversationId,
        inboundText: turnText,
        capability: deps.autoBookPaused !== true,
        abuseLimits: deps.abuseLimits,
        forecast: deps.forecast,
      })
      if (cont) {
        let replyOutbox: OutboxRow[] = [...cont.outbox]
        if (cont.replyText.trim()) {
          try {
            const sent = sendOutboundMessageOp(
              db,
              caller,
              withDeferredFrame(
                {
                  conversationId: job.conversationId,
                  body: cont.replyText,
                  interactive: { buttons: [{ id: HUMAN_HANDOFF_BUTTON_ID, title: HUMAN_HANDOFF_BUTTON_TITLE }] },
                  clientRequestId: `ai-reschedule:${job.messageId}`,
                  authorClerkUserId: AUTODRAFT_ACTOR_ID,
                  authorDisplayName: AUTODRAFT_ACTOR_NAME,
                },
                cont.deferredFrame,
                clock,
              ),
              clock,
            )
            replyOutbox = [...replyOutbox, ...sent.outbox]
          } catch (err) {
            if (!(err instanceof ClinicError)) throw err
          }
        }
        cancelAutoDraft(db, tenantId, job.conversationId)
        record({
          ...job,
          status: 'skipped',
          suggestion: null,
          reason: 'reschedule_flow',
          replyOutbox,
        })
        continue
      }
    }
    // CF-04 / E-06: pergunta condicional → política cadastrada, sem pausa.
    const sensitiveHits = classifySensitive(turnText)
    if (hasPolicyQuestion(sensitiveHits)) {
      const settings = turn.settings
      const policy =
        settings.signalCancellationPolicy.trim() ||
        settings.reschedulePolicy.trim() ||
        ''
      if (policy) {
        let replyOutbox: OutboxRow[] = []
        try {
          const sent = sendOutboundMessageOp(
            db,
            caller,
            {
              conversationId: job.conversationId,
              body: policy,
              interactive: {
                buttons: [{ id: HUMAN_HANDOFF_BUTTON_ID, title: HUMAN_HANDOFF_BUTTON_TITLE }],
              },
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
      let replyOutbox: OutboxRow[] = []
      try {
        const sent = sendOutboundMessageOp(
          db,
          caller,
          {
            conversationId: job.conversationId,
            body: AI_TRANSPARENCY_TEXT,
            interactive: {
              buttons: [{ id: HUMAN_HANDOFF_BUTTON_ID, title: HUMAN_HANDOFF_BUTTON_TITLE }],
            },
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
    const reason = handoffReason(db, tenantId, turnText, clock, turn)
    if (reason) {
      const handoff = notifyHumanHandoff(
        db,
        tenantId,
        {
          conversationId: job.conversationId,
          reason,
          clientRequestId: `ai-handoff:${job.messageId}`,
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
    const catalogDeferred = createDeferredBookingFrame()
    const catalogText = catalogReply(db, tenantId, turnText, clock, {
      conversationId: job.conversationId,
      turn,
      deferredFrame: catalogDeferred,
    })
    if (catalogText) {
      let replyOutbox: OutboxRow[] = []
      try {
        const sent = sendOutboundMessageOp(
          db,
          caller,
          withDeferredFrame(
            {
              conversationId: job.conversationId,
              body: catalogText,
              interactive: { buttons: [{ id: HUMAN_HANDOFF_BUTTON_ID, title: HUMAN_HANDOFF_BUTTON_TITLE }] },
              clientRequestId: `ai-catalog:${job.messageId}`,
              authorClerkUserId: AUTODRAFT_ACTOR_ID,
              authorDisplayName: AUTODRAFT_ACTOR_NAME,
            },
            catalogDeferred,
            clock,
          ),
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
    await opts.onStart?.(job)

    // CA-03 (#413) + M6 (#416): extrator restrito → decidir → redator de exceção.
    let suggestion: AiSuggestionRow | null = null
    let autoBook: AutoBookOutcome | undefined
    let modelCalled = false
    let generateError: string | null = null
    let exceptionHandoff = false
    let liveTurn = turn

    try {
      const extracted = await runRestrictedExtractor(db, tenantId, liveTurn, clock, deps)
      if (extracted.modelCalled) modelCalled = true
      if (extracted.applied) {
        liveTurn = loadTurnContext(
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
      }
    } catch (err) {
      console.warn(
        JSON.stringify({
          level: 'warn',
          event: 'ai.extractor_error',
          tenantId,
          error: err instanceof Error ? err.message : 'unknown',
        }),
      )
    }

    try {
      let capability = deps.autoBookPaused !== true
      let limitNote: string | null = null
      if (capability && deps.abuseLimits?.enabled && contactId) {
        const decision = checkAutomationQuota(db, deps.abuseLimits, { tenantId, contactId, effect: 'ai_booking' }, clock)
        if (!decision.allowed) {
          recordLimitReached(db, deps.abuseLimits, { tenantId, contactId, effect: 'ai_booking', decision }, clock)
          capability = false
          limitNote = decision.message
        }
      }
      autoBook = await tryAiAutoBook(db, caller, clock, {
        conversationId: job.conversationId,
        enabled: true,
        capability,
        abuseLimits: deps.abuseLimits,
        interactiveChoices: deps.interactiveChoices === true,
        forecast: deps.forecast,
        turn: liveTurn,
      })
      if (limitNote) autoBook = { ...autoBook, notes: [autoBook.notes, limitNote].filter(Boolean).join('\n') }
    } catch (err) {
      console.warn(
        JSON.stringify({
          level: 'warn',
          event: 'ai.autobook_error',
          tenantId,
          error: err instanceof Error ? err.message : 'unknown',
        }),
      )
    }

    const deterministicReplyEarly = Boolean(autoBook?.replyText && autoBook.replyText.trim())
    const proposalDeliveredEarly =
      Boolean(autoBook?.proposalId) && !deterministicReplyEarly
    const needsOpenReply = !deterministicReplyEarly && !proposalDeliveredEarly

    logPolicyShadow({
      tenantId,
      conversationId: job.conversationId,
      phase: 'ca03',
      current: { action: 'model' },
      proposed: { action: needsOpenReply ? 'model' : 'skip_model', detail: needsOpenReply ? 'exception' : undefined },
    })

    if (needsOpenReply) {
      try {
        if (getAiDailyUsage(db, tenantId, clock).capReached) {
          cancelAutoDraft(db, tenantId, job.conversationId)
          record({ ...job, status: 'cap_reached', suggestion: null })
          continue
        }
        const exception = await generateExceptionReply(db, caller, clock, deps, {
          conversationId: job.conversationId,
          question: liveTurn.turnText,
          turn: liveTurn,
        })
        modelCalled = true
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
          // DEC-104 «passa à equipe»: alerta alter_awaiting_team via DEC-107
          // (notifyModelFallback), sem pausar a IA — alinhado a CF-14 / K-01.
          // Pausa completa fica para DEC-083 (pedido de pessoa / fora do assunto).
          exceptionHandoff = false
          generateError = exception.rejection ?? 'exception_rejected'
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
        generateError = code
        modelCalled = true
        exceptionHandoff = false
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
    } else if (autoBook && (autoBook.proposalId || autoBook.replyText != null || autoBook.notes)) {
      const proposalDelivered =
        Boolean(autoBook.proposalId) && !(autoBook.replyText && autoBook.replyText.trim())
      const text = proposalDelivered ? '' : (autoBook.replyText ?? '')
      const notes = generateError
        ? [autoBook.notes, `Geração do modelo falhou (${generateError}); seguiu o caminho determinístico.`]
            .filter(Boolean)
            .join('\n')
        : (autoBook.notes ?? '')
      suggestion = insertSuggestion(db, {
        tenantId,
        conversationId: job.conversationId,
        kind: 'reply',
        status: 'pending',
        provider: 'none',
        model: 'none',
        suggestedText: text,
        internalNotes: notes,
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
        errorCode: null,
        requestedByClerkUserId: AUTODRAFT_ACTOR_ID,
        requestedByDisplayName: 'Rascunho automático',
        parentSuggestionId: null,
        replyToMessageId: null,
        origin: 'auto',
        createdAt: clock.nowMs(),
      })
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

    if (
      suggestion &&
      autoBook &&
      needsOpenReply &&
      (autoBook.proposalId || autoBook.replyText != null || autoBook.notes)
    ) {
      if (generateError) {
        autoBook = {
          ...autoBook,
          notes: [autoBook.notes, `Geração do modelo falhou (${generateError}); seguiu o caminho determinístico.`]
            .filter(Boolean)
            .join('\n'),
        }
      }
      const deterministic = Boolean(autoBook.replyText != null && autoBook.replyText !== '')
      const proposalDelivered =
        Boolean(autoBook.proposalId) && !(autoBook.replyText && autoBook.replyText.trim())
      const text = proposalDelivered
        ? ''
        : (autoBook.replyText ?? (suggestion.status === 'pending' ? suggestion.suggestedText : ''))
      const notes = [autoBook.notes, autoBook.replyText ? '' : suggestion.internalNotes]
        .filter(Boolean)
        .join('\n')
      if (deterministic && suggestion.status === 'failed') {
        db.run(
          `UPDATE ai_suggestions
           SET status = 'pending', suggested_text = ?, internal_notes = ?, error_code = NULL, updated_at = ?
           WHERE tenant_id = ? AND id = ?`,
          text,
          notes,
          clock.nowMs(),
          tenantId,
          suggestion.id,
        )
      } else {
        db.run(
          `UPDATE ai_suggestions SET suggested_text = ?, internal_notes = ?, updated_at = ?
           WHERE tenant_id = ? AND id = ?`,
          text,
          notes,
          clock.nowMs(),
          tenantId,
          suggestion.id,
        )
      }
      suggestion = getSuggestion(db, tenantId, suggestion.id) ?? suggestion
    }

    let replyOutbox: OutboxRow[] | undefined
    const draftText = suggestion?.suggestedText.trim() ?? ''
    const injectionSuspected =
      Boolean(suggestion?.warningCodes.includes('injection_suspected')) &&
      detectStrongInjectionSignals(turnText)
    const deterministicReply = Boolean(autoBook?.replyText && autoBook.replyText.trim())
    const proposalDelivered =
      Boolean(autoBook?.proposalId) && !deterministicReply
    if (injectionSuspected && suggestion && !deterministicReply && !proposalDelivered) {
      const bookingOpen = Boolean(
        getScheduleSession(db, tenantId, job.conversationId)?.serviceId || autoBook?.serviceId,
      )
      if (!bookingOpen) {
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
      }
    } else if (suggestion?.status === 'pending' && draftText && !proposalDelivered) {
      try {
        const choiceInteractive = toSendInteractive(autoBook?.interactive ?? null)
        const sent = sendOutboundMessageOp(
          db,
          caller,
          withDeferredFrame(
            {
              conversationId: job.conversationId,
              body: draftText,
              interactive: deterministicReply
                ? choiceInteractive
                : { buttons: [{ id: HUMAN_HANDOFF_BUTTON_ID, title: HUMAN_HANDOFF_BUTTON_TITLE }] },
              clientRequestId: `ai-reply:${suggestion.id}`,
              authorClerkUserId: AUTODRAFT_ACTOR_ID,
              authorDisplayName: AUTODRAFT_ACTOR_NAME,
              aiSuggestionId: suggestion.id,
            },
            autoBook?.deferredFrame,
            clock,
          ),
          clock,
        )
        replyOutbox = sent.outbox
        suggestion = getSuggestion(db, tenantId, suggestion.id) ?? suggestion
      } catch (err) {
        if (!(err instanceof ClinicError)) throw err
      }
    }
    const tookInjectionPath = injectionSuspected && !deterministicReply && !proposalDelivered
    const hasOutbound = Boolean(replyOutbox && replyOutbox.length > 0)
    let fallbackSent = false
    if (!tookInjectionPath && !hasOutbound && !proposalDelivered && !deterministicReply) {
      // DEC-104: falha do redator de exceção → frase fixa + passa à equipe.
      if (exceptionHandoff) {
        const handoff = notifyHumanHandoff(
          db,
          tenantId,
          {
            conversationId: job.conversationId,
            reason: 'human_only',
            clientRequestId: `ai-exception-handoff:${job.messageId}`,
          },
          clock,
        )
        replyOutbox = handoff.outbox
        fallbackSent = handoff.outbox.length > 0
      } else {
        const fallback = notifyModelFallback(
          db,
          tenantId,
          { conversationId: job.conversationId, messageId: job.messageId },
          clock,
        )
        replyOutbox = fallback.outbox
        fallbackSent = fallback.sent || fallback.already
      }
    }
    const textDiscarded =
      modelCalled &&
      (deterministicReply || proposalDelivered || suggestion?.status === 'failed')
    record(
      {
        ...job,
        status: suggestion?.status === 'failed' ? 'failed' : 'ready',
        suggestion,
        autoBook,
        replyOutbox,
      },
      {
        modelCalled,
        textDiscarded,
        fallbackSent,
        decisionMs: Math.max(0, clock.nowMs() - jobStarted),
      },
    )
  }
  return out
}

/** Estado do rascunho de uma conversa para o painel. */
export function getConversationDraftState(
  db: ClinicDb,
  tenantId: string,
  conversationId: string,
  clock: Clock,
): { job: AutoDraftJob | null; suggestion: AiSuggestionRow | null; usage: ReturnType<typeof getAiDailyUsage> } {
  const job = getAutoDraftJob(db, tenantId, conversationId)
  const row = db.get<{ id: string }>(
    `SELECT id FROM ai_suggestions
     WHERE tenant_id = ? AND conversation_id = ? AND kind = 'reply' AND status IN ('pending', 'failed')
     ORDER BY created_at DESC LIMIT 1`,
    tenantId,
    conversationId,
  )
  return {
    job,
    suggestion: row ? getSuggestion(db, tenantId, row.id) : null,
    usage: getAiDailyUsage(db, tenantId, clock),
  }
}
