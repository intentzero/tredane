/**
 * Hook pós-ingest / outbox para Web Push (#42).
 * DEC-173: agendamento confirmado + handoff (DEC-156) + inbound só em fio
 * assumido/handoff (atendente activo). Sem push genérico de toda mensagem.
 * Best-effort: falha não reentrega o webhook WhatsApp.
 */
import type { Clock } from '../db/clock'
import type { AdminDb } from '../db/admin/store'
import { fromD1 } from '../db/admin/async-store'
import type { WorkerBindings } from '../worker/bindings'
import { notifyNewConversation, notifyNewConversationAsync } from './notify'
import { resolveVapidConfig } from './vapid'
import type { PushPayloadKind } from './types'

/**
 * DEC-173 — inbound: só `new_message` quando a conversa está com atendente
 * activo (Assumir) ou em handoff (IA pausada). `new_conversation` não notifica.
 */
export async function maybeNotifyNewConversationPush(input: {
  env: WorkerBindings
  clock: Clock
  syncAdminDb?: AdminDb | null
  tenantId: string
  conversationId: string
  createdConversation: boolean
  /** Mensagem nova (não duplicada por wamid) numa conversa já existente. */
  newMessage?: boolean
  /**
   * True quando há responsável humano ou handoff (IA pausada).
   * Sem isto, inbound da IA automática não gera push.
   */
  humanAttended?: boolean
  /** Rótulo curto do contacto (agenda) — opcional no corpo. */
  contactLabel?: string | null
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
  if (input.createdConversation && !input.newMessage) {
    input.log?.({
      level: 'info',
      event: 'queue.push_inbound_skipped',
      detail: {
        receiptId: input.receiptId,
        tenantId: input.tenantId,
        conversationId: input.conversationId,
        skippedKind: 'new_conversation',
        reason: 'dec_173_no_generic_new_conversation',
      },
    })
    return
  }
  if (!input.newMessage) return
  if (!input.humanAttended) {
    input.log?.({
      level: 'info',
      event: 'queue.push_inbound_skipped',
      detail: {
        receiptId: input.receiptId,
        tenantId: input.tenantId,
        conversationId: input.conversationId,
        skippedKind: 'new_message',
        reason: 'dec_173_not_human_attended',
      },
    })
    return
  }
  await deliverPushKind({
    ...input,
    kind: 'new_message',
    contactLabel: input.contactLabel,
    logEvent: 'queue.push_new_message',
    failEvent: 'queue.push_new_message_failed',
  })
}

/** DEC-156 — push «Precisa de alguém» / reforço aos 5 min (best-effort). */
export async function maybeNotifyNeedsPersonPush(input: {
  env: WorkerBindings
  clock: Clock
  syncAdminDb?: AdminDb | null
  tenantId: string
  conversationId: string
  escalate?: boolean
  /** Nome de apresentação do contacto — fallback «Cliente» no builder. */
  contactLabel?: string | null
  /** `ai_reply_pause_reason` — rótulo curto opcional no corpo. */
  handoffReason?: string | null
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
    contactLabel: input.contactLabel,
    handoffReason: input.handoffReason,
    logEvent: input.escalate
      ? 'queue.push_needs_person_escalate'
      : 'queue.push_needs_person',
    failEvent: 'queue.push_needs_person_failed',
  })
}

/** DEC-173 — push quando um compromisso fica confirmado (best-effort). */
export async function maybeNotifyAppointmentConfirmedPush(input: {
  env: WorkerBindings
  clock: Clock
  syncAdminDb?: AdminDb | null
  tenantId: string
  appointmentId: string
  conversationId?: string | null
  contactLabel?: string | null
  serviceName?: string | null
  badgeCount?: number
  suppressUserIds?: readonly string[]
  log?: (entry: {
    level: 'info' | 'warn' | 'error'
    event: string
    detail: Record<string, unknown>
  }) => void
}): Promise<void> {
  if (!input.appointmentId) return
  await deliverPushKind({
    ...input,
    conversationId: input.conversationId?.trim() || input.appointmentId,
    kind: 'appointment_confirmed',
    appointmentId: input.appointmentId,
    contactLabel: input.contactLabel,
    serviceName: input.serviceName,
    logEvent: 'queue.push_appointment_confirmed',
    failEvent: 'queue.push_appointment_confirmed_failed',
  })
}

async function deliverPushKind(input: {
  env: WorkerBindings
  clock: Clock
  syncAdminDb?: AdminDb | null
  tenantId: string
  conversationId: string
  kind: PushPayloadKind
  appointmentId?: string
  contactLabel?: string | null
  serviceName?: string | null
  handoffReason?: string | null
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
    const notifyInput = {
      tenantId: input.tenantId,
      conversationId: input.conversationId,
      kind: input.kind,
      appointmentId: input.appointmentId,
      contactLabel: input.contactLabel,
      serviceName: input.serviceName,
      handoffReason: input.handoffReason,
      badgeCount: input.badgeCount,
      suppressUserIds: input.suppressUserIds,
    }
    if (input.syncAdminDb) {
      await notifyNewConversation(
        { db: input.syncAdminDb, clock: input.clock, vapid },
        notifyInput,
      )
    } else {
      await notifyNewConversationAsync(
        { db: fromD1(input.env.DB), clock: input.clock, vapid },
        notifyInput,
      )
    }
    input.log?.({
      level: 'info',
      event: input.logEvent,
      detail: {
        receiptId: input.receiptId,
        tenantId: input.tenantId,
        conversationId: input.conversationId,
        appointmentId: input.appointmentId,
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
