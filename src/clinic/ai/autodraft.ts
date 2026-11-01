/**
 * Rascunho automático da IA a cada mensagem da cliente (aprovado por Paulo, 27/10/2026).
 * - Debounce: junta mensagens seguidas (AI_AUTODRAFT_DEBOUNCE_MS).
 * - Gera em segundo plano (alarme do DO) e guarda como sugestão pendente.
 * - Quando dia, horário e serviço ficam claros, o backend envia a proposta e não manda
 *   a pergunta «Confirma…?» (autobook.ts), salvo pausa da owner.
 * - Nos outros casos, o texto da IA sai sozinho, sem clique em Enviar, com o botão
 *   de falar com a equipe. Injeção e assunto fora do agendamento pausam a IA
 *   (DEC-083). Modelo falhou / saída rejeitada sem injeção → frase DEC-107 (#404)
 *   sem pausar a IA.
 */
import { AI_AUTODRAFT_DEBOUNCE_MS, AI_TIMEOUT_MS } from '../../ai'
import type { Clock } from '../../db/clock'
import type { ClinicCaller } from '../envelopes'
import { ClinicError } from '../errors'
import { isClinicAiAssistEnabled } from '../config/settings'
import { getConversation } from '../inbox/conversations'
import { sendOutboundMessageOp } from '../inbox/operations'
import { messagingWindowForConversation } from '../inbox/window'
import type { OutboxRow } from '../outbox'
import type { ClinicDb } from '../store'
import { tryAiAutoBook, type AutoBookOutcome } from './autobook'
import { catalogReply } from './catalog-reply'
import {
  HUMAN_HANDOFF_BUTTON_ID,
  HUMAN_HANDOFF_BUTTON_TITLE,
  handoffReason,
  notifyHumanHandoff,
} from './human-handoff'
import { notifyModelFallback } from './model-fallback'
import { isCancelIntent, isRescheduleIntent, loadUpcomingAppointment, tryAiReschedule } from './reschedule'
import { runGenerateInternal } from './operations'
import { isConversationPaused } from './protection'
import { getScheduleSession } from './schedule-session'
import { getSuggestion, insertSuggestion, markSuggestionSuperseded } from './suggestions'
import type { AiAssistDeps, AiSuggestionRow } from './types'
import { emitTurnDecided, routeFromAutodraftOutcome } from './turn-decided'
import { getAiDailyUsage } from './usage'
import { checkAutomationQuota, contactIdForConversation, recordLimitReached } from './abuse-limits'

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
}

type JobSql = {
  conversation_id: string
  message_id: string
  due_at: number
  state: 'queued' | 'generating'
}

function mapJob(r: JobSql): AutoDraftJob {
  return { conversationId: r.conversation_id, messageId: r.message_id, dueAt: r.due_at, state: r.state }
}

export function getAutoDraftJob(db: ClinicDb, tenantId: string, conversationId: string): AutoDraftJob | null {
  const r = db.get<JobSql>(
    `SELECT conversation_id, message_id, due_at, state FROM ai_autodraft_jobs
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
  input: { conversationId: string; messageId: string },
  clock: Clock,
): AutoDraftJob | null {
  if (!isClinicAiAssistEnabled(db, tenantId)) return null
  if (isConversationPaused(db, tenantId, input.conversationId)) return null
  const now = clock.nowMs()
  db.run(
    `INSERT INTO ai_autodraft_jobs (tenant_id, conversation_id, message_id, due_at, state, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'queued', ?, ?)
     ON CONFLICT (tenant_id, conversation_id) DO UPDATE SET
       message_id = excluded.message_id, due_at = excluded.due_at,
       state = 'queued', updated_at = excluded.updated_at`,
    tenantId,
    input.conversationId,
    input.messageId,
    now + AI_AUTODRAFT_DEBOUNCE_MS,
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
      `SELECT conversation_id, message_id, due_at, state FROM ai_autodraft_jobs
       WHERE tenant_id = ? AND state = 'queued' AND due_at <= ? ORDER BY due_at LIMIT ?`,
      tenantId,
      now,
      opts.limit ?? 10,
    )
    .map(mapJob)

  const out: AutoDraftOutcome[] = []
  for (const job of due) {
    const jobStarted = clock.nowMs()
    const debounceMs = Math.max(0, jobStarted - (job.dueAt - AI_AUTODRAFT_DEBOUNCE_MS))
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
    // DEC-091: remarcação com compromisso futuro — antes do handoff e do funil de zonas.
    const upcoming = conv.contactId
      ? loadUpcomingAppointment(db, tenantId, conv.contactId, clock.nowMs())
      : null
    if (
      !isCancelIntent(inboundBody) &&
      isRescheduleIntent(inboundBody, { hasUpcoming: Boolean(upcoming), priorOffer: false })
    ) {
      const reschedule = await tryAiReschedule(db, caller, clock, {
        conversationId: job.conversationId,
        inboundText: inboundBody,
        capability: deps.autoBookPaused !== true,
        abuseLimits: deps.abuseLimits,
      })
      if (reschedule) {
        let replyOutbox: OutboxRow[] = [...reschedule.outbox]
        if (reschedule.replyText.trim()) {
          try {
            const sent = sendOutboundMessageOp(
              db,
              caller,
              {
                conversationId: job.conversationId,
                body: reschedule.replyText,
                interactive: { buttons: [{ id: HUMAN_HANDOFF_BUTTON_ID, title: HUMAN_HANDOFF_BUTTON_TITLE }] },
                clientRequestId: `ai-reschedule:${job.messageId}`,
                authorClerkUserId: AUTODRAFT_ACTOR_ID,
                authorDisplayName: AUTODRAFT_ACTOR_NAME,
              },
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
        inboundText: inboundBody,
        capability: deps.autoBookPaused !== true,
        abuseLimits: deps.abuseLimits,
      })
      if (cont) {
        let replyOutbox: OutboxRow[] = [...cont.outbox]
        if (cont.replyText.trim()) {
          try {
            const sent = sendOutboundMessageOp(
              db,
              caller,
              {
                conversationId: job.conversationId,
                body: cont.replyText,
                interactive: { buttons: [{ id: HUMAN_HANDOFF_BUTTON_ID, title: HUMAN_HANDOFF_BUTTON_TITLE }] },
                clientRequestId: `ai-reschedule:${job.messageId}`,
                authorClerkUserId: AUTODRAFT_ACTOR_ID,
                authorDisplayName: AUTODRAFT_ACTOR_NAME,
              },
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
    const reason = handoffReason(db, tenantId, inboundBody, clock)
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
    const catalogText = catalogReply(db, tenantId, inboundBody, clock, {
      conversationId: job.conversationId,
    })
    if (catalogText) {
      let replyOutbox: OutboxRow[] = []
      try {
        const sent = sendOutboundMessageOp(
          db,
          caller,
          {
            conversationId: job.conversationId,
            body: catalogText,
            interactive: { buttons: [{ id: HUMAN_HANDOFF_BUTTON_ID, title: HUMAN_HANDOFF_BUTTON_TITLE }] },
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

    let suggestion: AiSuggestionRow | null = null
    let generateError: string | null = null
    try {
      const res = await runGenerateInternal(db, caller, clock, deps, {
        conversationId: job.conversationId,
        clientRequestId: '',
        kind: 'reply',
        command: 'suggest_reply',
        actorClerkUserId: AUTODRAFT_ACTOR_ID,
        actorDisplayName: 'Rascunho automático',
        origin: 'auto',
      })
      suggestion = res.suggestion
    } catch (err) {
      const code = err instanceof ClinicError ? err.code : 'autodraft_error'
      // Cap / IA desligada: não há o que enviar. Outros erros → ainda tenta autobook.
      if (code === 'ai_daily_cap_reached' || code === 'ai_not_enabled') {
        cancelAutoDraft(db, tenantId, job.conversationId)
        record({ ...job, status: code === 'ai_daily_cap_reached' ? 'cap_reached' : 'failed', suggestion: null, reason: code })
        continue
      }
      generateError = code
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

    // Chegou outra mensagem durante a geração → descarta este; o job novo segue.
    const current = getAutoDraftJob(db, tenantId, job.conversationId)
    if (current && current.messageId !== job.messageId) {
      markSuggestionSuperseded(db, tenantId, suggestion.id, clock.nowMs())
      record({ ...job, status: 'superseded', suggestion: getSuggestion(db, tenantId, suggestion.id) })
      continue
    }
    cancelAutoDraft(db, tenantId, job.conversationId)
    let autoBook: AutoBookOutcome | undefined
    // Sempre tenta o caminho determinístico (proposta / pergunta de variantes),
    // mesmo se o modelo falhou — evita silêncio indevido no WhatsApp.
    try {
      // Capacidade sempre ligada. A pausa da owner é o único desligamento.
      let capability = deps.autoBookPaused !== true
      let limitNote: string | null = null
      // S7 (#178): quota de marcações automáticas (contato/clínica) e compromissos futuros.
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
        suggestionId: suggestion.id,
        enabled: true,
        // Revalidado aqui, na execução do job (inclusive jobs já enfileirados).
        capability,
        abuseLimits: deps.abuseLimits,
      })
      if (limitNote) autoBook = { ...autoBook, notes: [autoBook.notes, limitNote].filter(Boolean).join('\n') }
      if (generateError) {
        autoBook = {
          ...autoBook,
          notes: [autoBook.notes, `Geração do modelo falhou (${generateError}); seguiu o caminho determinístico.`]
            .filter(Boolean)
            .join('\n'),
        }
      }
      if (autoBook.proposalId || autoBook.replyText != null || autoBook.notes) {
        const deterministic = Boolean(autoBook.replyText != null && autoBook.replyText !== '')
        // Proposta entregue no WhatsApp → texto vazio. Aviso determinístico (falha de envio,
        // zona em falta, horário ocupado) prevalece mesmo com proposalId.
        const proposalDelivered =
          Boolean(autoBook.proposalId) && !(autoBook.replyText && autoBook.replyText.trim())
        const text = proposalDelivered
          ? ''
          : (autoBook.replyText ?? (suggestion.status === 'pending' ? suggestion.suggestedText : ''))
        const notes = [autoBook.notes, autoBook.replyText ? '' : suggestion.internalNotes]
          .filter(Boolean)
          .join('\n')
        // Texto determinístico promove a sugestão a pending para o envio automático.
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
    let replyOutbox: OutboxRow[] | undefined
    const draftText = suggestion.suggestedText.trim()
    // Só injeção pausa (DEC-083). Saída rejeitada sem injeção → fallback DEC-107 (#404).
    const injectionSuspected = suggestion.warningCodes.includes('injection_suspected')
    // Resposta determinística do autobook (ex.: pedir variantes) ignora rejeição do modelo.
    const deterministicReply = Boolean(autoBook?.replyText && autoBook.replyText.trim())
    const proposalDelivered =
      Boolean(autoBook?.proposalId) && !deterministicReply
    if (injectionSuspected && !deterministicReply && !proposalDelivered) {
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
    } else if (
      suggestion.status === 'pending' &&
      draftText &&
      !proposalDelivered
    ) {
      try {
        const sent = sendOutboundMessageOp(
          db,
          caller,
          {
            conversationId: job.conversationId,
            body: draftText,
            interactive: deterministicReply
              ? null
              : { buttons: [{ id: HUMAN_HANDOFF_BUTTON_ID, title: HUMAN_HANDOFF_BUTTON_TITLE }] },
            clientRequestId: `ai-reply:${suggestion.id}`,
            authorClerkUserId: AUTODRAFT_ACTOR_ID,
            authorDisplayName: AUTODRAFT_ACTOR_NAME,
            aiSuggestionId: suggestion.id,
          },
          clock,
        )
        replyOutbox = sent.outbox
        suggestion = getSuggestion(db, tenantId, suggestion.id) ?? suggestion
      } catch (err) {
        if (!(err instanceof ClinicError)) throw err
      }
    }
    // #404 / DEC-107 / INV-09: turno elegível sem saída → frase de fallback (sem pausar).
    // Injeção mantém o caminho DEC-083 (mesmo sem outbox se já estava pausada).
    const tookInjectionPath = injectionSuspected && !deterministicReply && !proposalDelivered
    const hasOutbound = Boolean(replyOutbox && replyOutbox.length > 0)
    let fallbackSent = false
    if (!tookInjectionPath && !hasOutbound && !proposalDelivered && !deterministicReply) {
      const fallback = notifyModelFallback(
        db,
        tenantId,
        { conversationId: job.conversationId, messageId: job.messageId },
        clock,
      )
      replyOutbox = fallback.outbox
      fallbackSent = fallback.sent || fallback.already
    }
    record(
      {
        ...job,
        status: suggestion.status === 'failed' ? 'failed' : 'ready',
        suggestion,
        autoBook,
        replyOutbox,
      },
      {
        modelCalled: true,
        textDiscarded: suggestion.status === 'failed',
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
