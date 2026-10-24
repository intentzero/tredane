/**
 * Orquestração reutilizável D1 → DO (DEC-026 / ADR-0009).
 * Confirmação no D1 é o ponto de corte; sinal ao DO é best-effort + fence local.
 */
import type { Clock } from '../db/clock'
import {
  revokeMembership,
  type MembershipRow,
} from '../db/admin/memberships'
import type { TenantRow } from '../db/admin/tenants'
import {
  markTenantPendingDeletionLifecycle,
  reactivateTenantLifecycle,
  suspendTenantLifecycle,
} from '../db/admin/lifecycle'
import type { DeletionCommandRow } from '../db/admin/deletion-commands'
import type { AdminDb } from '../db/admin/store'
import type { FenceSource } from './protocol'
import { deletePushSubscriptionsForMember } from '../push/subscriptions'

export type ClinicAccessInvalidator = {
  applyUserFence(input: {
    tenantId: string
    clerkUserId: string
    reason: string
    source: FenceSource
  }): Promise<{ ok: true; closedConnections: string[] } | { ok: false; error: string }>

  applyTenantSuspended(input: {
    tenantId: string
    source: FenceSource
  }): Promise<{ ok: true; closedConnections: string[] } | { ok: false; error: string }>

  /** Limpa fence de suspensão no DO (reativação). Não restaura memberships. */
  applyTenantReactivated?(input: {
    tenantId: string
    source: FenceSource
  }): Promise<{ ok: true; closedConnections: string[] } | { ok: false; error: string }>
}

export type RevokePropagationResult = {
  membership: MembershipRow
  /** true se o DO confirmou o fence; false se falhou — D1 já está revogado. */
  doNotified: boolean
  doError?: string
  closedConnections: string[]
}

/**
 * Revoga membership attendant (ou owner se allowOwnerTarget) e propaga ao DO.
 * Falha de notificação NÃO reverte o D1 — HTTP/novo handshake já negam.
 */
export async function revokeMembershipAndPropagate(
  db: AdminDb,
  clock: Clock,
  invalidator: ClinicAccessInvalidator,
  input: {
    tenantId: string
    clerkUserId: string
    actorClerkUserId: string
    allowOwnerTarget?: boolean
    source?: FenceSource
  },
): Promise<RevokePropagationResult> {
  const membership = revokeMembership(db, clock, {
    tenantId: input.tenantId,
    clerkUserId: input.clerkUserId,
    actorClerkUserId: input.actorClerkUserId,
    allowOwnerTarget: input.allowOwnerTarget,
  })

  // #42 — corta push do par user×tenant no ponto de corte D1 (DEC-026).
  try {
    deletePushSubscriptionsForMember(db, input.tenantId, input.clerkUserId)
  } catch {
    // Schema antigo em testes pontuais — fail-open no cleanup de push.
  }

  const source = input.source ?? 'membership_revoke'
  const notified = await invalidator.applyUserFence({
    tenantId: input.tenantId,
    clerkUserId: input.clerkUserId,
    reason: 'membership_revoked',
    source,
  })

  if (notified.ok) {
    return {
      membership,
      doNotified: true,
      closedConnections: notified.closedConnections,
    }
  }
  return {
    membership,
    doNotified: false,
    doError: notified.error,
    closedConnections: [],
  }
}

export type SuspendPropagationResult = {
  tenant: TenantRow
  doNotified: boolean
  doError?: string
  closedConnections: string[]
}

export async function suspendTenantAndPropagate(
  db: AdminDb,
  clock: Clock,
  invalidator: ClinicAccessInvalidator,
  input: {
    tenantId: string
    actorClerkUserId: string
    source?: FenceSource
  },
): Promise<SuspendPropagationResult & {
  revokedSupportSessionIds: string[]
  cancelledSupportRequestIds: string[]
}> {
  const lifecycle = suspendTenantLifecycle(
    db,
    clock,
    input.tenantId,
    input.actorClerkUserId,
  )
  const notified = await invalidator.applyTenantSuspended({
    tenantId: input.tenantId,
    source: input.source ?? 'tenant_suspend',
  })
  if (notified.ok) {
    return {
      tenant: lifecycle.tenant,
      doNotified: true,
      closedConnections: notified.closedConnections,
      revokedSupportSessionIds: lifecycle.revokedSupportSessionIds,
      cancelledSupportRequestIds: lifecycle.cancelledSupportRequestIds,
    }
  }
  return {
    tenant: lifecycle.tenant,
    doNotified: false,
    doError: notified.error,
    closedConnections: [],
    revokedSupportSessionIds: lifecycle.revokedSupportSessionIds,
    cancelledSupportRequestIds: lifecycle.cancelledSupportRequestIds,
  }
}

export type ReactivatePropagationResult = {
  tenant: TenantRow
  doNotified: boolean
  doError?: string
  preservedRevokedMemberships: number
  preservedRevokedSupport: number
}

export async function reactivateTenantAndPropagate(
  db: AdminDb,
  clock: Clock,
  invalidator: ClinicAccessInvalidator,
  input: {
    tenantId: string
    actorClerkUserId: string
    source?: FenceSource
  },
): Promise<ReactivatePropagationResult> {
  const lifecycle = reactivateTenantLifecycle(
    db,
    clock,
    input.tenantId,
    input.actorClerkUserId,
  )
  const clear = invalidator.applyTenantReactivated
  if (!clear) {
    return {
      tenant: lifecycle.tenant,
      doNotified: false,
      doError: 'reactivate_not_supported',
      preservedRevokedMemberships: lifecycle.preservedRevokedMemberships,
      preservedRevokedSupport: lifecycle.preservedRevokedSupport,
    }
  }
  const notified = await clear({
    tenantId: input.tenantId,
    source: input.source ?? 'tenant_reactivate',
  })
  if (notified.ok) {
    return {
      tenant: lifecycle.tenant,
      doNotified: true,
      preservedRevokedMemberships: lifecycle.preservedRevokedMemberships,
      preservedRevokedSupport: lifecycle.preservedRevokedSupport,
    }
  }
  return {
    tenant: lifecycle.tenant,
    doNotified: false,
    doError: notified.error,
    preservedRevokedMemberships: lifecycle.preservedRevokedMemberships,
    preservedRevokedSupport: lifecycle.preservedRevokedSupport,
  }
}

export type PendingDeletionPropagationResult = {
  tenant: TenantRow
  deletionCommand: DeletionCommandRow
  doNotified: boolean
  doError?: string
  closedConnections: string[]
  revokedSupportSessionIds: string[]
  cancelledSupportRequestIds: string[]
}

export async function markPendingDeletionAndPropagate(
  db: AdminDb,
  clock: Clock,
  invalidator: ClinicAccessInvalidator,
  input: {
    tenantId: string
    actorClerkUserId: string
    source?: FenceSource
  },
): Promise<PendingDeletionPropagationResult> {
  const lifecycle = markTenantPendingDeletionLifecycle(
    db,
    clock,
    input.tenantId,
    input.actorClerkUserId,
  )
  const notified = await invalidator.applyTenantSuspended({
    tenantId: input.tenantId,
    source: input.source ?? 'tenant_pending_deletion',
  })
  if (notified.ok) {
    return {
      tenant: lifecycle.tenant,
      deletionCommand: lifecycle.deletionCommand!,
      doNotified: true,
      closedConnections: notified.closedConnections,
      revokedSupportSessionIds: lifecycle.revokedSupportSessionIds,
      cancelledSupportRequestIds: lifecycle.cancelledSupportRequestIds,
    }
  }
  return {
    tenant: lifecycle.tenant,
    deletionCommand: lifecycle.deletionCommand!,
    doNotified: false,
    doError: notified.error,
    closedConnections: [],
    revokedSupportSessionIds: lifecycle.revokedSupportSessionIds,
    cancelledSupportRequestIds: lifecycle.cancelledSupportRequestIds,
  }
}

/** Invalidator no-op para testes de falha de notificação DO. */
export function createFailingInvalidator(
  error = 'do_notify_failed',
): ClinicAccessInvalidator {
  return {
    async applyUserFence() {
      return { ok: false, error }
    },
    async applyTenantSuspended() {
      return { ok: false, error }
    },
    async applyTenantReactivated() {
      return { ok: false, error }
    },
  }
}
