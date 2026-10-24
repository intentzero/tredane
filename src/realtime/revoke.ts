/**
 * Orquestração reutilizável D1 → DO (DEC-026 / ADR-0009).
 * Confirmação no D1 é o ponto de corte; sinal ao DO é best-effort + fence local.
 */
import type { Clock } from '../db/clock'
import {
  revokeMembership,
  type MembershipRow,
} from '../db/admin/memberships'
import { suspendTenant, type TenantRow } from '../db/admin/tenants'
import type { AdminDb } from '../db/admin/store'
import type { FenceSource } from './protocol'

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
): Promise<SuspendPropagationResult> {
  const tenant = suspendTenant(db, clock, input.tenantId, input.actorClerkUserId)
  const notified = await invalidator.applyTenantSuspended({
    tenantId: input.tenantId,
    source: input.source ?? 'tenant_suspend',
  })
  if (notified.ok) {
    return {
      tenant,
      doNotified: true,
      closedConnections: notified.closedConnections,
    }
  }
  return {
    tenant,
    doNotified: false,
    doError: notified.error,
    closedConnections: [],
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
  }
}
