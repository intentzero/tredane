/**
 * Janela de 24 h WhatsApp (DEC-040 / Q-UX-06).
 * Aberta se a última mensagem inbound do contacto for < 24 h.
 */
import { WHATSAPP_MESSAGING_WINDOW_MS } from '../constants'
import { assertClinicSchemaReady } from '../migrations'
import type { ClinicDb } from '../store'

export type MessagingWindow = {
  open: boolean
  lastInboundAt: number | null
  closesAt: number | null
  remainingMs: number | null
}

export function lastInboundAtForConversation(
  db: ClinicDb,
  tenantId: string,
  conversationId: string,
): number | null {
  assertClinicSchemaReady(db)
  const row = db.get<{ created_at: number }>(
    `SELECT created_at FROM messages
     WHERE tenant_id = ? AND conversation_id = ? AND direction = 'inbound'
     ORDER BY created_at DESC
     LIMIT 1`,
    tenantId,
    conversationId,
  )
  return row?.created_at ?? null
}

export function computeMessagingWindow(
  lastInboundAt: number | null,
  nowMs: number,
  windowMs = WHATSAPP_MESSAGING_WINDOW_MS,
): MessagingWindow {
  if (lastInboundAt == null) {
    return { open: false, lastInboundAt: null, closesAt: null, remainingMs: null }
  }
  const closesAt = lastInboundAt + windowMs
  const remainingMs = closesAt - nowMs
  return {
    open: remainingMs > 0,
    lastInboundAt,
    closesAt,
    remainingMs: remainingMs > 0 ? remainingMs : 0,
  }
}

export function messagingWindowForConversation(
  db: ClinicDb,
  tenantId: string,
  conversationId: string,
  nowMs: number,
): MessagingWindow {
  const lastInboundAt = lastInboundAtForConversation(db, tenantId, conversationId)
  return computeMessagingWindow(lastInboundAt, nowMs)
}
