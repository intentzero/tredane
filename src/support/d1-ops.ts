/**
 * Pedidos de suporte no D1 assíncrono (Worker). Espelha `support.ts` + e-mail.
 * Concorrência via UPDATE … WHERE status + meta.changes.
 */
import { SUPPORT_REQUEST_TTL_MS } from '../db/admin/constants'
import { ConflictError, ForbiddenError, NotFoundError } from '../db/admin/errors'
import { newId } from '../db/admin/ids'
import type { SupportRequestRow } from '../db/admin/support'
import type { EmailTransport } from '../email'
import type { VerifiedEmailReader } from '../auth/verified-email'
import type { ClinicEventPublisher } from '../realtime'
import { buildSupportRequestUrl } from '../email'

async function audit(
  db: D1Database,
  input: {
    actorClerkUserId: string
    subjectClerkUserId?: string | null
    tenantId: string
    action: string
    objectType: string
    objectId: string
    metadata?: Record<string, unknown>
    now: number
  },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO central_audit_events (
        id, occurred_at, actor_clerk_user_id, subject_clerk_user_id, tenant_id,
        action, object_type, object_id, outcome, support_session_id, metadata_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'success', NULL, ?)`,
    )
    .bind(
      newId('aud'),
      input.now,
      input.actorClerkUserId,
      input.subjectClerkUserId ?? null,
      input.tenantId,
      input.action,
      input.objectType,
      input.objectId,
      input.metadata ? JSON.stringify(input.metadata) : null,
    )
    .run()
}

function mapRequest(row: {
  id: string
  tenant_id: string
  actor_clerk_user_id: string
  subject_clerk_user_id: string
  reason: string
  scope: string
  status: string
  decided_by_owner_clerk_user_id: string | null
  decided_at: number | null
  created_at: number
  expires_at: number
}): SupportRequestRow {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    actorClerkUserId: row.actor_clerk_user_id,
    subjectClerkUserId: row.subject_clerk_user_id,
    reason: row.reason,
    scope: row.scope,
    status: row.status as SupportRequestRow['status'],
    decidedByOwnerClerkUserId: row.decided_by_owner_clerk_user_id,
    decidedAt: row.decided_at,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  }
}

const REQUEST_SELECT = `SELECT id, tenant_id, actor_clerk_user_id, subject_clerk_user_id, reason, scope,
  status, decided_by_owner_clerk_user_id, decided_at, created_at, expires_at
FROM support_access_requests`

export async function d1GetSupportRequest(
  db: D1Database,
  id: string,
): Promise<SupportRequestRow | null> {
  const row = await db
    .prepare(`${REQUEST_SELECT} WHERE id = ?`)
    .bind(id)
    .first<{
      id: string
      tenant_id: string
      actor_clerk_user_id: string
      subject_clerk_user_id: string
      reason: string
      scope: string
      status: string
      decided_by_owner_clerk_user_id: string | null
      decided_at: number | null
      created_at: number
      expires_at: number
    }>()
  return row ? mapRequest(row) : null
}

async function requireActiveOwner(
  db: D1Database,
  tenantId: string,
  clerkUserId: string,
): Promise<void> {
  const row = await db
    .prepare(
      `SELECT m.role, m.status, t.status AS tenant_status
       FROM tenant_memberships m
       INNER JOIN tenants t ON t.id = m.tenant_id
       WHERE m.tenant_id = ? AND m.clerk_user_id = ?`,
    )
    .bind(tenantId, clerkUserId)
    .first<{ role: string; status: string; tenant_status: string }>()
  if (!row || row.status !== 'active' || row.role !== 'owner') {
    throw new ForbiddenError('owner_required', 'Owner ativo do tenant exigido')
  }
  if (row.tenant_status !== 'active') {
    throw new ForbiddenError('tenant_not_active', 'Tenant inativo')
  }
}

async function expireIfNeeded(
  db: D1Database,
  request: SupportRequestRow,
  now: number,
): Promise<SupportRequestRow> {
  if (request.status !== 'pending' || now < request.expiresAt) return request
  await db
    .prepare(
      `UPDATE support_access_requests SET status = 'expired' WHERE id = ? AND status = 'pending'`,
    )
    .bind(request.id)
    .run()
  await audit(db, {
    actorClerkUserId: request.actorClerkUserId,
    subjectClerkUserId: request.subjectClerkUserId,
    tenantId: request.tenantId,
    action: 'support.request.expire',
    objectType: 'support_access_request',
    objectId: request.id,
    now,
  })
  return (await d1GetSupportRequest(db, request.id))!
}

export async function d1ListSupportRequests(
  db: D1Database,
  tenantId: string,
  opts: { status?: string; now: number } = { now: Date.now() },
): Promise<SupportRequestRow[]> {
  const limit = 100
  const rows = opts.status
    ? await db
        .prepare(
          `${REQUEST_SELECT} WHERE tenant_id = ? AND status = ? ORDER BY created_at DESC LIMIT ?`,
        )
        .bind(tenantId, opts.status, limit)
        .all<{
          id: string
          tenant_id: string
          actor_clerk_user_id: string
          subject_clerk_user_id: string
          reason: string
          scope: string
          status: string
          decided_by_owner_clerk_user_id: string | null
          decided_at: number | null
          created_at: number
          expires_at: number
        }>()
    : await db
        .prepare(
          `${REQUEST_SELECT} WHERE tenant_id = ? ORDER BY created_at DESC LIMIT ?`,
        )
        .bind(tenantId, limit)
        .all<{
          id: string
          tenant_id: string
          actor_clerk_user_id: string
          subject_clerk_user_id: string
          reason: string
          scope: string
          status: string
          decided_by_owner_clerk_user_id: string | null
          decided_at: number | null
          created_at: number
          expires_at: number
        }>()

  const mapped = (rows.results ?? []).map(mapRequest)
  const out: SupportRequestRow[] = []
  for (const row of mapped) {
    out.push(await expireIfNeeded(db, row, opts.now))
  }
  return out
}

export async function d1CreateSupportRequest(
  db: D1Database,
  input: {
    tenantId: string
    actorClerkUserId: string
    subjectClerkUserId: string
    reason: string
    scope: string
    now: number
    email: EmailTransport
    verifiedEmails: VerifiedEmailReader
    events: ClinicEventPublisher
    appBaseUrl: string
  },
): Promise<{
  request: SupportRequestRow
  emailsQueued: number
  emailsSent: number
  realtimeNotified: boolean
}> {
  const tenant = await db
    .prepare(`SELECT id, name, status FROM tenants WHERE id = ?`)
    .bind(input.tenantId)
    .first<{ id: string; name: string; status: string }>()
  if (!tenant || tenant.status !== 'active') {
    throw new ForbiddenError('tenant_not_active', 'Tenant inativo')
  }

  const subject = await db
    .prepare(
      `SELECT status FROM tenant_memberships WHERE tenant_id = ? AND clerk_user_id = ?`,
    )
    .bind(input.tenantId, input.subjectClerkUserId)
    .first<{ status: string }>()
  if (!subject || subject.status !== 'active') {
    throw new ForbiddenError('subject_not_member', 'Subject sem membership ativo')
  }

  const id = newId('sar')
  const expiresAt = input.now + SUPPORT_REQUEST_TTL_MS
  await db
    .prepare(
      `INSERT INTO support_access_requests (
        id, tenant_id, actor_clerk_user_id, subject_clerk_user_id, reason, scope,
        status, decided_by_owner_clerk_user_id, decided_at, created_at, expires_at, cancelled_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'pending', NULL, NULL, ?, ?, NULL)`,
    )
    .bind(
      id,
      input.tenantId,
      input.actorClerkUserId,
      input.subjectClerkUserId,
      input.reason,
      input.scope,
      input.now,
      expiresAt,
    )
    .run()

  await audit(db, {
    actorClerkUserId: input.actorClerkUserId,
    subjectClerkUserId: input.subjectClerkUserId,
    tenantId: input.tenantId,
    action: 'support.request.create',
    objectType: 'support_access_request',
    objectId: id,
    metadata: { scope: input.scope },
    now: input.now,
  })

  const request = (await d1GetSupportRequest(db, id))!

  const owners = await db
    .prepare(
      `SELECT clerk_user_id FROM tenant_memberships
       WHERE tenant_id = ? AND role = 'owner' AND status = 'active'`,
    )
    .bind(input.tenantId)
    .all<{ clerk_user_id: string }>()

  let emailsQueued = 0
  let emailsSent = 0
  for (const owner of owners.results ?? []) {
    const snap = await input.verifiedEmails.readPrimaryVerifiedEmail(owner.clerk_user_id)
    if (!snap.ok) continue
    const idempotencyKey = `sar:${id}:${snap.email}`
    const jobId = newId('eml')
    try {
      const inserted = await db
        .prepare(
          `INSERT OR IGNORE INTO email_delivery_jobs (
            id, idempotency_key, template, to_email, tenant_id, invitation_id, support_request_id,
            status, attempt_count, max_attempts, next_attempt_at, last_error,
            created_at, updated_at, sent_at
          ) VALUES (?, ?, 'support_access_request', ?, ?, NULL, ?, 'pending', 0, 5, ?, NULL, ?, ?, NULL)`,
        )
        .bind(
          jobId,
          idempotencyKey,
          snap.email,
          input.tenantId,
          id,
          input.now,
          input.now,
          input.now,
        )
        .run()
      if (!inserted.meta.changes) continue
      emailsQueued += 1
      await audit(db, {
        actorClerkUserId: input.actorClerkUserId,
        tenantId: input.tenantId,
        action: 'email.delivery.enqueue',
        objectType: 'email_delivery_job',
        objectId: jobId,
        metadata: { supportRequestId: id, email: snap.email, template: 'support_access_request' },
        now: input.now,
      })
      const send = await input.email.sendSupportAccessRequest({
        toEmail: snap.email,
        tenantId: input.tenantId,
        tenantName: tenant.name,
        supportRequestId: id,
        actorClerkUserId: input.actorClerkUserId,
        subjectClerkUserId: input.subjectClerkUserId,
        reason: input.reason,
        scope: input.scope,
        expiresAt,
        appBaseUrl: input.appBaseUrl,
      })
      if (send.ok) {
        emailsSent += 1
        await db
          .prepare(
            `UPDATE email_delivery_jobs
             SET status = 'sent', attempt_count = 1, sent_at = ?, updated_at = ?, last_error = NULL
             WHERE id = ?`,
          )
          .bind(input.now, input.now, jobId)
          .run()
      } else {
        await db
          .prepare(
            `UPDATE email_delivery_jobs
             SET status = 'failed', attempt_count = 1, last_error = ?, updated_at = ?
             WHERE id = ?`,
          )
          .bind(send.error.slice(0, 200), input.now, jobId)
          .run()
      }
    } catch {
      /* e-mail não bloqueia */
    }
  }

  // Garante URL construída sem token (só navegação).
  void buildSupportRequestUrl(input.appBaseUrl, input.tenantId, id)

  const published = await input.events.publishTenantEvent({
    tenantId: input.tenantId,
    type: 'support.request.created',
    entityType: 'support_access_request',
    entityId: id,
    audience: 'owners',
    eventId: `sar:created:${id}`,
    payload: {
      requestId: id,
      actorClerkUserId: input.actorClerkUserId,
      subjectClerkUserId: input.subjectClerkUserId,
      reason: input.reason,
      scope: input.scope,
      status: 'pending',
      createdAt: input.now,
      expiresAt,
    },
  })

  return {
    request,
    emailsQueued,
    emailsSent,
    realtimeNotified: published.ok,
  }
}

export async function d1DecideSupportRequest(
  db: D1Database,
  input: {
    tenantId: string
    requestId: string
    ownerClerkUserId: string
    decision: 'approve' | 'reject'
    now: number
    events: ClinicEventPublisher
  },
): Promise<{ request: SupportRequestRow; realtimeNotified: boolean }> {
  await requireActiveOwner(db, input.tenantId, input.ownerClerkUserId)
  const preview = await d1GetSupportRequest(db, input.requestId)
  if (!preview || preview.tenantId !== input.tenantId) {
    throw new NotFoundError('support_request_not_found', 'Pedido inexistente')
  }
  if (preview.status !== 'pending') {
    throw new ConflictError('support_request_not_pending', 'Pedido não pendente')
  }
  if (input.now >= preview.expiresAt) {
    await db
      .prepare(
        `UPDATE support_access_requests SET status = 'expired' WHERE id = ? AND status = 'pending'`,
      )
      .bind(preview.id)
      .run()
    throw new ConflictError('support_request_expired', 'Pedido expirado (24h)')
  }

  const subject = await db
    .prepare(
      `SELECT status FROM tenant_memberships WHERE tenant_id = ? AND clerk_user_id = ?`,
    )
    .bind(preview.tenantId, preview.subjectClerkUserId)
    .first<{ status: string }>()
  if (!subject || subject.status !== 'active') {
    throw new ForbiddenError('subject_not_member', 'Subject sem membership ativo')
  }

  const nextStatus = input.decision === 'approve' ? 'approved' : 'rejected'
  const action =
    input.decision === 'approve' ? 'support.request.approve' : 'support.request.reject'
  const conflictCode =
    input.decision === 'approve' ? 'support_approve_conflict' : 'support_reject_conflict'

  const updated = await db
    .prepare(
      `UPDATE support_access_requests
       SET status = ?, decided_by_owner_clerk_user_id = ?, decided_at = ?
       WHERE id = ? AND status = 'pending' AND expires_at > ?`,
    )
    .bind(nextStatus, input.ownerClerkUserId, input.now, input.requestId, input.now)
    .run()
  if (!updated.meta.changes || updated.meta.changes < 1) {
    throw new ConflictError(conflictCode, 'Decisão concorrente negada')
  }

  await audit(db, {
    actorClerkUserId: input.ownerClerkUserId,
    subjectClerkUserId: preview.subjectClerkUserId,
    tenantId: preview.tenantId,
    action,
    objectType: 'support_access_request',
    objectId: input.requestId,
    now: input.now,
  })

  const sessionCount = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM support_sessions WHERE support_access_request_id = ?`,
    )
    .bind(input.requestId)
    .first<{ n: number }>()
  if ((sessionCount?.n ?? 0) > 0) {
    throw new ConflictError('support_session_unexpected', 'Sessão não deve existir após decisão #26')
  }

  const request = (await d1GetSupportRequest(db, input.requestId))!
  const published = await input.events.publishTenantEvent({
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

  return { request, realtimeNotified: published.ok }
}
