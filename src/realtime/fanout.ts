import type { Clock } from '../db/clock'
import type { ClinicDb } from '../clinic/store'
import type { AccessAuthority } from './authority'
import { denyUserAccess, localFenceBlocks } from './fence'
import type { RealtimeEventRow } from './events'
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
  }
  const message = encodeServerMessage(toEventMessage(event))

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

    const decision = await authority.checkMembership(
      attachment.tenantId,
      attachment.clerkUserId,
    )

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
