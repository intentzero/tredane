/**
 * Convites / equipe no D1 assíncrono (Worker). Espelha `invitations.ts` + delivery.
 * Concorrência via UPDATE … WHERE status/token + meta.changes.
 */
import {
  INVITATION_RESEND_COOLDOWN_MS,
  INVITATION_RESEND_MAX,
  INVITATION_RESEND_WINDOW_MS,
  INVITATION_TTL_MS,
} from '../db/admin/constants'
import { ConflictError, ForbiddenError, NotFoundError } from '../db/admin/errors'
import { newId, normalizeEmail } from '../db/admin/ids'
import { generateOpaqueToken, hashToken } from '../db/tokens'
import type { InvitationRow } from '../db/admin/invitations'
import type { MembershipRow } from '../db/admin/memberships'
import type { EmailTransport } from '../email'

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

async function requireOwner(
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

function mapInvitation(row: {
  id: string
  tenant_id: string
  normalized_email: string
  issued_by_clerk_user_id: string
  status: string
  issued_at: number
  expires_at: number
  accepted_at: number | null
  accepted_by_clerk_user_id: string | null
  cancelled_at: number | null
  cancelled_by_clerk_user_id: string | null
  last_resent_at: number | null
}): InvitationRow {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    normalizedEmail: row.normalized_email,
    role: 'attendant',
    issuedByClerkUserId: row.issued_by_clerk_user_id,
    status: row.status as InvitationRow['status'],
    issuedAt: row.issued_at,
    expiresAt: row.expires_at,
    acceptedAt: row.accepted_at,
    acceptedByClerkUserId: row.accepted_by_clerk_user_id,
    cancelledAt: row.cancelled_at,
    cancelledByClerkUserId: row.cancelled_by_clerk_user_id,
    lastResentAt: row.last_resent_at,
  }
}

async function getInvitation(
  db: D1Database,
  id: string,
): Promise<InvitationRow | null> {
  const row = await db
    .prepare(
      `SELECT id, tenant_id, normalized_email, issued_by_clerk_user_id, status,
              issued_at, expires_at, accepted_at, accepted_by_clerk_user_id,
              cancelled_at, cancelled_by_clerk_user_id, last_resent_at
       FROM tenant_invitations WHERE id = ?`,
    )
    .bind(id)
    .first<{
      id: string
      tenant_id: string
      normalized_email: string
      issued_by_clerk_user_id: string
      status: string
      issued_at: number
      expires_at: number
      accepted_at: number | null
      accepted_by_clerk_user_id: string | null
      cancelled_at: number | null
      cancelled_by_clerk_user_id: string | null
      last_resent_at: number | null
    }>()
  return row ? mapInvitation(row) : null
}

async function deliverEmail(
  db: D1Database,
  transport: EmailTransport,
  input: {
    invitation: InvitationRow
    rawToken: string
    tenantName: string
    appBaseUrl: string
    actorClerkUserId: string
    now: number
  },
): Promise<{ emailSent: boolean; deliveryJobId: string }> {
  const tokenHash = await hashToken(input.rawToken)
  const idempotencyKey = `inv:${input.invitation.id}:${tokenHash}`
  const existing = await db
    .prepare(`SELECT id, status FROM email_delivery_jobs WHERE idempotency_key = ?`)
    .bind(idempotencyKey)
    .first<{ id: string; status: string }>()

  let jobId = existing?.id
  if (!jobId) {
    jobId = newId('eml')
    try {
      await db
        .prepare(
          `INSERT INTO email_delivery_jobs (
            id, idempotency_key, template, to_email, tenant_id, invitation_id,
            status, attempt_count, max_attempts, next_attempt_at, last_error,
            created_at, updated_at, sent_at
          ) VALUES (?, ?, 'tenant_invitation', ?, ?, ?, 'pending', 0, 5, ?, NULL, ?, ?, NULL)`,
        )
        .bind(
          jobId,
          idempotencyKey,
          input.invitation.normalizedEmail,
          input.invitation.tenantId,
          input.invitation.id,
          input.now,
          input.now,
          input.now,
        )
        .run()
      await audit(db, {
        actorClerkUserId: input.actorClerkUserId,
        tenantId: input.invitation.tenantId,
        action: 'email.delivery.enqueue',
        objectType: 'email_delivery_job',
        objectId: jobId,
        now: input.now,
        metadata: {
          invitationId: input.invitation.id,
          email: input.invitation.normalizedEmail,
        },
      })
    } catch {
      const again = await db
        .prepare(`SELECT id, status FROM email_delivery_jobs WHERE idempotency_key = ?`)
        .bind(idempotencyKey)
        .first<{ id: string; status: string }>()
      if (!again) throw new ConflictError('email_enqueue_conflict', 'Falha ao enfileirar e-mail')
      jobId = again.id
      if (again.status === 'sent') {
        return { emailSent: true, deliveryJobId: jobId }
      }
    }
  } else if (existing?.status === 'sent') {
    return { emailSent: true, deliveryJobId: jobId }
  }

  const result = await transport.sendInvitation({
    toEmail: input.invitation.normalizedEmail,
    tenantId: input.invitation.tenantId,
    tenantName: input.tenantName,
    invitationId: input.invitation.id,
    rawToken: input.rawToken,
    expiresAt: input.invitation.expiresAt,
    appBaseUrl: input.appBaseUrl,
  })

  if (result.ok) {
    await db
      .prepare(
        `UPDATE email_delivery_jobs
         SET status = 'sent', attempt_count = attempt_count + 1, sent_at = ?, updated_at = ?, last_error = NULL
         WHERE id = ?`,
      )
      .bind(input.now, input.now, jobId)
      .run()
    return { emailSent: true, deliveryJobId: jobId }
  }

  await db
    .prepare(
      `UPDATE email_delivery_jobs
       SET status = 'failed', attempt_count = attempt_count + 1, last_error = ?, updated_at = ?
       WHERE id = ?`,
    )
    .bind(result.error.slice(0, 200), input.now, jobId)
    .run()
  return { emailSent: false, deliveryJobId: jobId }
}

export async function d1CreateInvitation(
  db: D1Database,
  transport: EmailTransport,
  input: {
    tenantId: string
    email: string
    issuedByClerkUserId: string
    appBaseUrl: string
    now: number
  },
): Promise<{ invitation: InvitationRow; emailSent: boolean; deliveryJobId: string }> {
  await requireOwner(db, input.tenantId, input.issuedByClerkUserId)
  const email = normalizeEmail(input.email)
  const pending = await db
    .prepare(
      `SELECT id FROM tenant_invitations
       WHERE tenant_id = ? AND normalized_email = ? AND status = 'pending'`,
    )
    .bind(input.tenantId, email)
    .first<{ id: string }>()
  if (pending) {
    throw new ConflictError('invitation_already_pending', 'Já existe convite pendente para este e-mail')
  }

  const tenant = await db
    .prepare(`SELECT name FROM tenants WHERE id = ?`)
    .bind(input.tenantId)
    .first<{ name: string }>()
  if (!tenant) throw new NotFoundError('tenant_not_found', 'Tenant inexistente')

  const rawToken = generateOpaqueToken()
  const tokenHash = await hashToken(rawToken)
  const id = newId('inv')
  const expiresAt = input.now + INVITATION_TTL_MS

  await db
    .prepare(
      `INSERT INTO tenant_invitations (
        id, tenant_id, normalized_email, role, issued_by_clerk_user_id, token_hash,
        status, issued_at, expires_at, accepted_at, accepted_by_clerk_user_id,
        cancelled_at, cancelled_by_clerk_user_id, last_resent_at
      ) VALUES (?, ?, ?, 'attendant', ?, ?, 'pending', ?, ?, NULL, NULL, NULL, NULL, NULL)`,
    )
    .bind(id, input.tenantId, email, input.issuedByClerkUserId, tokenHash, input.now, expiresAt)
    .run()

  await audit(db, {
    actorClerkUserId: input.issuedByClerkUserId,
    tenantId: input.tenantId,
    action: 'invitation.create',
    objectType: 'tenant_invitation',
    objectId: id,
    now: input.now,
    metadata: { email },
  })

  const invitation = (await getInvitation(db, id))!
  const delivery = await deliverEmail(db, transport, {
    invitation,
    rawToken,
    tenantName: tenant.name,
    appBaseUrl: input.appBaseUrl,
    actorClerkUserId: input.issuedByClerkUserId,
    now: input.now,
  })
  return { invitation, ...delivery }
}

export async function d1ResendInvitation(
  db: D1Database,
  transport: EmailTransport,
  input: {
    invitationId: string
    actorClerkUserId: string
    tenantId: string
    appBaseUrl: string
    now: number
  },
): Promise<{ invitation: InvitationRow; emailSent: boolean; deliveryJobId: string }> {
  const current = await getInvitation(db, input.invitationId)
  if (!current || current.tenantId !== input.tenantId) {
    throw new NotFoundError('invitation_not_found', 'Convite inexistente')
  }
  await requireOwner(db, current.tenantId, input.actorClerkUserId)
  if (current.status !== 'pending') {
    throw new ConflictError('invitation_not_pending', 'Convite não está pendente')
  }
  if (input.now >= current.expiresAt) {
    await db
      .prepare(`UPDATE tenant_invitations SET status = 'expired' WHERE id = ? AND status = 'pending'`)
      .bind(current.id)
      .run()
    throw new ConflictError('invitation_expired', 'Convite expirado')
  }
  if (
    current.lastResentAt !== null
    && input.now - current.lastResentAt < INVITATION_RESEND_COOLDOWN_MS
  ) {
    throw new ConflictError('invitation_resend_cooldown', 'Aguarde o cooldown de 10 minutos')
  }

  const windowStart = input.now - INVITATION_RESEND_WINDOW_MS
  const countRow = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM tenant_invitation_resends
       WHERE tenant_id = ? AND normalized_email = ? AND resent_at >= ?`,
    )
    .bind(current.tenantId, current.normalizedEmail, windowStart)
    .first<{ n: number }>()
  if ((countRow?.n ?? 0) >= INVITATION_RESEND_MAX) {
    throw new ConflictError('invitation_resend_quota', 'Quota de 5 reenvios/24h excedida')
  }

  const rawToken = generateOpaqueToken()
  const tokenHash = await hashToken(rawToken)
  const rotated = await db
    .prepare(
      `UPDATE tenant_invitations
       SET token_hash = ?, issued_at = ?, expires_at = ?, last_resent_at = ?
       WHERE id = ? AND status = 'pending'`,
    )
    .bind(tokenHash, input.now, input.now + INVITATION_TTL_MS, input.now, current.id)
    .run()
  if (!rotated.meta.changes || rotated.meta.changes < 1) {
    throw new ConflictError('invitation_rotate_conflict', 'Rotação concorrente falhou')
  }

  await db
    .prepare(
      `INSERT INTO tenant_invitation_resends (
        id, invitation_id, tenant_id, normalized_email, resent_by_clerk_user_id, resent_at
      ) VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      newId('res'),
      current.id,
      current.tenantId,
      current.normalizedEmail,
      input.actorClerkUserId,
      input.now,
    )
    .run()

  await audit(db, {
    actorClerkUserId: input.actorClerkUserId,
    tenantId: current.tenantId,
    action: 'invitation.resend',
    objectType: 'tenant_invitation',
    objectId: current.id,
    now: input.now,
    metadata: { email: current.normalizedEmail },
  })

  const invitation = (await getInvitation(db, current.id))!
  const tenant = await db
    .prepare(`SELECT name FROM tenants WHERE id = ?`)
    .bind(current.tenantId)
    .first<{ name: string }>()
  const delivery = await deliverEmail(db, transport, {
    invitation,
    rawToken,
    tenantName: tenant?.name ?? current.tenantId,
    appBaseUrl: input.appBaseUrl,
    actorClerkUserId: input.actorClerkUserId,
    now: input.now,
  })
  return { invitation, ...delivery }
}

export async function d1CancelInvitation(
  db: D1Database,
  input: {
    invitationId: string
    actorClerkUserId: string
    tenantId: string
    now: number
  },
): Promise<InvitationRow> {
  const current = await getInvitation(db, input.invitationId)
  if (!current || current.tenantId !== input.tenantId) {
    throw new NotFoundError('invitation_not_found', 'Convite inexistente')
  }
  await requireOwner(db, current.tenantId, input.actorClerkUserId)
  const result = await db
    .prepare(
      `UPDATE tenant_invitations
       SET status = 'cancelled', cancelled_at = ?, cancelled_by_clerk_user_id = ?
       WHERE id = ? AND status = 'pending'`,
    )
    .bind(input.now, input.actorClerkUserId, input.invitationId)
    .run()
  if (!result.meta.changes || result.meta.changes < 1) {
    throw new ConflictError('invitation_cancel_conflict', 'Cancelamento não aplicado')
  }
  await audit(db, {
    actorClerkUserId: input.actorClerkUserId,
    tenantId: current.tenantId,
    action: 'invitation.cancel',
    objectType: 'tenant_invitation',
    objectId: input.invitationId,
    now: input.now,
    metadata: { email: current.normalizedEmail },
  })
  return (await getInvitation(db, input.invitationId))!
}

export async function d1AcceptInvitation(
  db: D1Database,
  input: {
    rawToken: string
    acceptorClerkUserId: string
    verifiedEmail: string
    now: number
  },
): Promise<{ invitation: InvitationRow }> {
  const tokenHash = await hashToken(input.rawToken)
  const email = normalizeEmail(input.verifiedEmail)
  const row = await db
    .prepare(
      `SELECT id, tenant_id, normalized_email, status, expires_at
       FROM tenant_invitations WHERE token_hash = ?`,
    )
    .bind(tokenHash)
    .first<{
      id: string
      tenant_id: string
      normalized_email: string
      status: string
      expires_at: number
    }>()

  if (!row || row.status !== 'pending') {
    throw new ConflictError('invitation_token_invalid', 'Token inválido ou já usado')
  }
  if (input.now >= row.expires_at) {
    await db
      .prepare(`UPDATE tenant_invitations SET status = 'expired' WHERE id = ? AND status = 'pending'`)
      .bind(row.id)
      .run()
    throw new ConflictError('invitation_expired', 'Convite expirado')
  }
  if (row.normalized_email !== email) {
    throw new ConflictError('invitation_email_mismatch', 'E-mail verificado não corresponde')
  }

  const consumed = await db
    .prepare(
      `UPDATE tenant_invitations
       SET status = 'accepted', accepted_at = ?, accepted_by_clerk_user_id = ?
       WHERE id = ? AND status = 'pending' AND token_hash = ?`,
    )
    .bind(input.now, input.acceptorClerkUserId, row.id, tokenHash)
    .run()
  if (!consumed.meta.changes || consumed.meta.changes < 1) {
    throw new ConflictError('invitation_accept_conflict', 'Aceite concorrente negado')
  }

  const existing = await db
    .prepare(
      `SELECT role, status FROM tenant_memberships
       WHERE tenant_id = ? AND clerk_user_id = ?`,
    )
    .bind(row.tenant_id, input.acceptorClerkUserId)
    .first<{ role: string; status: string }>()

  if (existing?.status === 'active') {
    if (existing.role !== 'attendant') {
      throw new ConflictError(
        'membership_role_conflict',
        'Membership ativo com role diferente; não sobrescrever automaticamente',
      )
    }
  } else if (existing?.status === 'revoked') {
    await db
      .prepare(
        `UPDATE tenant_memberships
         SET role = 'attendant', status = 'active', created_at = ?, revoked_at = NULL
         WHERE tenant_id = ? AND clerk_user_id = ?`,
      )
      .bind(input.now, row.tenant_id, input.acceptorClerkUserId)
      .run()
    await audit(db, {
      actorClerkUserId: input.acceptorClerkUserId,
      subjectClerkUserId: input.acceptorClerkUserId,
      tenantId: row.tenant_id,
      action: 'membership.activate',
      objectType: 'tenant_membership',
      objectId: `${row.tenant_id}:${input.acceptorClerkUserId}`,
      now: input.now,
      metadata: { role: 'attendant' },
    })
  } else {
    await db
      .prepare(
        `INSERT INTO tenant_memberships (tenant_id, clerk_user_id, role, status, created_at, revoked_at)
         VALUES (?, ?, 'attendant', 'active', ?, NULL)`,
      )
      .bind(row.tenant_id, input.acceptorClerkUserId, input.now)
      .run()
    await audit(db, {
      actorClerkUserId: input.acceptorClerkUserId,
      subjectClerkUserId: input.acceptorClerkUserId,
      tenantId: row.tenant_id,
      action: 'membership.activate',
      objectType: 'tenant_membership',
      objectId: `${row.tenant_id}:${input.acceptorClerkUserId}`,
      now: input.now,
      metadata: { role: 'attendant' },
    })
  }

  await audit(db, {
    actorClerkUserId: input.acceptorClerkUserId,
    subjectClerkUserId: input.acceptorClerkUserId,
    tenantId: row.tenant_id,
    action: 'invitation.accept',
    objectType: 'tenant_invitation',
    objectId: row.id,
    now: input.now,
    metadata: { email },
  })

  return { invitation: (await getInvitation(db, row.id))! }
}

export async function d1ListTeam(
  db: D1Database,
  tenantId: string,
  now: number,
): Promise<{
  members: MembershipRow[]
  invitations: InvitationRow[]
  resendCounts: Map<string, number>
}> {
  const memberRows = await db
    .prepare(
      `SELECT tenant_id, clerk_user_id, role, status, created_at, revoked_at
       FROM tenant_memberships WHERE tenant_id = ? AND status = 'active' ORDER BY clerk_user_id`,
    )
    .bind(tenantId)
    .all<{
      tenant_id: string
      clerk_user_id: string
      role: string
      status: string
      created_at: number
      revoked_at: number | null
    }>()

  const invRows = await db
    .prepare(
      `SELECT id, tenant_id, normalized_email, issued_by_clerk_user_id, status,
              issued_at, expires_at, accepted_at, accepted_by_clerk_user_id,
              cancelled_at, cancelled_by_clerk_user_id, last_resent_at
       FROM tenant_invitations
       WHERE tenant_id = ? AND status = 'pending'
       ORDER BY issued_at DESC`,
    )
    .bind(tenantId)
    .all<{
      id: string
      tenant_id: string
      normalized_email: string
      issued_by_clerk_user_id: string
      status: string
      issued_at: number
      expires_at: number
      accepted_at: number | null
      accepted_by_clerk_user_id: string | null
      cancelled_at: number | null
      cancelled_by_clerk_user_id: string | null
      last_resent_at: number | null
    }>()

  const invitations = (invRows.results ?? []).map(mapInvitation)
  const resendCounts = new Map<string, number>()
  const windowStart = now - INVITATION_RESEND_WINDOW_MS
  for (const inv of invitations) {
    const count = await db
      .prepare(
        `SELECT COUNT(*) AS n FROM tenant_invitation_resends
         WHERE tenant_id = ? AND normalized_email = ? AND resent_at >= ?`,
      )
      .bind(inv.tenantId, inv.normalizedEmail, windowStart)
      .first<{ n: number }>()
    resendCounts.set(inv.id, count?.n ?? 0)
  }

  return {
    members: (memberRows.results ?? []).map((m) => ({
      tenantId: m.tenant_id,
      clerkUserId: m.clerk_user_id,
      role: m.role as MembershipRow['role'],
      status: m.status as MembershipRow['status'],
      createdAt: m.created_at,
      revokedAt: m.revoked_at,
    })),
    invitations,
    resendCounts,
  }
}

export { getInvitation as d1GetInvitation }
