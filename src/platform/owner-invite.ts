/**
 * Convite da primeira owner emitido pelo superadmin (DEC-194, #842) — caminho do store síncrono.
 * O caminho D1 (produção) espelha-o em `src/team/d1-ops.ts`.
 */
import type { Clock } from '../db/clock'
import {
  cancelInvitation,
  createInvitation,
  createTenantWithOwnerInvitation,
  getInvitation,
  getTenant,
  NotFoundError,
  resendInvitation,
  type InvitationRow,
  type TenantRow,
} from '../db/admin'
import type { AdminDb } from '../db/admin/store'
import { deliverInvitationEmail, type EmailTransport } from '../email'

export type OwnerInviteServices = {
  db: AdminDb
  clock: Clock
  email: EmailTransport
  appBaseUrl: string
}

type Delivery = { emailSent: boolean; deliveryJobId: string }

/** O convite tem de ser desta clínica: a rota escopa por `:tenantId`, o DB só conhece o convite. */
function assertInvitationOfTenant(db: AdminDb, tenantId: string, invitationId: string): void {
  const inv = getInvitation(db, invitationId)
  if (!inv || inv.tenantId !== tenantId) {
    throw new NotFoundError('invitation_not_found', 'Convite inexistente')
  }
}

async function send(
  services: OwnerInviteServices,
  invitation: InvitationRow,
  rawToken: string,
  tenantName: string,
  actorClerkUserId: string,
): Promise<Delivery> {
  const delivery = await deliverInvitationEmail(services.db, services.clock, services.email, {
    invitationId: invitation.id,
    issuedAt: invitation.issuedAt,
    toEmail: invitation.normalizedEmail,
    tenantId: invitation.tenantId,
    tenantName,
    rawToken,
    expiresAt: invitation.expiresAt,
    appBaseUrl: services.appBaseUrl,
    actorClerkUserId,
    sendNow: true,
  })
  return { emailSent: delivery.sent, deliveryJobId: delivery.job.id }
}

export async function createClinicWithOwnerInvite(
  services: OwnerInviteServices,
  input: { id?: string; name: string; timezone?: string; ownerEmail: string; actorClerkUserId: string },
): Promise<{ tenant: TenantRow; invitation: InvitationRow } & Delivery> {
  const created = await createTenantWithOwnerInvitation(services.db, services.clock, input)
  const delivery = await send(
    services,
    created.invitation,
    created.rawToken,
    created.tenant.name,
    input.actorClerkUserId,
  )
  return { tenant: created.tenant, invitation: created.invitation, ...delivery }
}

/** Convite de owner novo para uma clínica existente (o anterior expirou ou foi cancelado). */
export async function inviteOwnerByEmail(
  services: OwnerInviteServices,
  input: { tenantId: string; email: string; actorClerkUserId: string },
): Promise<{ invitation: InvitationRow } & Delivery> {
  const tenant = getTenant(services.db, input.tenantId)
  if (!tenant) throw new NotFoundError('tenant_not_found', 'Tenant inexistente')
  const issued = await createInvitation(services.db, services.clock, {
    tenantId: input.tenantId,
    email: input.email,
    issuedByClerkUserId: input.actorClerkUserId,
    role: 'owner',
    asPlatformAdmin: true,
  })
  const delivery = await send(services, issued.invitation, issued.rawToken, tenant.name, input.actorClerkUserId)
  return { invitation: issued.invitation, ...delivery }
}

export async function resendOwnerInvite(
  services: OwnerInviteServices,
  input: { tenantId: string; invitationId: string; actorClerkUserId: string },
): Promise<{ invitation: InvitationRow } & Delivery> {
  assertInvitationOfTenant(services.db, input.tenantId, input.invitationId)
  const issued = await resendInvitation(services.db, services.clock, {
    invitationId: input.invitationId,
    actorClerkUserId: input.actorClerkUserId,
    asPlatformAdmin: true,
  })
  const tenant = getTenant(services.db, issued.invitation.tenantId)
  if (!tenant) throw new NotFoundError('tenant_not_found', 'Tenant inexistente')
  const delivery = await send(services, issued.invitation, issued.rawToken, tenant.name, input.actorClerkUserId)
  return { invitation: issued.invitation, ...delivery }
}

export function cancelOwnerInvite(
  services: OwnerInviteServices,
  input: { tenantId: string; invitationId: string; actorClerkUserId: string },
): InvitationRow {
  assertInvitationOfTenant(services.db, input.tenantId, input.invitationId)
  return cancelInvitation(services.db, services.clock, {
    invitationId: input.invitationId,
    actorClerkUserId: input.actorClerkUserId,
    asPlatformAdmin: true,
  })
}
