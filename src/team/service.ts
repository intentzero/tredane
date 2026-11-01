/**
 * Orquestração Equipe + convites (#25): D1 + e-mail + (remoção via realtime).
 */
import type { Clock } from '../db/clock'
import {
  acceptInvitation,
  cancelInvitation,
  createInvitation,
  listMembersForTenant,
  listPendingInvitationsForTenant,
  resendInvitation,
  getTenant,
  type InvitationRow,
  type IssuedInvitation,
  type MembershipRow,
  ConflictError,
  NotFoundError,
} from '../db/admin'
import type { AdminDb } from '../db/admin/store'
import { deliverInvitationEmail, type EmailTransport } from '../email'
import { INVITATION_RESEND_WINDOW_MS } from '../db/admin/constants'

export type TeamServices = {
  db: AdminDb
  clock: Clock
  email: EmailTransport
  appBaseUrl: string
}

export function countResendsInWindow(
  db: AdminDb,
  tenantId: string,
  normalizedEmail: string,
  nowMs: number,
): number {
  const windowStart = nowMs - INVITATION_RESEND_WINDOW_MS
  const row = db.get<{ n: number }>(
    `SELECT COUNT(*) AS n FROM tenant_invitation_resends
     WHERE tenant_id = ? AND normalized_email = ? AND resent_at >= ?`,
    tenantId,
    normalizedEmail,
    windowStart,
  )
  return row?.n ?? 0
}

export function loadTeamSnapshot(
  services: TeamServices,
  tenantId: string,
): {
  members: MembershipRow[]
  invitations: InvitationRow[]
  resendCounts: Map<string, number>
} {
  const now = services.clock.nowMs()
  const members = listMembersForTenant(services.db, tenantId, { includeRevoked: false })
  const invitations = listPendingInvitationsForTenant(services.db, tenantId)
  const resendCounts = new Map<string, number>()
  for (const inv of invitations) {
    resendCounts.set(
      inv.id,
      countResendsInWindow(services.db, inv.tenantId, inv.normalizedEmail, now),
    )
  }
  return { members, invitations, resendCounts }
}

export async function inviteAttendant(
  services: TeamServices,
  input: {
    tenantId: string
    email: string
    issuedByClerkUserId: string
    role?: 'owner' | 'attendant'
  },
): Promise<{
  issued: IssuedInvitation
  emailSent: boolean
  deliveryJobId: string
}> {
  const tenant = getTenant(services.db, input.tenantId)
  if (!tenant || tenant.status !== 'active') {
    throw new NotFoundError('tenant_not_found', 'Tenant inexistente ou inativo')
  }

  const issued = await createInvitation(services.db, services.clock, {
    tenantId: input.tenantId,
    email: input.email,
    issuedByClerkUserId: input.issuedByClerkUserId,
    role: input.role === 'owner' ? 'owner' : 'attendant',
  })

  const delivery = await deliverInvitationEmail(
    services.db,
    services.clock,
    services.email,
    {
      invitationId: issued.invitation.id,
      issuedAt: issued.invitation.issuedAt,
      toEmail: issued.invitation.normalizedEmail,
      tenantId: input.tenantId,
      tenantName: tenant.name,
      rawToken: issued.rawToken,
      expiresAt: issued.invitation.expiresAt,
      appBaseUrl: services.appBaseUrl,
      actorClerkUserId: input.issuedByClerkUserId,
      sendNow: true,
    },
  )

  return {
    issued,
    emailSent: delivery.sent,
    deliveryJobId: delivery.job.id,
  }
}

export async function resendAttendantInvite(
  services: TeamServices,
  input: {
    invitationId: string
    actorClerkUserId: string
  },
): Promise<{
  issued: IssuedInvitation
  emailSent: boolean
  deliveryJobId: string
}> {
  const issued = await resendInvitation(services.db, services.clock, input)
  const tenant = getTenant(services.db, issued.invitation.tenantId)
  if (!tenant) {
    throw new NotFoundError('tenant_not_found', 'Tenant inexistente')
  }

  const delivery = await deliverInvitationEmail(
    services.db,
    services.clock,
    services.email,
    {
      invitationId: issued.invitation.id,
      issuedAt: issued.invitation.issuedAt,
      toEmail: issued.invitation.normalizedEmail,
      tenantId: issued.invitation.tenantId,
      tenantName: tenant.name,
      rawToken: issued.rawToken,
      expiresAt: issued.invitation.expiresAt,
      appBaseUrl: services.appBaseUrl,
      actorClerkUserId: input.actorClerkUserId,
      sendNow: true,
    },
  )

  return {
    issued,
    emailSent: delivery.sent,
    deliveryJobId: delivery.job.id,
  }
}

export function cancelAttendantInvite(
  services: TeamServices,
  input: { invitationId: string; actorClerkUserId: string },
): InvitationRow {
  return cancelInvitation(services.db, services.clock, input)
}

export async function acceptAttendantInvite(
  services: TeamServices,
  input: {
    rawToken: string
    acceptorClerkUserId: string
    verifiedEmail: string
  },
): Promise<{ invitation: InvitationRow }> {
  return acceptInvitation(services.db, services.clock, input)
}

/** Preview de convite por id (sem token) — para hints de cooldown em erros. */
export function peekInvitation(
  db: AdminDb,
  invitationId: string,
): InvitationRow | undefined {
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
    invitationId,
  )
  if (!row) return undefined
  return {
    id: row.id,
    tenantId: row.tenant_id,
    normalizedEmail: row.normalized_email,
    role: row.role === 'owner' ? 'owner' : 'attendant',
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

export { ConflictError }
