/**
 * Frase de fallback quando o modelo falha e não há caminho determinístico (#404, CF-14, DEC-107).
 * Não pausa a IA. Abre alerta à equipe. Idempotente por messageId.
 */
import type { Clock } from '../../db/clock'
import { workerCaller } from '../envelopes'
import { ClinicError } from '../errors'
import { sendOutboundMessageOp } from '../inbox/operations'
import type { OutboxRow } from '../outbox'
import { openPendingCommunication } from '../proposals/pending-communication'
import type { ClinicDb } from '../store'
import {
  HUMAN_HANDOFF_BUTTON_ID,
  HUMAN_HANDOFF_BUTTON_TITLE,
} from './human-handoff'

const AI_ASSIGNEE = 'system:ai-autodraft'

/** DEC-107 — texto exacto; só muda com revisão da DEC. */
export const MODEL_FALLBACK_TEXT =
  'Não consegui entender bem. Pode me dizer de outro jeito, ou prefere falar com a equipe?'

export function modelFallbackClientRequestId(messageId: string): string {
  return `ai-fallback:${messageId}`
}

/**
 * Envia a frase DEC-107 com o botão da equipe e abre `alter_awaiting_team`
 * sem pausar a IA. Reenvio do mesmo `messageId` não duplica a saída.
 */
export function notifyModelFallback(
  db: ClinicDb,
  tenantId: string,
  input: { conversationId: string; messageId: string },
  clock: Clock,
): { sent: boolean; already: boolean; outbox: OutboxRow[] } {
  const clientRequestId = modelFallbackClientRequestId(input.messageId)
  const existingOutbound = db.get<{ id: string }>(
    `SELECT id FROM outbound_messages
     WHERE tenant_id = ? AND client_request_id = ?
     LIMIT 1`,
    tenantId,
    clientRequestId,
  )
  if (existingOutbound) {
    return { sent: false, already: true, outbox: [] }
  }

  const conv = db.get<{ contact_id: string }>(
    `SELECT contact_id FROM conversations WHERE tenant_id = ? AND id = ?`,
    tenantId,
    input.conversationId,
  )
  if (!conv) return { sent: false, already: false, outbox: [] }

  const open = db.get<{ id: string }>(
    `SELECT id FROM pending_communications
     WHERE tenant_id = ? AND conversation_id = ? AND kind = 'alter_awaiting_team' AND status != 'resolved'
     LIMIT 1`,
    tenantId,
    input.conversationId,
  )
  const now = clock.nowMs()
  if (!open) {
    const row = openPendingCommunication(
      db,
      {
        tenantId,
        conversationId: input.conversationId,
        contactId: conv.contact_id,
        proposalId: null,
        kind: 'alter_awaiting_team',
        detailText: 'A IA não conseguiu responder. A conversa continua aberta à IA.',
        messageId: input.messageId,
      },
      clock,
    )
    db.run(
      `UPDATE pending_communications
       SET status = 'alerted', alerted_at = COALESCE(alerted_at, ?), updated_at = ?
       WHERE tenant_id = ? AND id = ?`,
      now,
      now,
      tenantId,
      row.id,
    )
  } else {
    db.run(
      `UPDATE pending_communications
       SET status = 'alerted', alerted_at = COALESCE(alerted_at, ?), updated_at = ?,
           message_id = COALESCE(message_id, ?)
       WHERE tenant_id = ? AND id = ?`,
      now,
      now,
      input.messageId,
      tenantId,
      open.id,
    )
  }

  const outbox: OutboxRow[] = []
  let sent = false
  try {
    const result = sendOutboundMessageOp(
      db,
      workerCaller(tenantId, AI_ASSIGNEE),
      {
        conversationId: input.conversationId,
        body: MODEL_FALLBACK_TEXT,
        interactive: {
          buttons: [{ id: HUMAN_HANDOFF_BUTTON_ID, title: HUMAN_HANDOFF_BUTTON_TITLE }],
        },
        clientRequestId,
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
  return { sent, already: false, outbox }
}
