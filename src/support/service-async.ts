/**
 * Orquestração da sessão de suporte sobre `AsyncAdminDb` (#853): ativar (com e-mail às owners, DEC-035, e
 * evento em tempo real), encerrar e cancelar. O ciclo de base está em `d1-session.ts`.
 */
import type { Clock } from '../db/clock'
import type { AsyncAdminDb } from '../db/admin/async-store'
import { newId } from '../db/admin/ids'
import type { SupportSessionRow, SupportRequestRow } from '../db/admin/support'
import type { VerifiedEmailReader } from '../auth/verified-email'
import type { EmailTransport } from '../email'
import type { ClinicEventPublisher } from '../realtime'
import {
  activateSupportSessionAsync,
  cancelSupportRequestAsync,
  decideSupportTerminationAsync,
  getSupportSessionAsync,
  getSupportTerminationRequestAsync,
  requestSupportTerminationAsync,
  revokeSupportSessionAsync,
} from './d1-session'
import { ConflictError, NotFoundError } from '../db/admin/errors'

export type AsyncSupportServices = {
  db: AsyncAdminDb
  clock: Clock
  email: EmailTransport
  appBaseUrl: string
  verifiedEmails: VerifiedEmailReader
  events: ClinicEventPublisher
}

/** Fecha as ligações WebSocket da sessão (ADR-0017 §4); best-effort — o DO volta a verificar a sessão a cada evento. */
async function fenceSupportSession(services: AsyncSupportServices, session: SupportSessionRow): Promise<void> {
  try {
    await services.events.closeSupportSession?.({
      tenantId: session.tenantId,
      supportSessionId: session.id,
      reason: 'support_revoked',
    })
  } catch {
    /* best-effort */
  }
}

async function notifySessionLifecycle(
  services: AsyncSupportServices,
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

/** DEC-035: e-mail de início a cada owner ativa, idempotente por (sessão, destinatário). Falha de e-mail não impede a ativação. */
async function sendSessionStartedEmails(
  services: AsyncSupportServices,
  session: SupportSessionRow,
): Promise<{ emailsQueued: number; emailsSent: number }> {
  const { db, clock } = services
  const tenant = await db.get<{ name: string }>(`SELECT name FROM tenants WHERE id = ?`, session.tenantId)
  if (!tenant) return { emailsQueued: 0, emailsSent: 0 }
  const owners = await db.all<{ clerk_user_id: string }>(
    `SELECT clerk_user_id FROM tenant_memberships WHERE tenant_id = ? AND role = 'owner' AND status = 'active' ORDER BY clerk_user_id`,
    session.tenantId,
  )
  let emailsQueued = 0
  let emailsSent = 0
  for (const owner of owners) {
    const snap = await services.verifiedEmails.readPrimaryVerifiedEmail(owner.clerk_user_id)
    if (!snap.ok) continue
    try {
      const now = clock.nowMs()
      const key = `ssn:${session.id}:${snap.email}`
      const jobId = newId('eml')
      const created = await db.run(
        `INSERT INTO email_delivery_jobs (
           id, idempotency_key, template, to_email, tenant_id, invitation_id, support_request_id,
           support_session_id, status, attempt_count, max_attempts, next_attempt_at, last_error,
           created_at, updated_at, sent_at
         ) VALUES (?, ?, 'support_session_started', ?, ?, NULL, ?, ?, 'pending', 0, 5, ?, NULL, ?, ?, NULL)
         ON CONFLICT(idempotency_key) DO NOTHING`,
        jobId,
        key,
        snap.email,
        session.tenantId,
        session.supportAccessRequestId,
        session.id,
        now,
        now,
        now,
      )
      const job = await db.get<{ id: string; status: string }>(
        `SELECT id, status FROM email_delivery_jobs WHERE idempotency_key = ?`,
        key,
      )
      if (!job) continue
      emailsQueued += 1
      if (created.changes === 1) {
        await db.run(
          `INSERT INTO central_audit_events (
             id, occurred_at, actor_clerk_user_id, subject_clerk_user_id, tenant_id,
             action, object_type, object_id, outcome, support_session_id, metadata_json
           ) VALUES (?, ?, ?, NULL, ?, 'email.delivery.enqueue', 'email_delivery_job', ?, 'success', ?, ?)`,
          newId('aud'),
          now,
          session.actorClerkUserId,
          session.tenantId,
          job.id,
          session.id,
          JSON.stringify({ template: 'support_session_started', email: snap.email }),
        )
      }
      if (job.status === 'sent') {
        emailsSent += 1
        continue
      }
      const result = await services.email.sendSupportSessionStarted({
        toEmail: snap.email,
        tenantId: session.tenantId,
        tenantName: tenant.name,
        supportSessionId: session.id,
        supportRequestId: session.supportAccessRequestId,
        actorClerkUserId: session.actorClerkUserId,
        subjectClerkUserId: session.subjectClerkUserId,
        reason: session.reason,
        scope: session.scope,
        activatedAt: session.activatedAt,
        expiresAt: session.expiresAt,
        appBaseUrl: services.appBaseUrl,
      })
      if (result.ok) {
        await db.run(
          `UPDATE email_delivery_jobs SET status = 'sent', attempt_count = attempt_count + 1, sent_at = ?, updated_at = ?, last_error = NULL WHERE id = ?`,
          now,
          now,
          job.id,
        )
        emailsSent += 1
      } else {
        await db.run(
          `UPDATE email_delivery_jobs SET status = 'failed', attempt_count = attempt_count + 1, last_error = ?, updated_at = ? WHERE id = ?`,
          result.error.slice(0, 200),
          now,
          job.id,
        )
      }
    } catch {
      // Falha de e-mail não impede a ativação (DEC-035).
    }
  }
  return { emailsQueued, emailsSent }
}

export async function activateApprovedSupportSessionAsync(
  services: AsyncSupportServices,
  input: { requestId: string; actorClerkUserId: string; actorClerkSessionId: string },
) {
  const activated = await activateSupportSessionAsync(services.db, services.clock, input)
  const emails = await sendSessionStartedEmails(services, activated.session)
  const realtimeNotified = await notifySessionLifecycle(services, activated.session, 'support.session.started')
  return {
    session: activated.session,
    /** Handoff de uso único — nunca em e-mail nem na auditoria. */
    handoffCode: activated.handoffCode,
    emailsQueued: emails.emailsQueued,
    emailsSent: emails.emailsSent,
    realtimeNotified,
  }
}

export async function endSupportSessionAsync(
  services: AsyncSupportServices,
  input: { sessionId: string; actorClerkUserId: string; asOwner: boolean; tenantId?: string },
) {
  const session = await revokeSupportSessionAsync(services.db, services.clock, {
    sessionId: input.sessionId,
    actorClerkUserId: input.actorClerkUserId,
    asOwner: input.asOwner,
    reason: input.asOwner ? 'owner_revoke' : 'actor_end',
    expectedTenantId: input.tenantId,
  })
  await fenceSupportSession(services, session)
  const realtimeNotified = await notifySessionLifecycle(services, session, 'support.session.ended', {
    endedBy: input.actorClerkUserId,
  })
  // DEC-035: nenhum e-mail de término.
  return { session, realtimeNotified, endEmailsSent: 0 }
}

export async function cancelSupportRequestWithServices(
  services: AsyncSupportServices,
  input: { requestId: string; actorClerkUserId: string },
): Promise<SupportRequestRow> {
  return cancelSupportRequestAsync(services.db, services.clock, input)
}

export async function subjectRequestTerminationAsync(
  services: AsyncSupportServices,
  input: { sessionId: string; subjectClerkUserId: string; tenantId: string },
) {
  const session = await getSupportSessionAsync(services.db, input.sessionId)
  if (!session || session.tenantId !== input.tenantId) {
    throw new NotFoundError('support_session_not_found', 'Sessão inexistente')
  }
  const termination = await requestSupportTerminationAsync(services.db, services.clock, {
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

export async function ownerDecideTerminationAsync(
  services: AsyncSupportServices,
  input: { tenantId: string; terminationRequestId: string; ownerClerkUserId: string; decision: 'end' | 'keep'; sessionId?: string },
) {
  const preview = await getSupportTerminationRequestAsync(services.db, input.terminationRequestId)
  if (!preview || preview.tenantId !== input.tenantId) {
    throw new NotFoundError('termination_request_not_found', 'Pedido inexistente')
  }
  if (input.sessionId && preview.supportSessionId !== input.sessionId) {
    throw new ConflictError('termination_session_mismatch', 'Sessão não corresponde')
  }
  const result = await decideSupportTerminationAsync(services.db, services.clock, {
    terminationRequestId: input.terminationRequestId,
    ownerClerkUserId: input.ownerClerkUserId,
    decision: input.decision,
  })
  if (input.decision === 'end') await fenceSupportSession(services, result.session)
  const type = input.decision === 'end' ? 'support.session.ended' : 'support.termination.kept'
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
