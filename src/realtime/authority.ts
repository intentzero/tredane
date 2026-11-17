/**
 * Leitura autoritativa de membership no D1 (ADR-0009).
 * Ausência/falha → deny / unavailable — nunca conceder por omissão.
 */
import { getMembershipAsync, getTenantAsync } from '../db/admin/async-queries'
import type { AsyncAdminDb } from '../db/admin/async-store'
import type { MembershipRole } from '../db/schema'
import type { AccessRevokeReason } from './protocol'

export type AccessDecision =
  | { status: 'allow'; role: MembershipRole }
  | { status: 'deny'; reason: AccessRevokeReason }
  | { status: 'unavailable' }

export type SupportSessionDecision =
  | { status: 'allow' }
  | { status: 'deny'; reason: AccessRevokeReason }
  | { status: 'unavailable' }

export type AccessAuthority = {
  checkMembership(tenantId: string, clerkUserId: string): Promise<AccessDecision>
  /** Sessão de suporte ainda ativa e dentro do prazo? Sem este método, uma ligação de suporte nunca é aceite. */
  checkSupportSession?(tenantId: string, supportSessionId: string, nowMs: number): Promise<SupportSessionDecision>
}

export function createD1AccessAuthority(adminDb: AsyncAdminDb): AccessAuthority {
  return {
    async checkMembership(tenantId, clerkUserId) {
      try {
        const tenant = await getTenantAsync(adminDb, tenantId)
        if (!tenant) return { status: 'deny', reason: 'not_member' }
        if (tenant.status !== 'active') {
          return { status: 'deny', reason: 'tenant_not_active' }
        }
        const membership = await getMembershipAsync(adminDb, tenantId, clerkUserId)
        if (!membership || membership.status !== 'active') {
          return { status: 'deny', reason: 'membership_revoked' }
        }
        return { status: 'allow', role: membership.role }
      } catch {
        return { status: 'unavailable' }
      }
    },
    async checkSupportSession(tenantId, supportSessionId, nowMs) {
      try {
        const row = await adminDb.get<{ status: string; expires_at: number; tenant_id: string }>(
          `SELECT status, expires_at, tenant_id FROM support_sessions WHERE id = ?`,
          supportSessionId,
        )
        if (!row || row.tenant_id !== tenantId) return { status: 'deny', reason: 'support_revoked' }
        if (row.status !== 'active') return { status: 'deny', reason: 'support_revoked' }
        if (Number(row.expires_at) <= nowMs) return { status: 'deny', reason: 'session_expired' }
        return { status: 'allow' }
      } catch {
        return { status: 'unavailable' }
      }
    },
  }
}

/** Authority estática para testes determinísticos. */
export function createMapAccessAuthority(
  grants: Map<string, MembershipRole | 'deny' | 'unavailable'>,
): AccessAuthority {
  return {
    async checkMembership(tenantId, clerkUserId) {
      const key = `${tenantId}:${clerkUserId}`
      const value = grants.get(key)
      if (value === undefined || value === 'deny') {
        return { status: 'deny', reason: 'membership_revoked' }
      }
      if (value === 'unavailable') return { status: 'unavailable' }
      return { status: 'allow', role: value }
    },
  }
}
