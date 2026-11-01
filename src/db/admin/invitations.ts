import type { Clock } from '../clock'
import { generateOpaqueToken, hashToken } from '../tokens'
import { writeAudit } from './audit'
import {
  INVITATION_RESEND_COOLDOWN_MS,
  INVITATION_RESEND_MAX,
  INVITATION_RESEND_WINDOW_MS,
  INVITATION_TTL_MS,
} from './constants'
import { ConflictError, NotFoundError } from './errors'
import { assertAdminSchemaReady } from './gate'
import { newId, normalizeEmail } from './ids'
import type { MembershipRole } from '../schema'
import { requireActiveOwner, upsertMembershipInTx } from './memberships'
import type { AdminDb } from './store'

export type InvitationRole = Extract<MembershipRole, 'owner' | 'attendant'>

export type InvitationRow = {
  id: string
  tenantId: string
  normalizedEmail: string
  role: InvitationRole
  issuedByClerkUserId: string
  status: 'pending' | 'accepted' | 'cancelled' | 'expired'
  issuedAt: number
  expiresAt: number
  acceptedAt: number | null
  acceptedByClerkUserId: string | null
  cancelledAt: number | null
  cancelledByClerkUserId: string | null
  lastResentAt: number | null
}

function mapInvitationRole(role: string): InvitationRole {
  return role === 'owner' ? 'owner' : 'attendant'
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

function getInvitation(db: AdminDb, id: string): InvitationRow | undefined {
  const row = db.get<{
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
  }>(
    `SELECT id, tenant_id, normalized_email, role, issued_by_clerk_user_id, status,
            issued_at, expires_at, accepted_at, accepted_by_clerk_user_id,
            cancelled_at, cancelled_by_clerk_user_id, last_resent_at
     FROM tenant_invitations WHERE id = ?`,
    id,
  )
  return row ? mapInvitation(row) : undefined
}

export type IssuedInvitation = {
  invitation: InvitationRow
  /** Única vez em que o token em claro é devolvido ao caller (e-mail). Nunca auditar/logar. */
  rawToken: string
}

export async function createInvitation(
  db: AdminDb,
  clock: Clock,
  input: {
    tenantId: string
    email: string
    issuedByClerkUserId: string
    /** DEC-103: default attendant; owner permitido na Equipe. */
    role?: InvitationRole
  },
): Promise<IssuedInvitation> {
  assertAdminSchemaReady(db)
  requireActiveOwner(db, input.tenantId, input.issuedByClerkUserId)
  const role: InvitationRole = input.role === 'owner' ? 'owner' : 'attendant'
  const now = clock.nowMs()
  const email = normalizeEmail(input.email)
  const rawToken = generateOpaqueToken()
  const tokenHash = await hashToken(rawToken)
  const id = newId('inv')

  return db.immediate(() => {
    const pending = db.get<{ id: string }>(
      `SELECT id FROM tenant_invitations
       WHERE tenant_id = ? AND normalized_email = ? AND status = 'pending'`,
      input.tenantId,
      email,
    )
    if (pending) {
      throw new ConflictError('invitation_already_pending', 'Já existe convite pendente para este e-mail')
    }

    db.run(
      `INSERT INTO tenant_invitations (
        id, tenant_id, normalized_email, role, issued_by_clerk_user_id, token_hash,
        status, issued_at, expires_at, accepted_at, accepted_by_clerk_user_id,
        cancelled_at, cancelled_by_clerk_user_id, last_resent_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, NULL, NULL, NULL, NULL, NULL)`,
      id,
      input.tenantId,
      email,
      role,
      input.issuedByClerkUserId,
      tokenHash,
      now,
      now + INVITATION_TTL_MS,
    )

    writeAudit(db, clock, {
      actorClerkUserId: input.issuedByClerkUserId,
      tenantId: input.tenantId,
      action: 'invitation.create',
      objectType: 'tenant_invitation',
      objectId: id,
      outcome: 'success',
      metadata: { email, role },
    })

    return { invitation: getInvitation(db, id)!, rawToken }
  })
}

/**
 * DEC-023/024: rotação atómica do token com cooldown/quota.
 * Em limite, não invalida o link vigente.
 */
export async function resendInvitation(
  db: AdminDb,
  clock: Clock,
  input: {
    invitationId: string
    actorClerkUserId: string
  },
): Promise<IssuedInvitation> {
  assertAdminSchemaReady(db)
  const now = clock.nowMs()

  // Leitura prévia só para autorizar owner; a rotação é condicional na transação.
  const preview = getInvitation(db, input.invitationId)
  if (!preview) throw new NotFoundError('invitation_not_found', 'Convite inexistente')
  requireActiveOwner(db, preview.tenantId, input.actorClerkUserId)

  const rawToken = generateOpaqueToken()
  const tokenHash = await hashToken(rawToken)

  return db.immediate(() => {
    const current = getInvitation(db, input.invitationId)
    if (!current || current.status !== 'pending') {
      throw new ConflictError('invitation_not_pending', 'Convite não está pendente')
    }
    if (now >= current.expiresAt) {
      db.run(
        `UPDATE tenant_invitations SET status = 'expired' WHERE id = ? AND status = 'pending'`,
        current.id,
      )
      throw new ConflictError('invitation_expired', 'Convite expirado')
    }

    if (
      current.lastResentAt !== null
      && now - current.lastResentAt < INVITATION_RESEND_COOLDOWN_MS
    ) {
      throw new ConflictError('invitation_resend_cooldown', 'Aguarde o cooldown de 10 minutos')
    }

    const windowStart = now - INVITATION_RESEND_WINDOW_MS
    const countRow = db.get<{ n: number }>(
      `SELECT COUNT(*) AS n FROM tenant_invitation_resends
       WHERE tenant_id = ? AND normalized_email = ? AND resent_at >= ?`,
      current.tenantId,
      current.normalizedEmail,
      windowStart,
    )
    if ((countRow?.n ?? 0) >= INVITATION_RESEND_MAX) {
      throw new ConflictError('invitation_resend_quota', 'Quota de 5 reenvios/24h excedida')
    }

    const rotated = db.run(
      `UPDATE tenant_invitations
       SET token_hash = ?, issued_at = ?, expires_at = ?, last_resent_at = ?
       WHERE id = ? AND status = 'pending'`,
      tokenHash,
      now,
      now + INVITATION_TTL_MS,
      now,
      current.id,
    )
    if (rotated.changes !== 1) {
      throw new ConflictError('invitation_rotate_conflict', 'Rotação concorrente falhou')
    }

    db.run(
      `INSERT INTO tenant_invitation_resends (
        id, invitation_id, tenant_id, normalized_email, resent_by_clerk_user_id, resent_at
      ) VALUES (?, ?, ?, ?, ?, ?)`,
      newId('res'),
      current.id,
      current.tenantId,
      current.normalizedEmail,
      input.actorClerkUserId,
      now,
    )

    writeAudit(db, clock, {
      actorClerkUserId: input.actorClerkUserId,
      tenantId: current.tenantId,
      action: 'invitation.resend',
      objectType: 'tenant_invitation',
      objectId: current.id,
      outcome: 'success',
      metadata: { email: current.normalizedEmail },
    })

    return { invitation: getInvitation(db, current.id)!, rawToken }
  })
}

export function cancelInvitation(
  db: AdminDb,
  clock: Clock,
  input: { invitationId: string; actorClerkUserId: string },
): InvitationRow {
  assertAdminSchemaReady(db)
  const preview = getInvitation(db, input.invitationId)
  if (!preview) throw new NotFoundError('invitation_not_found', 'Convite inexistente')
  requireActiveOwner(db, preview.tenantId, input.actorClerkUserId)
  const now = clock.nowMs()

  return db.immediate(() => {
    const result = db.run(
      `UPDATE tenant_invitations
       SET status = 'cancelled', cancelled_at = ?, cancelled_by_clerk_user_id = ?
       WHERE id = ? AND status = 'pending'`,
      now,
      input.actorClerkUserId,
      input.invitationId,
    )
    if (result.changes !== 1) {
      throw new ConflictError('invitation_cancel_conflict', 'Cancelamento não aplicado')
    }
    writeAudit(db, clock, {
      actorClerkUserId: input.actorClerkUserId,
      tenantId: preview.tenantId,
      action: 'invitation.cancel',
      objectType: 'tenant_invitation',
      objectId: input.invitationId,
      outcome: 'success',
      metadata: { email: preview.normalizedEmail },
    })
    return getInvitation(db, input.invitationId)!
  })
}

/**
 * Consome token (hash) + cria membership com a role do convite (DEC-021 / DEC-103).
 * Role no body do cliente é ignorada — só a persistida no D1.
 * Dois consumos concorrentes: só um obtém changes=1.
 */
export async function acceptInvitation(
  db: AdminDb,
  clock: Clock,
  input: {
    rawToken: string
    acceptorClerkUserId: string
    /** E-mail verificado no Clerk — comparado ao convite. */
    verifiedEmail: string
  },
): Promise<{ invitation: InvitationRow }> {
  assertAdminSchemaReady(db)
  const now = clock.nowMs()
  const tokenHash = await hashToken(input.rawToken)
  const email = normalizeEmail(input.verifiedEmail)

  return db.immediate(() => {
    const row = db.get<{
      id: string
      tenant_id: string
      normalized_email: string
      role: string
      status: string
      expires_at: number
    }>(
      `SELECT id, tenant_id, normalized_email, role, status, expires_at
       FROM tenant_invitations WHERE token_hash = ?`,
      tokenHash,
    )
    if (!row || row.status !== 'pending') {
      throw new ConflictError('invitation_token_invalid', 'Token inválido ou já usado')
    }
    if (now >= row.expires_at) {
      db.run(
        `UPDATE tenant_invitations SET status = 'expired' WHERE id = ? AND status = 'pending'`,
        row.id,
      )
      throw new ConflictError('invitation_expired', 'Convite expirado')
    }
    if (row.normalized_email !== email) {
      throw new ConflictError('invitation_email_mismatch', 'E-mail verificado não corresponde')
    }

    const consumed = db.run(
      `UPDATE tenant_invitations
       SET status = 'accepted', accepted_at = ?, accepted_by_clerk_user_id = ?
       WHERE id = ? AND status = 'pending' AND token_hash = ?`,
      now,
      input.acceptorClerkUserId,
      row.id,
      tokenHash,
    )
    if (consumed.changes !== 1) {
      throw new ConflictError('invitation_accept_conflict', 'Aceite concorrente negado')
    }

    const role = mapInvitationRole(row.role)
    upsertMembershipInTx(db, clock, {
      tenantId: row.tenant_id,
      clerkUserId: input.acceptorClerkUserId,
      role,
      actorClerkUserId: input.acceptorClerkUserId,
    })

    writeAudit(db, clock, {
      actorClerkUserId: input.acceptorClerkUserId,
      subjectClerkUserId: input.acceptorClerkUserId,
      tenantId: row.tenant_id,
      action: 'invitation.accept',
      objectType: 'tenant_invitation',
      objectId: row.id,
      outcome: 'success',
      metadata: { email, role },
    })

    return { invitation: getInvitation(db, row.id)! }
  })
}

/** Expõe só metadados — nunca token_hash — para consultas administrativas escopadas. */
export function listPendingInvitationsForTenant(db: AdminDb, tenantId: string): InvitationRow[] {
  assertAdminSchemaReady(db)
  const rows = db.all<{
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
  }>(
    `SELECT id, tenant_id, normalized_email, role, issued_by_clerk_user_id, status,
            issued_at, expires_at, accepted_at, accepted_by_clerk_user_id,
            cancelled_at, cancelled_by_clerk_user_id, last_resent_at
     FROM tenant_invitations
     WHERE tenant_id = ? AND status = 'pending'
     ORDER BY issued_at DESC`,
    tenantId,
  )
  return rows.map(mapInvitation)
}
