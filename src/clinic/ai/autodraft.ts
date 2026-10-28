/**
 * Rascunho automático da IA a cada mensagem da cliente (aprovado por Paulo, 27/10/2026).
 * - Debounce: junta mensagens seguidas (AI_AUTODRAFT_DEBOUNCE_MS).
 * - Gera em segundo plano (alarme do DO) e guarda como sugestão pendente.
 * - Nunca envia. Agenda SÓ após confirmação explícita da cliente (dia, horário e
 *   procedimento) — ver autobook.ts (decidido por Paulo, 28/10/2026).
 */
import { AI_AUTODRAFT_DEBOUNCE_MS } from '../../ai'
import type { Clock } from '../../db/clock'
import type { ClinicCaller } from '../envelopes'
import { ClinicError } from '../errors'
import { isClinicAiAssistEnabled } from '../config/settings'
import { getConversation } from '../inbox/conversations'
import { messagingWindowForConversation } from '../inbox/window'
import type { ClinicDb } from '../store'
import { tryAiAutoBook, type AutoBookOutcome } from './autobook'
import { runGenerateInternal } from './operations'
import { getSuggestion, markSuggestionSuperseded } from './suggestions'
import type { AiAssistDeps, AiSuggestionRow } from './types'
import { getAiDailyUsage } from './usage'
import { checkAutomationQuota, contactIdForConversation, recordLimitReached } from './abuse-limits'

export const AUTODRAFT_ACTOR_ID = 'system:ai-autodraft'

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
    const skip = (reason: string): void => {
      cancelAutoDraft(db, tenantId, job.conversationId)
      out.push({ ...job, status: 'skipped', suggestion: null, reason })
    }
    const conv = getConversation(db, tenantId, job.conversationId)
    if (!conv || conv.status === 'closed') { skip('conversation_closed'); continue }
    if (!isClinicAiAssistEnabled(db, tenantId)) { skip('ai_not_enabled'); continue }
    if (!messagingWindowForConversation(db, tenantId, job.conversationId, now).open) { skip('window_closed'); continue }
    // A atendente já respondeu durante a espera.
    if (lastMessageDirection(db, tenantId, job.conversationId) !== 'inbound') { skip('already_answered'); continue }
    if (getAiDailyUsage(db, tenantId, clock).capReached) {
      cancelAutoDraft(db, tenantId, job.conversationId)
      out.push({ ...job, status: 'cap_reached', suggestion: null })
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

    let suggestion: AiSuggestionRow
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
      cancelAutoDraft(db, tenantId, job.conversationId)
      out.push({ ...job, status: code === 'ai_daily_cap_reached' ? 'cap_reached' : 'failed', suggestion: null, reason: code })
      continue
    }

    // Chegou outra mensagem durante a geração → descarta este; o job novo segue.
    const current = getAutoDraftJob(db, tenantId, job.conversationId)
    if (current && current.messageId !== job.messageId) {
      markSuggestionSuperseded(db, tenantId, suggestion.id, clock.nowMs())
      out.push({ ...job, status: 'superseded', suggestion: getSuggestion(db, tenantId, suggestion.id) })
      continue
    }
    cancelAutoDraft(db, tenantId, job.conversationId)
    let autoBook: AutoBookOutcome | undefined
    if (suggestion.status !== 'failed') {
      try {
        let capability = deps.autoBook === true && (deps.autoBookTenants ?? []).includes(tenantId)
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
        autoBook = tryAiAutoBook(db, caller, clock, {
          conversationId: job.conversationId,
          suggestionId: suggestion.id,
          enabled: deps.autoBook === true,
          // Revalidado aqui, na execução do job (inclusive jobs já enfileirados).
          capability,
        })
        if (limitNote) autoBook = { ...autoBook, notes: [autoBook.notes, limitNote].filter(Boolean).join('\n') }
        if (autoBook.replyText || autoBook.notes) {
          const text = autoBook.replyText ?? suggestion.suggestedText
          const notes = [autoBook.notes, autoBook.replyText ? '' : suggestion.internalNotes]
            .filter(Boolean)
            .join('\n')
          db.run(
            `UPDATE ai_suggestions SET suggested_text = ?, internal_notes = ?, updated_at = ?
             WHERE tenant_id = ? AND id = ?`,
            text,
            notes,
            clock.nowMs(),
            tenantId,
            suggestion.id,
          )
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
    }
    out.push({ ...job, status: suggestion.status === 'failed' ? 'failed' : 'ready', suggestion, autoBook })
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
