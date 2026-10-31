/**
 * Pausa da IA e frase fixa quando a cliente pede uma pessoa ou sai do agendamento (DEC-083).
 * Não chama o modelo. Não marca horário. Uma mensagem já pausada não gera outra frase.
 */
import { detectInjectionSignals } from '../../ai'
import type { Clock } from '../../db/clock'
import { workerCaller } from '../envelopes'
import { ClinicError } from '../errors'
import { listResources } from '../config/resources'
import { listServices } from '../config/services'
import { setConversationAssignee } from '../inbox/conversations'
import { sendOutboundMessageOp } from '../inbox/operations'
import { insertOutboxEvent, type OutboxRow } from '../outbox'
import { openPendingCommunication } from '../proposals/pending-communication'
import type { ClinicDb } from '../store'

const AI_ASSIGNEE = 'system:ai-autodraft'

export const HUMAN_HANDOFF_TEXT = 'Vou pedir para a equipe continuar daqui.'
export const HUMAN_HANDOFF_BUTTON_ID = 'handoff:human'
export const HUMAN_HANDOFF_BUTTON_TITLE = 'Falar com a equipe'

export type AiReplyPauseReason = 'customer_requested' | 'off_purpose' | 'human_only'

const WANTS_HUMAN =
  /\b(falar com (a )?(equipe|equipa|algu[eé]m|uma pessoa|atendente)|quero (uma )?pessoa|atendimento humano)\b/i
const HEALTH = /\b(gr[aá]vid|\bd[oó]i\b|\bmedicamento|\bcontraindica)/i
const OFFENSE = /\b(idiota|porra|merda|vsf|fdp)\b/i
const OFF_TOPIC = /\b(piada|esquece a cl[ií]nica)\b/i
const PIX = /\b(chave\s+pix|j[aá] paguei|pix copia)\b/i
const RESCHEDULE = /\b(remarca|remarcar|remarque|cancela|cancelar|desmarca|desmarcar)\b/i
const THIRD_PARTY = /\b(minha m[aã]e|meu pai|minha filha|meu filho|n[aã]o [eé] para mim|para a minha)\b/i

export function readAiReplyPause(
  db: ClinicDb,
  tenantId: string,
  conversationId: string,
): { at: number; reason: string } | null {
  const row = db.get<{ at: number | null; reason: string | null }>(
    `SELECT ai_reply_paused_at AS at, ai_reply_pause_reason AS reason
     FROM conversations WHERE tenant_id = ? AND id = ?`,
    tenantId,
    conversationId,
  )
  if (!row?.at) return null
  return { at: row.at, reason: row.reason ?? 'off_purpose' }
}

export function resumeAiReply(
  db: ClinicDb,
  tenantId: string,
  conversationId: string,
  clock: Clock,
): OutboxRow[] {
  const now = clock.nowMs()
  db.run(
    `UPDATE conversations SET ai_reply_paused_at = NULL, ai_reply_pause_reason = NULL, updated_at = ?
     WHERE tenant_id = ? AND id = ?`,
    now,
    tenantId,
    conversationId,
  )
  return [pauseEvent(db, tenantId, conversationId, false, clock)]
}

function pauseEvent(
  db: ClinicDb,
  tenantId: string,
  conversationId: string,
  paused: boolean,
  clock: Clock,
): OutboxRow {
  return insertOutboxEvent(
    db,
    {
      tenantId,
      type: 'conversation.ai_pause',
      aggregateType: 'conversation',
      aggregateId: conversationId,
      idempotencyKey: `conversation.ai_pause:${conversationId}:${clock.nowMs()}:${paused ? 'on' : 'off'}`,
      payload: { conversationId, aiReplyPaused: paused },
    },
    clock,
  )
}

/** A frase automática não deixa a conversa «com a IA» enquanto a equipe deve assumir. */
function clearAiAssignee(db: ClinicDb, tenantId: string, conversationId: string, clock: Clock): void {
  const row = db.get<{ assignee: string | null }>(
    `SELECT assignee_clerk_user_id AS assignee FROM conversations WHERE tenant_id = ? AND id = ?`,
    tenantId,
    conversationId,
  )
  if (row?.assignee !== AI_ASSIGNEE) return
  setConversationAssignee(db, {
    tenantId,
    conversationId,
    assigneeClerkUserId: null,
    assigneeDisplayName: null,
    updatedAt: clock.nowMs(),
  })
}

function professionalOutsideService(db: ClinicDb, tenantId: string, text: string, clock: Clock): boolean {
  const pros = listResources(db, tenantId, clock).filter((r) => r.kind === 'professional' && r.name.trim().length >= 2)
  const mentioned = pros.filter((p) => new RegExp(`\\b${p.name.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(text))
  if (mentioned.length === 0) return false
  const services = listServices(db, tenantId).filter((s) => s.active)
  const named = services.filter((s) => text.toLowerCase().includes(s.name.trim().toLowerCase()))
  const pool = named.length > 0 ? named : services
  return mentioned.some((p) => !pool.some((s) => s.professionalIds.includes(p.id)))
}

/** Motivo da pausa, ou null se a mensagem ainda é um pedido de agendamento. */
export function handoffReason(
  db: ClinicDb,
  tenantId: string,
  text: string,
  clock: Clock,
): AiReplyPauseReason | null {
  const body = text.trim()
  if (!body) return null
  if (WANTS_HUMAN.test(body)) return 'customer_requested'
  if (
    detectInjectionSignals(body) ||
    HEALTH.test(body) ||
    OFFENSE.test(body) ||
    OFF_TOPIC.test(body) ||
    PIX.test(body)
  ) {
    return 'off_purpose'
  }
  if (RESCHEDULE.test(body) || THIRD_PARTY.test(body) || professionalOutsideService(db, tenantId, body, clock)) {
    return 'human_only'
  }
  return null
}

/**
 * Pausa e abre o alerta da equipe. A frase no WhatsApp sai uma vez enquanto o alerta
 * seguir aberto. Falha de WhatsApp não desfaz a pausa.
 */
export function notifyHumanHandoff(
  db: ClinicDb,
  tenantId: string,
  input: { conversationId: string; reason: AiReplyPauseReason; clientRequestId: string },
  clock: Clock,
): { already: boolean; sent: boolean; outbox: OutboxRow[] } {
  const existing = readAiReplyPause(db, tenantId, input.conversationId)
  if (existing) return { already: true, sent: false, outbox: [] }
  const now = clock.nowMs()
  db.run(
    `UPDATE conversations SET ai_reply_paused_at = ?, ai_reply_pause_reason = ?, updated_at = ?
     WHERE tenant_id = ? AND id = ?`,
    now,
    input.reason,
    now,
    tenantId,
    input.conversationId,
  )
  const conv = db.get<{ contact_id: string }>(
    `SELECT contact_id FROM conversations WHERE tenant_id = ? AND id = ?`,
    tenantId,
    input.conversationId,
  )
  if (!conv) {
    return { already: false, sent: false, outbox: [pauseEvent(db, tenantId, input.conversationId, true, clock)] }
  }
  const open = db.get<{ id: string; started_at: number }>(
    `SELECT id, started_at FROM pending_communications
     WHERE tenant_id = ? AND conversation_id = ? AND kind = 'alter_awaiting_team' AND status != 'resolved'
     LIMIT 1`,
    tenantId,
    input.conversationId,
  )
  if (!open) {
    const detail =
      input.reason === 'customer_requested'
        ? 'A cliente pediu atendimento humano.'
        : input.reason === 'human_only'
          ? 'Pedido que a IA não cumpre (remarcar, cancelar, terceiro ou profissional fora do serviço). A equipe continua.'
          : 'A mensagem saiu do agendamento. A IA ficou pausada.'
    openPendingCommunication(
      db,
      {
        tenantId,
        conversationId: input.conversationId,
        contactId: conv.contact_id,
        proposalId: null,
        kind: 'alter_awaiting_team',
        detailText: detail,
      },
      clock,
    )
  } else {
    db.run(
      `UPDATE pending_communications
       SET status = 'alerted', alerted_at = COALESCE(alerted_at, ?), updated_at = ?
       WHERE tenant_id = ? AND id = ?`,
      now,
      now,
      tenantId,
      open.id,
    )
  }
  const alreadySaid = open
    ? db.get<{ id: string }>(
        `SELECT id FROM messages
         WHERE tenant_id = ? AND conversation_id = ? AND direction = 'outbound' AND body = ?
           AND created_at >= ?
         LIMIT 1`,
        tenantId,
        input.conversationId,
        HUMAN_HANDOFF_TEXT,
        open.started_at,
      )
    : undefined
  const outbox: OutboxRow[] = []
  let sent = false
  if (alreadySaid) {
    clearAiAssignee(db, tenantId, input.conversationId, clock)
    outbox.push(pauseEvent(db, tenantId, input.conversationId, true, clock))
    return { already: false, sent: false, outbox }
  }
  try {
    const result = sendOutboundMessageOp(
      db,
      workerCaller(tenantId, AI_ASSIGNEE),
      {
        conversationId: input.conversationId,
        body: HUMAN_HANDOFF_TEXT,
        clientRequestId: input.clientRequestId,
        authorClerkUserId: AI_ASSIGNEE,
        authorDisplayName: 'IA',
      },
      clock,
    )
    sent = true
    outbox.push(...result.outbox)
  } catch (err) {
    if (!(err instanceof ClinicError)) throw err
  }
  clearAiAssignee(db, tenantId, input.conversationId, clock)
  outbox.push(pauseEvent(db, tenantId, input.conversationId, true, clock))
  return { already: false, sent, outbox }
}
