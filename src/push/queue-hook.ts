/**
 * Hook pós-ingest para push de nova conversa (#42).
 * Best-effort: falha não reentrega o webhook WhatsApp.
 */
import type { Clock } from '../db/clock'
import type { AdminDb } from '../db/admin/store'
import { fromD1 } from '../db/admin/async-store'
import type { WorkerBindings } from '../worker/bindings'
import { notifyNewConversation, notifyNewConversationAsync } from './notify'
import { resolveVapidConfig } from './vapid'

export async function maybeNotifyNewConversationPush(input: {
  env: WorkerBindings
  clock: Clock
  syncAdminDb?: AdminDb | null
  tenantId: string
  conversationId: string
  createdConversation: boolean
  /** Mensagem nova (não duplicada por wamid) numa conversa já existente. */
  newMessage?: boolean
  log?: (entry: {
    level: 'info' | 'warn' | 'error'
    event: string
    detail: Record<string, unknown>
  }) => void
  receiptId?: string
}): Promise<void> {
  if (!input.conversationId) return
  const kind = input.createdConversation
    ? 'new_conversation'
    : input.newMessage
      ? 'new_message'
      : null
  if (!kind) return
  try {
    const vapid = resolveVapidConfig(input.env)
    if (input.syncAdminDb) {
      await notifyNewConversation(
        { db: input.syncAdminDb, clock: input.clock, vapid },
        { tenantId: input.tenantId, conversationId: input.conversationId, kind },
      )
    } else {
      await notifyNewConversationAsync(
        { db: fromD1(input.env.DB), clock: input.clock, vapid },
        { tenantId: input.tenantId, conversationId: input.conversationId, kind },
      )
    }
    input.log?.({
      level: 'info',
      event: kind === 'new_message' ? 'queue.push_new_message' : 'queue.push_new_conversation',
      detail: {
        receiptId: input.receiptId,
        tenantId: input.tenantId,
        conversationId: input.conversationId,
      },
    })
  } catch (pushErr) {
    input.log?.({
      level: 'warn',
      event: 'queue.push_new_conversation_failed',
      detail: {
        receiptId: input.receiptId,
        tenantId: input.tenantId,
        errorCode:
          pushErr instanceof Error ? pushErr.message.slice(0, 80) : 'push_failed',
      },
    })
  }
}
