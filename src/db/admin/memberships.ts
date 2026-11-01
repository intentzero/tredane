import type { Clock } from '../clock'
import type { MembershipRole, MembershipStatus } from '../schema'
import { writeAudit } from './audit'
import { ConflictError, ForbiddenError, NotFoundError } from './errors'
import { assertAdminSchemaReady } from './gate'
import type { AdminDb } from './store'
import { getTenant } from './tenants'

export type MembershipRow = {
  tenantId: string
  clerkUserId: string
  role: MembershipRole
  status: MembershipStatus
  createdAt: number
  revokedAt: number | null
}

function mapMembership(row: {
  tenant_id: string
  clerk_user_id: string
  role: string
  status: string
  created_at: number
  revoked_at: number | null
}): MembershipRow {
  return {
    tenantId: row.tenant_id,
    clerkUserId: row.clerk_user_id,
    role: row.role as MembershipRole,
    status: row.status as MembershipStatus,
    createdAt: row.created_at,
    revokedAt: row.revoked_at,
  }
}

export function getMembership(
  db: AdminDb,
  tenantId: string,
  clerkUserId: string,
): MembershipRow | undefined {
  assertAdminSchemaReady(db)
  const row = db.get<{
    tenant_id: string
    clerk_user_id: string
    role: string
    status: string
    created_at: number
    revoked_at: number | null
  }>(
    `SELECT tenant_id, clerk_user_id, role, status, created_at, revoked_at
     FROM tenant_memberships
     WHERE tenant_id = ? AND clerk_user_id = ?`,
    tenantId,
    clerkUserId,
  )
  return row ? mapMembership(row) : undefined
}

export function listActiveMembershipsForUser(db: AdminDb, clerkUserId: string): MembershipRow[] {
  assertAdminSchemaReady(db)
  const rows = db.all<{
    tenant_id: string
    clerk_user_id: string
    role: string
    status: string
    created_at: number
    revoked_at: number | null
  }>(
    `SELECT m.tenant_id, m.clerk_user_id, m.role, m.status, m.created_at, m.revoked_at
     FROM tenant_memberships m
     INNER JOIN tenants t ON t.id = m.tenant_id
     WHERE m.clerk_user_id = ? AND m.status = 'active' AND t.status = 'active'
     ORDER BY m.tenant_id`,
    clerkUserId,
  )
  return rows.map(mapMembership)
}

export function listMembersForTenant(
  db: AdminDb,
  tenantId: string,
  opts: { includeRevoked?: boolean } = {},
): MembershipRow[] {
  assertAdminSchemaReady(db)
  const rows = opts.includeRevoked
    ? db.all<{
      tenant_id: string
      clerk_user_id: string
      role: string
      status: string
      created_at: number
      revoked_at: number | null
    }>(
      `SELECT tenant_id, clerk_user_id, role, status, created_at, revoked_at
       FROM tenant_memberships WHERE tenant_id = ? ORDER BY clerk_user_id`,
      tenantId,
    )
    : db.all<{
      tenant_id: string
      clerk_user_id: string
      role: string
      status: string
      created_at: number
      revoked_at: number | null
    }>(
      `SELECT tenant_id, clerk_user_id, role, status, created_at, revoked_at
       FROM tenant_memberships WHERE tenant_id = ? AND status = 'active' ORDER BY clerk_user_id`,
      tenantId,
    )
  return rows.map(mapMembership)
}

export function requireActiveOwner(db: AdminDb, tenantId: string, clerkUserId: string): MembershipRow {
  const membership = getMembership(db, tenantId, clerkUserId)
  if (!membership || membership.status !== 'active' || membership.role !== 'owner') {
    throw new ForbiddenError('owner_required', 'Owner ativo do tenant exigido')
  }
  const tenant = getTenant(db, tenantId)
  if (!tenant || tenant.status !== 'active') {
    throw new ForbiddenError('tenant_not_active', 'Tenant inativo')
  }
  return membership
}

/** Variante sem transação — usar dentro de `db.immediate` do caller. */
export function upsertMembershipInTx(
  db: AdminDb,
  clock: Clock,
  input: {
    tenantId: string
    clerkUserId: string
    role: MembershipRole
    actorClerkUserId: string
  },
): MembershipRow {
  assertAdminSchemaReady(db)
  const now = clock.nowMs()
  const existing = getMembership(db, input.tenantId, input.clerkUserId)
  if (existing?.status === 'active') {
    if (existing.role !== input.role) {
      throw new ConflictError(
        'membership_role_conflict',
        'Membership ativo com role diferente; não sobrescrever automaticamente',
      )
    }
    return existing
  }
  if (existing?.status === 'revoked') {
    db.run(
      `UPDATE tenant_memberships
       SET role = ?, status = 'active', created_at = ?, revoked_at = NULL
       WHERE tenant_id = ? AND clerk_user_id = ?`,
      input.role,
      now,
      input.tenantId,
      input.clerkUserId,
    )
  } else {
    db.run(
      `INSERT INTO tenant_memberships (tenant_id, clerk_user_id, role, status, created_at, revoked_at)
       VALUES (?, ?, ?, 'active', ?, NULL)`,
      input.tenantId,
      input.clerkUserId,
      input.role,
      now,
    )
  }
  writeAudit(db, clock, {
    actorClerkUserId: input.actorClerkUserId,
    subjectClerkUserId: input.clerkUserId,
    tenantId: input.tenantId,
    action: 'membership.activate',
    objectType: 'tenant_membership',
    objectId: `${input.tenantId}:${input.clerkUserId}`,
    outcome: 'success',
    metadata: { role: input.role },
  })
  return getMembership(db, input.tenantId, input.clerkUserId)!
}

export function upsertMembership(
  db: AdminDb,
  clock: Clock,
  input: {
    tenantId: string
    clerkUserId: string
    role: MembershipRole
    actorClerkUserId: string
  },
): MembershipRow {
  return db.immediate(() => upsertMembershipInTx(db, clock, input))
}

/** Contagem de owners ativos — proteção do último (DEC-103). */
export function countActiveOwnersInTenant(db: AdminDb, tenantId: string): number {
  assertAdminSchemaReady(db)
  const row = db.get<{ n: number }>(
    `SELECT COUNT(*) AS n FROM tenant_memberships
     WHERE tenant_id = ? AND role = 'owner' AND status = 'active'`,
    tenantId,
  )
  return Number(row?.n ?? 0)
}

/**
 * DEC-103: despromove owner ativo → attendant.
 * Recusa o último owner (`last_owner_protected`).
 */
export function demoteOwnerToAttendant(
  db: AdminDb,
  clock: Clock,
  input: {
    tenantId: string
    clerkUserId: string
    actorClerkUserId: string
  },
): MembershipRow {
  assertAdminSchemaReady(db)
  return db.immediate(() => {
    const current = getMembership(db, input.tenantId, input.clerkUserId)
    if (!current || current.status !== 'active') {
      throw new NotFoundError('membership_not_found', 'Membership inexistente')
    }
    if (current.role !== 'owner') {
      throw new ConflictError('not_an_owner', 'Só responsáveis podem ser despromovidos')
    }
    if (countActiveOwnersInTenant(db, input.tenantId) <= 1) {
      throw new ForbiddenError(
        'last_owner_protected',
        'Não é permitido despromover o último owner ativo',
      )
    }
    const result = db.run(
      `UPDATE tenant_memberships
       SET role = 'attendant'
       WHERE tenant_id = ? AND clerk_user_id = ? AND status = 'active' AND role = 'owner'`,
      input.tenantId,
      input.clerkUserId,
    )
    if (result.changes !== 1) {
      throw new ConflictError('owner_demote_conflict', 'Despromoção não aplicada')
    }
    writeAudit(db, clock, {
      actorClerkUserId: input.actorClerkUserId,
      subjectClerkUserId: input.clerkUserId,
      tenantId: input.tenantId,
      action: 'owner.demote',
      objectType: 'tenant_membership',
      objectId: `${input.tenantId}:${input.clerkUserId}`,
      outcome: 'success',
      metadata: { from: 'owner', to: 'attendant' },
    })
    return getMembership(db, input.tenantId, input.clerkUserId)!
  })
}

/**
 * DEC-103: promove attendant ativo → owner no tenant.
 * Idempotente se já for owner ativo.
 */
export function promoteAttendantToOwner(
  db: AdminDb,
  clock: Clock,
  input: {
    tenantId: string
    clerkUserId: string
    actorClerkUserId: string
  },
): MembershipRow {
  assertAdminSchemaReady(db)
  const tenant = getTenant(db, input.tenantId)
  if (!tenant) throw new NotFoundError('tenant_not_found', 'Tenant inexistente')
  if (tenant.status === 'pending_deletion') {
    throw new ConflictError('tenant_pending_deletion', 'Tenant em exclusão lógica')
  }

  return db.immediate(() => {
    const existing = getMembership(db, input.tenantId, input.clerkUserId)
    if (!existing || existing.status !== 'active') {
      throw new NotFoundError('membership_not_found', 'Membership ativo inexistente')
    }
    if (existing.role === 'owner') return existing
    if (existing.role !== 'attendant') {
      throw new ConflictError('not_an_attendant', 'Só atendentes podem ser promovidos a responsável')
    }
    const result = db.run(
      `UPDATE tenant_memberships
       SET role = 'owner'
       WHERE tenant_id = ? AND clerk_user_id = ? AND status = 'active' AND role = 'attendant'`,
      input.tenantId,
      input.clerkUserId,
    )
    if (result.changes !== 1) {
      throw new ConflictError('owner_promote_conflict', 'Promoção não aplicada')
    }
    writeAudit(db, clock, {
      actorClerkUserId: input.actorClerkUserId,
      subjectClerkUserId: input.clerkUserId,
      tenantId: input.tenantId,
      action: 'owner.promote',
      objectType: 'tenant_membership',
      objectId: `${input.tenantId}:${input.clerkUserId}`,
      outcome: 'success',
      metadata: { from: 'attendant', to: 'owner', via: 'clinic_equipe' },
    })
    return getMembership(db, input.tenantId, input.clerkUserId)!
  })
}

/** DEC-026 / DEC-103: revoga membership no tenant sem afetar outros. */
export function revokeMembership(
  db: AdminDb,
  clock: Clock,
  input: {
    tenantId: string
    clerkUserId: string
    actorClerkUserId: string
    /**
     * Permite alvo owner (clinic Equipe DEC-103 ou Platform Admin).
     * Sempre aplica `last_owner_protected` quando o alvo é owner ativo.
     */
    allowOwnerTarget?: boolean
  },
): MembershipRow {
  assertAdminSchemaReady(db)
  const now = clock.nowMs()
  return db.immediate(() => {
    const current = getMembership(db, input.tenantId, input.clerkUserId)
    if (!current) throw new NotFoundError('membership_not_found', 'Membership inexistente')
    if (current.status === 'revoked') return current
    if (current.role === 'owner' && !input.allowOwnerTarget) {
      throw new ForbiddenError('cannot_revoke_owner', 'Remoção de responsável não autorizada')
    }
    if (current.role === 'owner' && countActiveOwnersInTenant(db, input.tenantId) <= 1) {
      throw new ForbiddenError(
        'last_owner_protected',
        'Não é permitido remover o último owner ativo',
      )
    }
    const result = db.run(
      `UPDATE tenant_memberships
       SET status = 'revoked', revoked_at = ?
       WHERE tenant_id = ? AND clerk_user_id = ? AND status = 'active'`,
      now,
      input.tenantId,
      input.clerkUserId,
    )
    if (result.changes !== 1) {
      throw new ConflictError('membership_revoke_conflict', 'Revogação não aplicada')
    }
    writeAudit(db, clock, {
      actorClerkUserId: input.actorClerkUserId,
      subjectClerkUserId: input.clerkUserId,
      tenantId: input.tenantId,
      action: 'membership.revoke',
      objectType: 'tenant_membership',
      objectId: `${input.tenantId}:${input.clerkUserId}`,
      outcome: 'success',
      metadata: { role: current.role },
    })
    // AC-24 / DEC-026: cortar suporte do subject neste tenant (não afeta Clerk/B).
    // SQL inline para evitar ciclo memberships ↔ support.
    const supportRows = db.all<{ id: string }>(
      `SELECT id FROM support_sessions
       WHERE tenant_id = ? AND subject_clerk_user_id = ? AND status = 'active'`,
      input.tenantId,
      input.clerkUserId,
    )
    for (const s of supportRows) {
      const cut = db.run(
        `UPDATE support_sessions
         SET status = 'revoked', revoked_at = ?, revoked_by_clerk_user_id = ?, ended_at = ?,
             handoff_hash = NULL
         WHERE id = ? AND status = 'active'`,
        now,
        input.actorClerkUserId,
        now,
        s.id,
      )
      if (cut.changes === 1) {
        db.run(
          `UPDATE support_termination_requests
           SET status = 'closed_with_session', decided_at = ?
           WHERE support_session_id = ? AND status = 'pending'`,
          now,
          s.id,
        )
        writeAudit(db, clock, {
          actorClerkUserId: input.actorClerkUserId,
          subjectClerkUserId: input.clerkUserId,
          tenantId: input.tenantId,
          action: 'support.session.revoke',
          objectType: 'support_session',
          objectId: s.id,
          outcome: 'success',
          supportSessionId: s.id,
          metadata: { reason: 'subject_membership_revoked' },
        })
      }
    }
    return getMembership(db, input.tenantId, input.clerkUserId)!
  })
}
