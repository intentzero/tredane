import type { DeletionCommandRow } from '../db/admin/deletion-commands'
import type { MembershipRow } from '../db/admin/memberships'
import type { TenantRow } from '../db/admin/tenants'
import type { TenantIntegrationStatus } from './integration-status'

export function serializeTenant(t: TenantRow) {
  return {
    id: t.id,
    name: t.name,
    timezone: t.timezone,
    status: t.status,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
    suspendedAt: t.suspendedAt,
    pendingDeletionAt: t.pendingDeletionAt,
  }
}

export function serializeMembership(m: MembershipRow) {
  return {
    tenantId: m.tenantId,
    clerkUserId: m.clerkUserId,
    role: m.role,
    status: m.status,
    createdAt: m.createdAt,
    revokedAt: m.revokedAt,
  }
}

export function serializeDeletionCommand(c: DeletionCommandRow) {
  return {
    id: c.id,
    tenantId: c.tenantId,
    status: c.status,
    requestedByClerkUserId: c.requestedByClerkUserId,
    requestedAt: c.requestedAt,
    updatedAt: c.updatedAt,
  }
}

export function serializeAdminTenantView(input: {
  tenant: TenantRow
  members: MembershipRow[]
  integration: TenantIntegrationStatus
  deletionCommand?: DeletionCommandRow | null
  recentAudit: Array<{
    id: string
    action: string
    outcome: string
    occurredAt: number
    actorClerkUserId: string
    subjectClerkUserId: string | null
  }>
}) {
  return {
    tenant: serializeTenant(input.tenant),
    members: input.members.map(serializeMembership),
    owners: input.members
      .filter((m) => m.role === 'owner' && m.status === 'active')
      .map(serializeMembership),
    integration: input.integration,
    deletionCommand: input.deletionCommand
      ? serializeDeletionCommand(input.deletionCommand)
      : null,
    recentAudit: input.recentAudit.map((e) => ({
      id: e.id,
      action: e.action,
      outcome: e.outcome,
      occurredAt: e.occurredAt,
      actorClerkUserId: e.actorClerkUserId,
      subjectClerkUserId: e.subjectClerkUserId,
    })),
    /** Explicitamente ausente: sem conversas, mensagens ou agenda. */
    clinicalAccess: false as const,
  }
}
