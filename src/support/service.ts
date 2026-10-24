/**
 * Orquestração pedidos de suporte (#26): D1 + e-mail informativo + fan-out owners.
 * Aprovação ≠ ativação — sessão/handoff ficam na #27.
 */
import type { Clock } from '../db/clock'
import {
  approveSupportRequest,
  createSupportAccessRequest,
  expireSupportRequestIfNeeded,
  getSupportRequest,
  getTenant,
  listOwnersForTenant,
  listSupportRequestsForTenant,
  rejectSupportRequest,
  type SupportRequestRow,
  ConflictError,
  NotFoundError,
} from '../db/admin'
import type { AdminDb } from '../db/admin/store'
import {
  deliverSupportAccessRequestEmail,
  type EmailTransport,
} from '../email'
import type { VerifiedEmailReader } from '../auth/verified-email'
import type { ClinicEventPublisher } from '../realtime'

export type SupportServices = {
  db: AdminDb
  clock: Clock
  email: EmailTransport
  appBaseUrl: string
  verifiedEmails: VerifiedEmailReader
  events: ClinicEventPublisher
}

export type CreateSupportRequestResult = {
  request: SupportRequestRow
  emailsQueued: number
  emailsSent: number
  realtimeNotified: boolean
}

async function notifyOwnersOfRequest(
  services: SupportServices,
  request: SupportRequestRow,
): Promise<{ emailsQueued: number; emailsSent: number; realtimeNotified: boolean }> {
  const tenant = getTenant(services.db, request.tenantId)
  if (!tenant) {
    throw new NotFoundError('tenant_not_found', 'Tenant inexistente')
  }

  const owners = listOwnersForTenant(services.db, request.tenantId)
  let emailsQueued = 0
  let emailsSent = 0

  for (const owner of owners) {
    const snap = await services.verifiedEmails.readPrimaryVerifiedEmail(owner.clerkUserId)
    if (!snap.ok) continue
    try {
      const delivery = await deliverSupportAccessRequestEmail(
        services.db,
        services.clock,
        services.email,
        {
          supportRequestId: request.id,
          toEmail: snap.email,
          tenantId: request.tenantId,
          tenantName: tenant.name,
          actorClerkUserId: request.actorClerkUserId,
          subjectClerkUserId: request.subjectClerkUserId,
          reason: request.reason,
          scope: request.scope,
          expiresAt: request.expiresAt,
          appBaseUrl: services.appBaseUrl,
          requestedByClerkUserId: request.actorClerkUserId,
          sendNow: true,
        },
      )
      emailsQueued += 1
      if (delivery.sent) emailsSent += 1
    } catch {
      // Falha de e-mail não impede o pedido (DEC-030).
    }
  }

  const published = await services.events.publishTenantEvent({
    tenantId: request.tenantId,
    type: 'support.request.created',
    entityType: 'support_access_request',
    entityId: request.id,
    audience: 'owners',
    eventId: `sar:created:${request.id}`,
    payload: {
      requestId: request.id,
      actorClerkUserId: request.actorClerkUserId,
      subjectClerkUserId: request.subjectClerkUserId,
      reason: request.reason,
      scope: request.scope,
      status: request.status,
      createdAt: request.createdAt,
      expiresAt: request.expiresAt,
    },
  })

  return {
    emailsQueued,
    emailsSent,
    realtimeNotified: published.ok,
  }
}

async function notifyOwnersOfDecision(
  services: SupportServices,
  request: SupportRequestRow,
): Promise<boolean> {
  const published = await services.events.publishTenantEvent({
    tenantId: request.tenantId,
    type: 'support.request.decided',
    entityType: 'support_access_request',
    entityId: request.id,
    audience: 'owners',
    eventId: `sar:decided:${request.id}:${request.status}:${request.decidedAt ?? 0}`,
    payload: {
      requestId: request.id,
      status: request.status,
      decidedByOwnerClerkUserId: request.decidedByOwnerClerkUserId,
      decidedAt: request.decidedAt,
      actorClerkUserId: request.actorClerkUserId,
      subjectClerkUserId: request.subjectClerkUserId,
      reason: request.reason,
      scope: request.scope,
      expiresAt: request.expiresAt,
    },
  })
  return published.ok
}

export async function createPendingSupportRequest(
  services: SupportServices,
  input: {
    tenantId: string
    actorClerkUserId: string
    subjectClerkUserId: string
    reason: string
    scope: string
  },
): Promise<CreateSupportRequestResult> {
  const request = createSupportAccessRequest(services.db, services.clock, input)
  const notify = await notifyOwnersOfRequest(services, request)
  return { request, ...notify }
}

export function loadSupportRequestsForOwner(
  services: SupportServices,
  tenantId: string,
  opts: { status?: SupportRequestRow['status'] } = {},
): SupportRequestRow[] {
  const rows = listSupportRequestsForTenant(services.db, tenantId, {
    status: opts.status,
    limit: 100,
  })
  // Expira pending vencidos na leitura (sem job).
  return rows.map((row) => {
    if (row.status !== 'pending') return row
    return expireSupportRequestIfNeeded(services.db, services.clock, row.id)
  })
}

export function loadSupportRequestForOwner(
  services: SupportServices,
  tenantId: string,
  requestId: string,
): SupportRequestRow {
  const row = getSupportRequest(services.db, requestId)
  if (!row || row.tenantId !== tenantId) {
    throw new NotFoundError('support_request_not_found', 'Pedido inexistente')
  }
  if (row.status === 'pending') {
    return expireSupportRequestIfNeeded(services.db, services.clock, row.id)
  }
  return row
}

export async function decideSupportRequest(
  services: SupportServices,
  input: {
    tenantId: string
    requestId: string
    ownerClerkUserId: string
    decision: 'approve' | 'reject'
  },
): Promise<{ request: SupportRequestRow; realtimeNotified: boolean }> {
  const preview = getSupportRequest(services.db, input.requestId)
  if (!preview || preview.tenantId !== input.tenantId) {
    throw new NotFoundError('support_request_not_found', 'Pedido inexistente')
  }

  let request: SupportRequestRow
  if (input.decision === 'approve') {
    request = approveSupportRequest(services.db, services.clock, {
      requestId: input.requestId,
      ownerClerkUserId: input.ownerClerkUserId,
    })
  } else if (input.decision === 'reject') {
    request = rejectSupportRequest(services.db, services.clock, {
      requestId: input.requestId,
      ownerClerkUserId: input.ownerClerkUserId,
    })
  } else {
    throw new ConflictError('invalid_decision', 'Decisão inválida')
  }

  // Garantia AC: aprovação não cria sessão/handoff.
  const sessions = services.db.get<{ n: number }>(
    `SELECT COUNT(*) AS n FROM support_sessions WHERE support_access_request_id = ?`,
    request.id,
  )
  if ((sessions?.n ?? 0) > 0) {
    throw new ConflictError('support_session_unexpected', 'Sessão não deve existir após decisão #26')
  }

  const realtimeNotified = await notifyOwnersOfDecision(services, request)
  return { request, realtimeNotified }
}
