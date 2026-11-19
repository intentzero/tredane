import type { Clock } from '../db/clock'
import type { ClinicDb } from '../clinic/store'
import type { AccessAuthority } from './authority'
import { denyUserAccess, localFenceBlocks } from './fence'
import { eventAudience, isEventVisibleToRole, type RealtimeEventRow } from './events'
import {
  encodeServerMessage,
  type AccessRevokeReason,
  type EventMessage,
  type SocketAttachment,
} from './protocol'

export type DeliverySocket = {
  send(data: string): void
  close(code?: number, reason?: string): void
  deserializeAttachment(): SocketAttachment | null
}

export type DeliveryResult = {
  delivered: string[]
  revoked: string[]
  skippedUnavailable: string[]
  /** Soma dos `authority.checkMembership` (D1) nesta entrega. */
  membershipCheckMs?: number
}

function toEventMessage(row: RealtimeEventRow): EventMessage {
  return {
    v: 1,
    type: 'event',
    seq: row.seq,
    eventId: row.eventId,
    eventType: row.type,
    entity: { type: row.entityType, id: row.entityId },
    occurredAt: row.occurredAt,
    payload: row.payload,
  }
}

function revokeReasonFrom(raw: string): AccessRevokeReason {
  if (
    raw === 'membership_revoked' ||
    raw === 'tenant_not_active' ||
    raw === 'not_member' ||
    raw === 'support_revoked' ||
    raw === 'session_expired' ||
    raw === 'authority_unavailable'
  ) {
    return raw
  }
  return 'membership_revoked'
}

function closeRevoked(
  ws: DeliverySocket,
  attachment: SocketAttachment,
  reason: AccessRevokeReason,
): void {
  try {
    ws.send(
      encodeServerMessage({
        v: 1,
        type: 'access_revoked',
        tenantId: attachment.tenantId,
        reason,
      }),
    )
  } catch {
    /* ignore */
  }
  try {
    ws.close(4001, reason)
  } catch {
    /* ignore */
  }
}

/**
 * Eventos que uma ligação de suporte recebe (ADR-0017 §4). Só **sinais** de conversa, de audiência geral e
 * **sem payload**: o ecrã refaz a leitura pelas rotas HTTP, que já filtram e mascaram telefones.
 */
export function isSupportSignalEvent(event: Pick<RealtimeEventRow, 'type' | 'payload'>): boolean {
  if (event.type === 'conversation.ai_draft') return false
  if (!/^(message|conversation)\./.test(event.type)) return false
  return eventAudience(event.payload) === 'all'
}

/**
 * Entrega clínica só após persistência + revalidação.
 * Fail-closed: authority unavailable → não envia payload (ADR-0009).
 */
export async function deliverEventToSockets(
  db: ClinicDb,
  sockets: readonly DeliverySocket[],
  event: RealtimeEventRow,
  authority: AccessAuthority,
  clock: Clock,
): Promise<DeliveryResult> {
  const result: DeliveryResult = {
    delivered: [],
    revoked: [],
    skippedUnavailable: [],
    membershipCheckMs: 0,
  }
  const message = encodeServerMessage(toEventMessage(event))
  const supportSignal = encodeServerMessage(toEventMessage({ ...event, payload: {} }))

  for (const ws of sockets) {
    const attachment = ws.deserializeAttachment()
    if (!attachment || attachment.tenantId !== event.tenantId) {
      continue
    }

    const local = localFenceBlocks(db, attachment.clerkUserId)
    if (local.blocked) {
      closeRevoked(ws, attachment, revokeReasonFrom(local.reason))
      result.revoked.push(attachment.connectionId)
      continue
    }

    if (attachment.supportSessionId) {
      // Ligação de suporte: a sessão tem de continuar ativa (fail-closed) e só recebe sinais sem payload.
      const sess = authority.checkSupportSession
        ? await authority.checkSupportSession(attachment.tenantId, attachment.supportSessionId, clock.nowMs())
        : ({ status: 'unavailable' } as const)
      if (sess.status === 'unavailable') {
        result.skippedUnavailable.push(attachment.connectionId)
        continue
      }
      if (sess.status === 'deny') {
        closeRevoked(ws, attachment, sess.reason)
        result.revoked.push(attachment.connectionId)
        continue
      }
    }

    const membershipStarted = Date.now()
    const decision = await authority.checkMembership(
      attachment.tenantId,
      attachment.clerkUserId,
    )
    result.membershipCheckMs = (result.membershipCheckMs ?? 0) + (Date.now() - membershipStarted)

    if (decision.status === 'unavailable') {
      // Fail closed: não entregar conteúdo clínico com autoridade incerta.
      result.skippedUnavailable.push(attachment.connectionId)
      continue
    }

    if (decision.status === 'deny') {
      denyUserAccess(db, clock, {
        clerkUserId: attachment.clerkUserId,
        reason: decision.reason,
        source: 'authority_recheck',
      })
      closeRevoked(ws, attachment, decision.reason)
      result.revoked.push(attachment.connectionId)
      continue
    }

    if (attachment.supportSessionId) {
      if (!isSupportSignalEvent(event)) continue
      try {
        ws.send(supportSignal)
        result.delivered.push(attachment.connectionId)
      } catch {
        /* socket morto */
      }
      continue
    }

    // DEC-030/036: filtrar por audiência (owners / subject / all).
    if (
      !isEventVisibleToRole(event.payload, attachment.role, attachment.clerkUserId, {
        type: event.type,
        entityType: event.entityType,
      })
    ) {
      continue
    }

    try {
      ws.send(message)
      result.delivered.push(attachment.connectionId)
    } catch {
      // Socket morto — ignorar.
    }
  }

  return result
}

/**
 * Fecha sockets de um utilizador sem payload clínico (sinal de revogação).
 */
export function closeUserSockets(
  sockets: readonly DeliverySocket[],
  tenantId: string,
  clerkUserId: string,
  reason: AccessRevokeReason,
): string[] {
  const closed: string[] = []
  for (const ws of sockets) {
    const attachment = ws.deserializeAttachment()
    if (!attachment) continue
    if (attachment.tenantId !== tenantId) continue
    if (attachment.clerkUserId !== clerkUserId) continue
    closeRevoked(ws, attachment, reason)
    closed.push(attachment.connectionId)
  }
  return closed
}

/** Fecha só as ligações de **uma** sessão de suporte; o subject real, ligado ao mesmo tempo, não é tocado. */
export function closeSupportSessionSockets(
  sockets: readonly DeliverySocket[],
  tenantId: string,
  supportSessionId: string,
  reason: AccessRevokeReason,
): string[] {
  const closed: string[] = []
  for (const ws of sockets) {
    const attachment = ws.deserializeAttachment()
    if (!attachment) continue
    if (attachment.tenantId !== tenantId) continue
    if (attachment.supportSessionId !== supportSessionId) continue
    closeRevoked(ws, attachment, reason)
    closed.push(attachment.connectionId)
  }
  return closed
}

export function closeAllSockets(
  sockets: readonly DeliverySocket[],
  tenantId: string,
  reason: AccessRevokeReason,
): string[] {
  const closed: string[] = []
  for (const ws of sockets) {
    const attachment = ws.deserializeAttachment()
    if (!attachment) continue
    if (attachment.tenantId !== tenantId) continue
    closeRevoked(ws, attachment, reason)
    closed.push(attachment.connectionId)
  }
  return closed
}
