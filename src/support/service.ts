/**
 * Orquestração pedidos (#26) + sessão/handoff/TTL (#27).
 */
import type { Clock } from '../db/clock'
import {
  activateSupportSession,
  approveSupportRequest,
  consumeSupportHandoff,
  createSupportAccessRequest,
  decideSupportTermination,
  expireSupportRequestIfNeeded,
  expireSupportSessionIfNeeded,
  getActiveSupportSessionForSubject,
  getSupportRequest,
  getSupportSession,
  getSupportTerminationRequest,
  getTenant,
  listActiveSupportSessionsForTenant,
  listOwnersForTenant,
  listSupportRequestsForTenant,
  rejectSupportRequest,
  requestSupportTermination,
  resolveSupportSessionByToken,
  revokeSupportSession,
  type ActivatedSupport,
  type ConsumedHandoff,
  type SupportRequestRow,
  type SupportSessionRow,
  type SupportTerminationRow,
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from '../db/admin'
import type { AdminDb } from '../db/admin/store'
import {
  deliverSupportAccessRequestEmail,
  deliverSupportSessionStartedEmail,
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

async function notifySessionLifecycle(
  services: SupportServices,
  session: SupportSessionRow,
  type: 'support.session.started' | 'support.session.ended',
  extra: Record<string, unknown> = {},
): Promise<boolean> {
  const published = await services.events.publishTenantEvent({
    tenantId: session.tenantId,
    type,
    entityType: 'support_session',
    entityId: session.id,
    audience: 'owners_and_subject',
    eventId: `${type}:${session.id}:${session.status}:${session.endedAt ?? session.activatedAt}`,
    payload: {
      sessionId: session.id,
      status: session.status,
      actorClerkUserId: session.actorClerkUserId,
      subjectClerkUserId: session.subjectClerkUserId,
      approvedByOwnerClerkUserId: session.approvedByOwnerClerkUserId,
      reason: session.reason,
      scope: session.scope,
      activatedAt: session.activatedAt,
      expiresAt: session.expiresAt,
      revokedAt: session.revokedAt,
      endedAt: session.endedAt,
      ...extra,
    },
  })
  return published.ok
}

async function sendSessionStartedEmails(
  services: SupportServices,
  session: SupportSessionRow,
): Promise<{ emailsQueued: number; emailsSent: number }> {
  const tenant = getTenant(services.db, session.tenantId)
  if (!tenant) throw new NotFoundError('tenant_not_found', 'Tenant inexistente')
  const owners = listOwnersForTenant(services.db, session.tenantId)
  let emailsQueued = 0
  let emailsSent = 0
  for (const owner of owners) {
    const snap = await services.verifiedEmails.readPrimaryVerifiedEmail(owner.clerkUserId)
    if (!snap.ok) continue
    try {
      const delivery = await deliverSupportSessionStartedEmail(
        services.db,
        services.clock,
        services.email,
        {
          supportSessionId: session.id,
          supportRequestId: session.supportAccessRequestId,
          toEmail: snap.email,
          tenantId: session.tenantId,
          tenantName: tenant.name,
          actorClerkUserId: session.actorClerkUserId,
          subjectClerkUserId: session.subjectClerkUserId,
          reason: session.reason,
          scope: session.scope,
          activatedAt: session.activatedAt,
          expiresAt: session.expiresAt,
          appBaseUrl: services.appBaseUrl,
          sendNow: true,
        },
      )
      emailsQueued += 1
      if (delivery.sent) emailsSent += 1
    } catch {
      // Falha de e-mail não impede ativação (DEC-035).
    }
  }
  return { emailsQueued, emailsSent }
}

export type ActivateSessionResult = {
  session: SupportSessionRow
  /** Handoff de uso único — nunca em e-mail/audit. */
  handoffCode: string
  emailsQueued: number
  emailsSent: number
  realtimeNotified: boolean
}

/** DEC-032: ativa sessão 30min a partir de pedido approved. */
export async function activateApprovedSupportSession(
  services: SupportServices,
  input: {
    requestId: string
    actorClerkUserId: string
    actorClerkSessionId: string
  },
): Promise<ActivateSessionResult> {
  const activated: ActivatedSupport = await activateSupportSession(
    services.db,
    services.clock,
    input,
  )
  const emails = await sendSessionStartedEmails(services, activated.session)
  const realtimeNotified = await notifySessionLifecycle(
    services,
    activated.session,
    'support.session.started',
  )
  return {
    session: activated.session,
    handoffCode: activated.handoffCode,
    emailsQueued: emails.emailsQueued,
    emailsSent: emails.emailsSent,
    realtimeNotified,
  }
}

export async function exchangeSupportHandoff(
  services: SupportServices,
  input: {
    handoffCode: string
    actorClerkUserId: string
    actorClerkSessionId: string
    claimedTenantId?: string
    claimedSubjectClerkUserId?: string
  },
): Promise<ConsumedHandoff> {
  return consumeSupportHandoff(services.db, services.clock, input)
}

export async function loadSupportContextFromCookie(
  services: SupportServices,
  input: {
    sessionToken: string
    actorClerkUserId: string
    actorClerkSessionId: string
    claimedTenantId?: string
    claimedSubjectClerkUserId?: string
  },
): Promise<SupportSessionRow> {
  return resolveSupportSessionByToken(services.db, services.clock, input)
}

export function listSessionsForOwner(
  services: SupportServices,
  tenantId: string,
): SupportSessionRow[] {
  return listActiveSupportSessionsForTenant(services.db, services.clock, tenantId)
}

export function loadSubjectSupportNotice(
  services: SupportServices,
  tenantId: string,
  subjectClerkUserId: string,
): SupportSessionRow | undefined {
  return getActiveSupportSessionForSubject(
    services.db,
    services.clock,
    tenantId,
    subjectClerkUserId,
  )
}

export async function endSupportSession(
  services: SupportServices,
  input: {
    sessionId: string
    actorClerkUserId: string
    asOwner: boolean
  },
): Promise<{ session: SupportSessionRow; realtimeNotified: boolean; endEmailsSent: number }> {
  const session = revokeSupportSession(services.db, services.clock, {
    sessionId: input.sessionId,
    actorClerkUserId: input.actorClerkUserId,
    asOwner: input.asOwner,
    reason: input.asOwner ? 'owner_revoke' : 'actor_end',
  })
  const realtimeNotified = await notifySessionLifecycle(
    services,
    session,
    'support.session.ended',
    { endedBy: input.actorClerkUserId },
  )
  // DEC-035: nenhum e-mail de término.
  return { session, realtimeNotified, endEmailsSent: 0 }
}

export async function subjectRequestTermination(
  services: SupportServices,
  input: { sessionId: string; subjectClerkUserId: string; tenantId: string },
): Promise<{
  termination: { id: string; status: string; created: boolean }
  realtimeNotified: boolean
}> {
  const session = getSupportSession(services.db, input.sessionId)
  if (!session || session.tenantId !== input.tenantId) {
    throw new NotFoundError('support_session_not_found', 'Sessão inexistente')
  }
  const termination = requestSupportTermination(services.db, services.clock, {
    sessionId: input.sessionId,
    subjectClerkUserId: input.subjectClerkUserId,
  })
  let realtimeNotified = false
  if (termination.created) {
    const published = await services.events.publishTenantEvent({
      tenantId: input.tenantId,
      type: 'support.termination.requested',
      entityType: 'support_termination_request',
      entityId: termination.id,
      audience: 'owners',
      eventId: `str:req:${termination.id}`,
      payload: {
        terminationRequestId: termination.id,
        sessionId: input.sessionId,
        subjectClerkUserId: input.subjectClerkUserId,
        status: termination.status,
      },
    })
    realtimeNotified = published.ok
  }
  return { termination, realtimeNotified }
}

export async function ownerDecideTermination(
  services: SupportServices,
  input: {
    tenantId: string
    terminationRequestId: string
    ownerClerkUserId: string
    decision: 'end' | 'keep'
  },
): Promise<{
  termination: SupportTerminationRow
  session: SupportSessionRow
  realtimeNotified: boolean
  endEmailsSent: number
}> {
  const preview = getSupportTerminationRequest(services.db, input.terminationRequestId)
  if (!preview || preview.tenantId !== input.tenantId) {
    throw new NotFoundError('termination_request_not_found', 'Pedido inexistente')
  }
  const result = decideSupportTermination(services.db, services.clock, {
    terminationRequestId: input.terminationRequestId,
    ownerClerkUserId: input.ownerClerkUserId,
    decision: input.decision,
  })

  const type =
    input.decision === 'end' ? 'support.session.ended' : 'support.termination.kept'
  const published = await services.events.publishTenantEvent({
    tenantId: input.tenantId,
    type,
    entityType: 'support_session',
    entityId: result.session.id,
    audience: 'owners_and_subject',
    eventId: `${type}:${result.session.id}:${result.termination.id}:${result.termination.decidedAt ?? 0}`,
    payload: {
      sessionId: result.session.id,
      terminationRequestId: result.termination.id,
      status: result.session.status,
      terminationStatus: result.termination.status,
      subjectClerkUserId: result.session.subjectClerkUserId,
      actorClerkUserId: result.session.actorClerkUserId,
      decidedByOwnerClerkUserId: input.ownerClerkUserId,
      decision: input.decision,
      expiresAt: result.session.expiresAt,
    },
  })

  return {
    termination: result.termination,
    session: result.session,
    realtimeNotified: published.ok,
    endEmailsSent: 0,
  }
}

export function touchOrExpireSession(
  services: SupportServices,
  sessionId: string,
): SupportSessionRow {
  return expireSupportSessionIfNeeded(services.db, services.clock, sessionId)
}

export function requireSessionTenant(
  session: SupportSessionRow,
  tenantId: string,
): void {
  if (session.tenantId !== tenantId) {
    throw new ForbiddenError('support_tenant_mismatch', 'Sessão de outro tenant')
  }
}
