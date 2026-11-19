/**
 * Vínculo da ficha de profissional (recurso da agenda no DO) com o login (D1).
 * DEC-204 / REQ-118.
 */
import type { Clock } from '../db/clock'
import {
  ConflictError,
  cancelInvitation,
  createInvitation,
  getMembership,
  getTenant,
  requireActiveOwner,
  revokeMembership,
  upsertMembershipInTx,
  writeAudit,
} from '../db/admin'
import { normalizeEmail } from '../db/admin/ids'
import type { MembershipRole } from '../db/schema'
import type { AdminDb } from '../db/admin/store'
import { deliverInvitationEmail, type EmailTransport } from '../email'

export type ProfessionalLoginRow = {
  tenantId: string
  resourceId: string
  email: string
  clerkUserId: string | null
  alsoAttendant: boolean
}

type LoginSql = {
  tenant_id: string
  resource_id: string
  normalized_email: string
  clerk_user_id: string | null
  also_attendant: number
}

function mapRow(row: LoginSql): ProfessionalLoginRow {
  return {
    tenantId: row.tenant_id,
    resourceId: row.resource_id,
    email: row.normalized_email,
    clerkUserId: row.clerk_user_id,
    alsoAttendant: row.also_attendant === 1,
  }
}

export function getProfessionalLogin(
  db: AdminDb,
  tenantId: string,
  resourceId: string,
): ProfessionalLoginRow | null {
  const row = db.get<LoginSql>(
    `SELECT tenant_id, resource_id, normalized_email, clerk_user_id, also_attendant
     FROM professional_logins WHERE tenant_id = ? AND resource_id = ?`,
    tenantId,
    resourceId,
  )
  return row ? mapRow(row) : null
}

export function professionalResourceIdForUser(
  db: AdminDb,
  tenantId: string,
  clerkUserId: string,
): string | null {
  const row = db.get<{ resource_id: string }>(
    `SELECT resource_id FROM professional_logins
     WHERE tenant_id = ? AND clerk_user_id = ?`,
    tenantId,
    clerkUserId,
  )
  return row?.resource_id ?? null
}

function desiredRole(alsoAttendant: boolean): 'attendant' | 'professional' {
  return alsoAttendant ? 'attendant' : 'professional'
}

function alignMembership(
  db: AdminDb,
  clock: Clock,
  input: {
    tenantId: string
    clerkUserId: string
    alsoAttendant: boolean
    actorClerkUserId: string
  },
): MembershipRole {
  const desired = desiredRole(input.alsoAttendant)
  return db.immediate(() => {
    const current = getMembership(db, input.tenantId, input.clerkUserId)
    if (!current || current.status !== 'active') {
      const row = upsertMembershipInTx(db, clock, {
        tenantId: input.tenantId,
        clerkUserId: input.clerkUserId,
        role: desired,
        actorClerkUserId: input.actorClerkUserId,
      })
      return row.role
    }
    if (current.role === 'owner' || current.role === desired) return current.role
    db.run(
      `UPDATE tenant_memberships SET role = ?
       WHERE tenant_id = ? AND clerk_user_id = ? AND status = 'active'`,
      desired,
      input.tenantId,
      input.clerkUserId,
    )
    writeAudit(db, clock, {
      actorClerkUserId: input.actorClerkUserId,
      subjectClerkUserId: input.clerkUserId,
      tenantId: input.tenantId,
      action: 'membership.role',
      objectType: 'tenant_membership',
      objectId: `${input.tenantId}:${input.clerkUserId}`,
      outcome: 'success',
      metadata: { from: current.role, to: desired, via: 'professional_login' },
    })
    return desired
  })
}

export async function linkProfessionalLogin(
  db: AdminDb,
  clock: Clock,
  emailTransport: EmailTransport,
  appBaseUrl: string,
  input: {
    tenantId: string
    resourceId: string
    email: string
    alsoAttendant: boolean
    actorClerkUserId: string
    boundClerkUserId?: string | null
  },
): Promise<{
  login: ProfessionalLoginRow
  invitationSent: boolean
  membershipRole: MembershipRole | null
}> {
  requireActiveOwner(db, input.tenantId, input.actorClerkUserId)
  const email = normalizeEmail(input.email)
  if (!email.includes('@')) {
    throw new ConflictError('email_invalid', 'E-mail inválido')
  }
  const other = db.get<{ resource_id: string }>(
    `SELECT resource_id FROM professional_logins
     WHERE tenant_id = ? AND normalized_email = ? AND resource_id <> ?`,
    input.tenantId,
    email,
    input.resourceId,
  )
  if (other) {
    throw new ConflictError(
      'professional_email_taken',
      'Este e-mail já está ligado a outra profissional',
    )
  }

  const previous = getProfessionalLogin(db, input.tenantId, input.resourceId)
  const bound = input.boundClerkUserId?.trim() || null
  if (previous?.clerkUserId && previous.clerkUserId !== bound && previous.email !== email) {
    const old = getMembership(db, input.tenantId, previous.clerkUserId)
    if (old?.status === 'active' && old.role === 'professional') {
      revokeMembership(db, clock, {
        tenantId: input.tenantId,
        clerkUserId: previous.clerkUserId,
        actorClerkUserId: input.actorClerkUserId,
      })
    }
  }

  db.run(
    `INSERT INTO professional_logins (
       tenant_id, resource_id, normalized_email, clerk_user_id, also_attendant
     ) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (tenant_id, resource_id) DO UPDATE SET
       normalized_email = excluded.normalized_email,
       clerk_user_id = excluded.clerk_user_id,
       also_attendant = excluded.also_attendant`,
    input.tenantId,
    input.resourceId,
    email,
    bound,
    input.alsoAttendant ? 1 : 0,
  )

  let membershipRole: MembershipRole | null = null
  let invitationSent = false
  if (bound) {
    membershipRole = alignMembership(db, clock, {
      tenantId: input.tenantId,
      clerkUserId: bound,
      alsoAttendant: input.alsoAttendant,
      actorClerkUserId: input.actorClerkUserId,
    })
  } else {
    const role = desiredRole(input.alsoAttendant)
    const pending = db.get<{ id: string; role: string }>(
      `SELECT id, role FROM tenant_invitations
       WHERE tenant_id = ? AND normalized_email = ? AND status = 'pending'`,
      input.tenantId,
      email,
    )
    if (pending && pending.role !== role) {
      cancelInvitation(db, clock, {
        invitationId: pending.id,
        actorClerkUserId: input.actorClerkUserId,
      })
    }
    if (!pending || pending.role !== role) {
      const tenant = getTenant(db, input.tenantId)
      if (!tenant) throw new ConflictError('tenant_not_found', 'Tenant inexistente')
      const issued = await createInvitation(db, clock, {
        tenantId: input.tenantId,
        email,
        issuedByClerkUserId: input.actorClerkUserId,
        role,
      })
      await deliverInvitationEmail(db, clock, emailTransport, {
        invitationId: issued.invitation.id,
        issuedAt: issued.invitation.issuedAt,
        toEmail: issued.invitation.normalizedEmail,
        tenantId: input.tenantId,
        tenantName: tenant.name,
        rawToken: issued.rawToken,
        expiresAt: issued.invitation.expiresAt,
        appBaseUrl,
        actorClerkUserId: input.actorClerkUserId,
        sendNow: true,
      })
      invitationSent = true
    }
  }

  return {
    login: getProfessionalLogin(db, input.tenantId, input.resourceId)!,
    invitationSent,
    membershipRole,
  }
}

/** Corta o login só quando a conta não é também atendente ou responsável. */
export function releaseProfessionalLogin(
  db: AdminDb,
  clock: Clock,
  input: { tenantId: string; resourceId: string; actorClerkUserId: string },
): { revoked: boolean } {
  requireActiveOwner(db, input.tenantId, input.actorClerkUserId)
  const row = getProfessionalLogin(db, input.tenantId, input.resourceId)
  if (!row?.clerkUserId) return { revoked: false }
  const membership = getMembership(db, input.tenantId, row.clerkUserId)
  if (membership?.status === 'active' && membership.role === 'professional') {
    revokeMembership(db, clock, {
      tenantId: input.tenantId,
      clerkUserId: row.clerkUserId,
      actorClerkUserId: input.actorClerkUserId,
    })
    return { revoked: true }
  }
  return { revoked: false }
}
