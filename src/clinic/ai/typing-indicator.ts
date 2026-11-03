/**
 * Indicador nativo de «a escrever…» da Cloud API (DEC-136).
 * Só dispara quando o bot vai responder; falha na Meta não bloqueia o envio.
 */
import type { Clock } from '../../db/clock'
import { insertOutboxEvent, type OutboxRow } from '../outbox'
import type { ClinicDb } from '../store'

export const WHATSAPP_TYPING_INDICATOR_TYPE = 'whatsapp.typing_indicator'

/** Extrai o wamid do `external_message_id` inbound (`wa:msg:<wamid>`). */
export function wamidFromExternalMessageId(externalMessageId: string | null | undefined): string {
  const ext = (externalMessageId ?? '').trim()
  if (!ext) return ''
  return ext.startsWith('wa:msg:') ? ext.slice('wa:msg:'.length) : ext
}

/**
 * Agenda o indicador de digitação para a mensagem inbound que o bot vai responder.
 * Idempotente por wamid. Devolve null se não houver wamid (mensagem sintética / sem Meta).
 */
export function enqueueTypingIndicator(
  db: ClinicDb,
  tenantId: string,
  input: { conversationId: string; messageId: string },
  clock: Clock,
): OutboxRow | null {
  const row = db.get<{ external_message_id: string | null; direction: string }>(
    `SELECT external_message_id, direction FROM messages
     WHERE tenant_id = ? AND id = ?`,
    tenantId,
    input.messageId,
  )
  if (!row || row.direction !== 'inbound') return null
  const wamid = wamidFromExternalMessageId(row.external_message_id)
  if (!wamid) return null
  return insertOutboxEvent(
    db,
    {
      tenantId,
      type: WHATSAPP_TYPING_INDICATOR_TYPE,
      aggregateType: 'conversation',
      aggregateId: input.conversationId,
      idempotencyKey: `whatsapp.typing_indicator:${wamid}`,
      payload: {
        conversationId: input.conversationId,
        messageId: input.messageId,
        providerMessageId: wamid,
      },
    },
    clock,
  )
}

/** Resolve o wamid da última inbound da conversa (toques em lista/botão). */
export function enqueueTypingIndicatorForLatestInbound(
  db: ClinicDb,
  tenantId: string,
  conversationId: string,
  clock: Clock,
): OutboxRow | null {
  const row = db.get<{ id: string }>(
    `SELECT id FROM messages
     WHERE tenant_id = ? AND conversation_id = ? AND direction = 'inbound'
     ORDER BY created_at DESC, id DESC
     LIMIT 1`,
    tenantId,
    conversationId,
  )
  if (!row) return null
  return enqueueTypingIndicator(db, tenantId, { conversationId, messageId: row.id }, clock)
}
