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

/**
 * Autorização da Platform Admin (DEC-194): o chamador é o superadmin, já validado pela rota
 * (`requireSuperadmin`); basta a clínica existir e estar ativa. Só os caminhos `asPlatformAdmin`
 * o usam — nunca ligar a flag a input do cliente.
 */
async function requireActiveTenant(db: D1Database, tenantId: string): Promise<void> {
  const row = await db
    .prepare(`SELECT status FROM tenants WHERE id = ?`)
    .bind(tenantId)
    .first<{ status: string }>()
  if (!row) throw new NotFoundError('tenant_not_found', 'Tenant inexistente')
  if (row.status !== 'active') throw new ForbiddenError('tenant_not_active', 'Tenant inativo')
}

function mapInvitationRole(role: string): InvitationRow['role'] {
  if (role === 'owner' || role === 'professional' || role === 'attendant') return role
  return 'attendant'
}

function mapInvitation(row: {
  id: string
  tenant_id: string
  normalized_email: string
  role: string
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
    role: mapInvitationRole(row.role),
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
      `SELECT id, tenant_id, normalized_email, role, issued_by_clerk_user_id, status,
              issued_at, expires_at, accepted_at, accepted_by_clerk_user_id,
              cancelled_at, cancelled_by_clerk_user_id, last_resent_at
       FROM tenant_invitations WHERE id = ?`,
    )
    .bind(id)
    .first<{
      id: string
      tenant_id: string
      normalized_email: string
      role: string
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
            id, idempotency_key, template, to_email, tenant_id, invitation_id, support_request_id,
            status, attempt_count, max_attempts, next_attempt_at, last_error,
            created_at, updated_at, sent_at
          ) VALUES (?, ?, 'tenant_invitation', ?, ?, ?, NULL, 'pending', 0, 5, ?, NULL, ?, ?, NULL)`,
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
    role?: InvitationRow['role']
    /** DEC-194: emitido pelo superadmin (rota `requireSuperadmin`). */
    asPlatformAdmin?: boolean
  },
): Promise<{ invitation: InvitationRow; emailSent: boolean; deliveryJobId: string }> {
  if (input.asPlatformAdmin) await requireActiveTenant(db, input.tenantId)
  else await requireOwner(db, input.tenantId, input.issuedByClerkUserId)
  const role: InvitationRow['role'] = input.role === 'owner' || input.role === 'professional' ? input.role : 'attendant'
  const email = normalizeEmail(input.email)
  // Convite vencido continua «pending» até alguém o tocar; não pode bloquear um novo (DEC-194).
  await db
    .prepare(
      `UPDATE tenant_invitations SET status = 'expired'
       WHERE tenant_id = ? AND normalized_email = ? AND status = 'pending' AND expires_at <= ?`,
    )
    .bind(input.tenantId, email, input.now)
    .run()
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
      ) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, NULL, NULL, NULL, NULL, NULL)`,
    )
    .bind(id, input.tenantId, email, role, input.issuedByClerkUserId, tokenHash, input.now, expiresAt)
    .run()

  await audit(db, {
    actorClerkUserId: input.issuedByClerkUserId,
    tenantId: input.tenantId,
    action: 'invitation.create',
    objectType: 'tenant_invitation',
    objectId: id,
    now: input.now,
    metadata: { email, role },
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

/**
 * DEC-194: cria a clínica **sem owner ativa** e o convite de owner numa só `batch` (atómica no D1).
 * O envio do e-mail corre depois: uma falha de e-mail não desfaz a clínica; o convite fica pendente
 * e o superadmin pode reenviá-lo.
 */
export async function d1CreateClinicWithOwnerInvitation(
  db: D1Database,
  transport: EmailTransport,
  input: {
    id?: string
    name: string
    timezone?: string
    ownerEmail: string
    actorClerkUserId: string
    appBaseUrl: string
    now: number
  },
): Promise<{
  tenant: { id: string; name: string; timezone: string; createdAt: number }
  invitation: InvitationRow
  emailSent: boolean
  deliveryJobId: string
}> {
  const name = input.name.trim()
  if (!name) throw new ConflictError('tenant_name_required', 'Nome do tenant obrigatório')
  const email = normalizeEmail(input.ownerEmail)
  if (!email) throw new ConflictError('owner_email_required', 'E-mail da primeira owner obrigatório')
  const id = input.id ?? newId('tenant')
  const timezone = input.timezone?.trim() || 'America/Sao_Paulo'
  const exists = await db.prepare(`SELECT id FROM tenants WHERE id = ?`).bind(id).first<{ id: string }>()
  if (exists) throw new ConflictError('tenant_id_conflict', 'Tenant id já existe')

  const rawToken = generateOpaqueToken()
  const tokenHash = await hashToken(rawToken)
  const invitationId = newId('inv')
  const auditSql = `INSERT INTO central_audit_events (
      id, occurred_at, actor_clerk_user_id, subject_clerk_user_id, tenant_id,
      action, object_type, object_id, outcome, support_session_id, metadata_json
    ) VALUES (?, ?, ?, NULL, ?, ?, ?, ?, 'success', NULL, ?)`

  await db.batch([
    db
      .prepare(
        `INSERT INTO tenants (id, name, timezone, status, created_at, updated_at, suspended_at, pending_deletion_at)
         VALUES (?, ?, ?, 'active', ?, ?, NULL, NULL)`,
      )
      .bind(id, name, timezone, input.now, input.now),
    db
      .prepare(auditSql)
      .bind(
        newId('aud'),
        input.now,
        input.actorClerkUserId,
        id,
        'tenant.create',
        'tenant',
        id,
        JSON.stringify({ name, firstOwnerEmail: email, via: 'owner_invitation' }),
      ),
    db
      .prepare(
        `INSERT INTO tenant_invitations (
          id, tenant_id, normalized_email, role, issued_by_clerk_user_id, token_hash,
          status, issued_at, expires_at, accepted_at, accepted_by_clerk_user_id,
          cancelled_at, cancelled_by_clerk_user_id, last_resent_at
        ) VALUES (?, ?, ?, 'owner', ?, ?, 'pending', ?, ?, NULL, NULL, NULL, NULL, NULL)`,
      )
      .bind(invitationId, id, email, input.actorClerkUserId, tokenHash, input.now, input.now + INVITATION_TTL_MS),
    db
      .prepare(auditSql)
      .bind(
        newId('aud'),
        input.now,
        input.actorClerkUserId,
        id,
        'invitation.create',
        'tenant_invitation',
        invitationId,
        JSON.stringify({ email, role: 'owner' }),
      ),
  ])

  const invitation = (await getInvitation(db, invitationId))!
  const delivery = await deliverEmail(db, transport, {
    invitation,
    rawToken,
    tenantName: name,
    appBaseUrl: input.appBaseUrl,
    actorClerkUserId: input.actorClerkUserId,
    now: input.now,
  })
  return { tenant: { id, name, timezone, createdAt: input.now }, invitation, ...delivery }
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
    /** DEC-194: superadmin (rota `requireSuperadmin`). */
    asPlatformAdmin?: boolean
  },
): Promise<{ invitation: InvitationRow; emailSent: boolean; deliveryJobId: string }> {
  const current = await getInvitation(db, input.invitationId)
  if (!current || current.tenantId !== input.tenantId) {
    throw new NotFoundError('invitation_not_found', 'Convite inexistente')
  }
  if (input.asPlatformAdmin) await requireActiveTenant(db, current.tenantId)
  else await requireOwner(db, current.tenantId, input.actorClerkUserId)
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
    /** DEC-194: superadmin (rota `requireSuperadmin`). */
    asPlatformAdmin?: boolean
  },
): Promise<InvitationRow> {
  const current = await getInvitation(db, input.invitationId)
  if (!current || current.tenantId !== input.tenantId) {
    throw new NotFoundError('invitation_not_found', 'Convite inexistente')
  }
  if (input.asPlatformAdmin) await requireActiveTenant(db, current.tenantId)
  else await requireOwner(db, current.tenantId, input.actorClerkUserId)
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
      `SELECT id, tenant_id, normalized_email, role, status, expires_at
       FROM tenant_invitations WHERE token_hash = ?`,
    )
    .bind(tokenHash)
    .first<{
      id: string
      tenant_id: string
      normalized_email: string
      role: string
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

  const role = mapInvitationRole(row.role)
  const existing = await db
    .prepare(
      `SELECT role, status FROM tenant_memberships
       WHERE tenant_id = ? AND clerk_user_id = ?`,
    )
    .bind(row.tenant_id, input.acceptorClerkUserId)
    .first<{ role: string; status: string }>()

  if (existing?.status === 'active') {
    if (existing.role !== role) {
      throw new ConflictError(
        'membership_role_conflict',
        'Membership ativo com role diferente; não sobrescrever automaticamente',
      )
    }
  } else if (existing?.status === 'revoked') {
    await db
      .prepare(
        `UPDATE tenant_memberships
         SET role = ?, status = 'active', created_at = ?, revoked_at = NULL
         WHERE tenant_id = ? AND clerk_user_id = ?`,
      )
      .bind(role, input.now, row.tenant_id, input.acceptorClerkUserId)
      .run()
    await audit(db, {
      actorClerkUserId: input.acceptorClerkUserId,
      subjectClerkUserId: input.acceptorClerkUserId,
      tenantId: row.tenant_id,
      action: 'membership.activate',
      objectType: 'tenant_membership',
      objectId: `${row.tenant_id}:${input.acceptorClerkUserId}`,
      now: input.now,
      metadata: { role },
    })
  } else {
    await db
      .prepare(
        `INSERT INTO tenant_memberships (tenant_id, clerk_user_id, role, status, created_at, revoked_at)
         VALUES (?, ?, ?, 'active', ?, NULL)`,
      )
      .bind(row.tenant_id, input.acceptorClerkUserId, role, input.now)
      .run()
    await audit(db, {
      actorClerkUserId: input.acceptorClerkUserId,
      subjectClerkUserId: input.acceptorClerkUserId,
      tenantId: row.tenant_id,
      action: 'membership.activate',
      objectType: 'tenant_membership',
      objectId: `${row.tenant_id}:${input.acceptorClerkUserId}`,
      now: input.now,
      metadata: { role },
    })
  }

  await db
    .prepare(
      `UPDATE professional_logins
       SET clerk_user_id = ?
       WHERE tenant_id = ? AND normalized_email = ?`,
    )
    .bind(input.acceptorClerkUserId, row.tenant_id, email)
    .run()

  await audit(db, {
    actorClerkUserId: input.acceptorClerkUserId,
    subjectClerkUserId: input.acceptorClerkUserId,
    tenantId: row.tenant_id,
    action: 'invitation.accept',
    objectType: 'tenant_invitation',
    objectId: row.id,
    now: input.now,
    metadata: { email, role },
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
      `SELECT id, tenant_id, normalized_email, role, issued_by_clerk_user_id, status,
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
      role: string
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

export type D1ProfessionalLogin = {
  resourceId: string
  email: string
  clerkUserId: string | null
  alsoAttendant: boolean
}

/** Vínculos ficha↔login desta clínica, indexados por clerkUserId (Equipe / DEC-204). */
export async function d1ListProfessionalLoginsByUser(
  db: D1Database,
  tenantId: string,
): Promise<Map<string, { resourceId: string; alsoAttendant: boolean }>> {
  const rows = await db
    .prepare(
      `SELECT resource_id, clerk_user_id, also_attendant
       FROM professional_logins
       WHERE tenant_id = ? AND clerk_user_id IS NOT NULL`,
    )
    .bind(tenantId)
    .all<{ resource_id: string; clerk_user_id: string; also_attendant: number }>()
  const map = new Map<string, { resourceId: string; alsoAttendant: boolean }>()
  for (const row of rows.results ?? []) {
    if (!row.clerk_user_id) continue
    map.set(row.clerk_user_id, {
      resourceId: row.resource_id,
      alsoAttendant: row.also_attendant === 1,
    })
  }
  return map
}

export async function d1GetProfessionalLogin(
  db: D1Database,
  tenantId: string,
  resourceId: string,
): Promise<D1ProfessionalLogin | null> {
  const row = await db
    .prepare(
      `SELECT resource_id, normalized_email, clerk_user_id, also_attendant
       FROM professional_logins WHERE tenant_id = ? AND resource_id = ?`,
    )
    .bind(tenantId, resourceId)
    .first<{
      resource_id: string
      normalized_email: string
      clerk_user_id: string | null
      also_attendant: number
    }>()
  if (!row) return null
  return {
    resourceId: row.resource_id,
    email: row.normalized_email,
    clerkUserId: row.clerk_user_id,
    alsoAttendant: row.also_attendant === 1,
  }
}

/** Liga ficha a membro activo da Equipe (DEC-204 revista). Não envia convite. */
export async function d1LinkProfessionalLogin(
  db: D1Database,
  _transport: EmailTransport,
  input: {
    tenantId: string
    resourceId: string
    email: string
    alsoAttendant: boolean
    actorClerkUserId: string
    boundClerkUserId?: string | null
    appBaseUrl: string
    now: number
  },
): Promise<{ login: D1ProfessionalLogin; invitationSent: boolean; membershipRole: string | null }> {
  await requireOwner(db, input.tenantId, input.actorClerkUserId)
  const email = normalizeEmail(input.email)
  if (!email.includes('@')) throw new ConflictError('email_invalid', 'E-mail inválido')
  const bound = input.boundClerkUserId?.trim() || null
  if (!bound) {
    throw new ConflictError(
      'membership_required',
      'Convide a pessoa na Equipe antes de ligar a ficha',
    )
  }
  const membership = await db
    .prepare(
      `SELECT role, status FROM tenant_memberships WHERE tenant_id = ? AND clerk_user_id = ?`,
    )
    .bind(input.tenantId, bound)
    .first<{ role: string; status: string }>()
  if (!membership || membership.status !== 'active') {
    throw new ConflictError(
      'membership_required',
      'Convide a pessoa na Equipe antes de ligar a ficha',
    )
  }
  const other = await db
    .prepare(
      `SELECT resource_id FROM professional_logins
       WHERE tenant_id = ? AND normalized_email = ? AND resource_id <> ?`,
    )
    .bind(input.tenantId, email, input.resourceId)
    .first<{ resource_id: string }>()
  if (other) {
    throw new ConflictError('professional_email_taken', 'Este e-mail já está ligado a outra profissional')
  }
  const otherUser = await db
    .prepare(
      `SELECT resource_id FROM professional_logins
       WHERE tenant_id = ? AND clerk_user_id = ? AND resource_id <> ?`,
    )
    .bind(input.tenantId, bound, input.resourceId)
    .first<{ resource_id: string }>()
  if (otherUser) {
    throw new ConflictError(
      'professional_user_taken',
      'Esta pessoa já está ligada a outra ficha de profissional',
    )
  }
  const previous = await d1GetProfessionalLogin(db, input.tenantId, input.resourceId)
  if (previous?.clerkUserId && previous.clerkUserId !== bound) {
    const old = await db
      .prepare(
        `SELECT role, status FROM tenant_memberships WHERE tenant_id = ? AND clerk_user_id = ?`,
      )
      .bind(input.tenantId, previous.clerkUserId)
      .first<{ role: string; status: string }>()
    if (old?.status === 'active' && old.role === 'professional') {
      await db
        .prepare(
          `UPDATE tenant_memberships SET status = 'revoked', revoked_at = ?
           WHERE tenant_id = ? AND clerk_user_id = ? AND status = 'active' AND role = 'professional'`,
        )
        .bind(input.now, input.tenantId, previous.clerkUserId)
        .run()
    } else if (old?.status === 'active' && old.role === 'attendant' && previous.alsoAttendant) {
      const otherLink = await db
        .prepare(
          `SELECT resource_id FROM professional_logins
           WHERE tenant_id = ? AND clerk_user_id = ? AND resource_id <> ?`,
        )
        .bind(input.tenantId, previous.clerkUserId, input.resourceId)
        .first<{ resource_id: string }>()
      if (!otherLink) {
        await db
          .prepare(
            `UPDATE tenant_memberships SET status = 'revoked', revoked_at = ?
             WHERE tenant_id = ? AND clerk_user_id = ? AND status = 'active' AND role = 'attendant'`,
          )
          .bind(input.now, input.tenantId, previous.clerkUserId)
          .run()
      }
    }
  }
  await db
    .prepare(
      `INSERT INTO professional_logins (
         tenant_id, resource_id, normalized_email, clerk_user_id, also_attendant
       ) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (tenant_id, resource_id) DO UPDATE SET
         normalized_email = excluded.normalized_email,
         clerk_user_id = excluded.clerk_user_id,
         also_attendant = excluded.also_attendant`,
    )
    .bind(input.tenantId, input.resourceId, email, bound, input.alsoAttendant ? 1 : 0)
    .run()

  const desired = input.alsoAttendant ? 'attendant' : 'professional'
  let membershipRole: string | null = null
  if (membership.role === 'owner') {
    membershipRole = 'owner'
  } else if (membership.role !== desired) {
    await db
      .prepare(
        `UPDATE tenant_memberships SET role = ?
         WHERE tenant_id = ? AND clerk_user_id = ? AND status = 'active'`,
      )
      .bind(desired, input.tenantId, bound)
      .run()
    membershipRole = desired
  } else {
    membershipRole = membership.role
  }
  const login = await d1GetProfessionalLogin(db, input.tenantId, input.resourceId)
  if (!login) throw new ConflictError('professional_login_missing', 'Vínculo não gravado')
  return { login, invitationSent: false, membershipRole }
}

export async function d1ReleaseProfessionalLogin(
  db: D1Database,
  input: { tenantId: string; resourceId: string; actorClerkUserId: string; now: number },
): Promise<{ revoked: boolean }> {
  await requireOwner(db, input.tenantId, input.actorClerkUserId)
  const row = await d1GetProfessionalLogin(db, input.tenantId, input.resourceId)
  if (!row) return { revoked: false }
  let revoked = false
  if (row.clerkUserId) {
    const updated = await db
      .prepare(
        `UPDATE tenant_memberships SET status = 'revoked', revoked_at = ?
         WHERE tenant_id = ? AND clerk_user_id = ? AND status = 'active' AND role = 'professional'`,
      )
      .bind(input.now, input.tenantId, row.clerkUserId)
      .run()
    revoked = (updated.meta.changes ?? 0) > 0
  }
  await db
    .prepare(`DELETE FROM professional_logins WHERE tenant_id = ? AND resource_id = ?`)
    .bind(input.tenantId, input.resourceId)
    .run()
  return { revoked }
}
