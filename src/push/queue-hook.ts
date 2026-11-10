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
  badgeCount?: number
  suppressUserIds?: readonly string[]
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
  await deliverPushKind({
    ...input,
    kind,
    logEvent:
      kind === 'new_message' ? 'queue.push_new_message' : 'queue.push_new_conversation',
    failEvent: 'queue.push_new_conversation_failed',
  })
}

/** DEC-155 — push «Precisa de alguém» / reforço aos 5 min (best-effort). */
export async function maybeNotifyNeedsPersonPush(input: {
  env: WorkerBindings
  clock: Clock
  syncAdminDb?: AdminDb | null
  tenantId: string
  conversationId: string
  escalate?: boolean
  badgeCount?: number
  suppressUserIds?: readonly string[]
  log?: (entry: {
    level: 'info' | 'warn' | 'error'
    event: string
    detail: Record<string, unknown>
  }) => void
}): Promise<void> {
  if (!input.conversationId) return
  const kind = input.escalate ? 'needs_person_escalate' : 'needs_person'
  await deliverPushKind({
    ...input,
    kind,
    logEvent: input.escalate
      ? 'queue.push_needs_person_escalate'
      : 'queue.push_needs_person',
    failEvent: 'queue.push_needs_person_failed',
  })
}

async function deliverPushKind(input: {
  env: WorkerBindings
  clock: Clock
  syncAdminDb?: AdminDb | null
  tenantId: string
  conversationId: string
  kind: 'new_conversation' | 'new_message' | 'needs_person' | 'needs_person_escalate'
  badgeCount?: number
  suppressUserIds?: readonly string[]
  logEvent: string
  failEvent: string
  log?: (entry: {
    level: 'info' | 'warn' | 'error'
    event: string
    detail: Record<string, unknown>
  }) => void
  receiptId?: string
}): Promise<void> {
  try {
    const vapid = resolveVapidConfig(input.env)
    if (input.syncAdminDb) {
      await notifyNewConversation(
        { db: input.syncAdminDb, clock: input.clock, vapid },
        {
          tenantId: input.tenantId,
          conversationId: input.conversationId,
          kind: input.kind,
          badgeCount: input.badgeCount,
          suppressUserIds: input.suppressUserIds,
        },
      )
    } else {
      await notifyNewConversationAsync(
        { db: fromD1(input.env.DB), clock: input.clock, vapid },
        {
          tenantId: input.tenantId,
          conversationId: input.conversationId,
          kind: input.kind,
          badgeCount: input.badgeCount,
          suppressUserIds: input.suppressUserIds,
        },
      )
    }
    input.log?.({
      level: 'info',
      event: input.logEvent,
      detail: {
        receiptId: input.receiptId,
        tenantId: input.tenantId,
        conversationId: input.conversationId,
      },
    })
  } catch (pushErr) {
    input.log?.({
      level: 'warn',
      event: input.failEvent,
      detail: {
        receiptId: input.receiptId,
        tenantId: input.tenantId,
        errorCode:
          pushErr instanceof Error ? pushErr.message.slice(0, 80) : 'push_failed',
      },
    })
  }
}
