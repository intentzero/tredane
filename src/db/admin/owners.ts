/**
 * Gestão de owners na Platform Admin (DEC-020 / DEC-103 / REQ-004 / #24).
 *
 * Regras explícitas (antes de transições irreversíveis):
 * 1. Criar tenant exige primeiro owner na mesma operação.
 * 2. Superadmin (caller HTTP) atribui, promove, substitui ou remove owners.
 * 3. Remover ou despromover o **último** owner ativo é recusado (`last_owner_protected`).
 * 4. Substituição exige promover/ativar o novo owner antes de remover o antigo,
 *    na mesma transação, mantendo ≥1 owner ativo.
 * 5. Memberships do mesmo utilizador noutros tenants não são alterados.
 * 6. DEC-103: owner da clínica também convida/promove/despromove/remove owners
 *    na Equipe (API clínica), com a mesma proteção do último owner.
 */
import type { Clock } from '../clock'
import { writeAudit } from './audit'
import { ConflictError, ForbiddenError, NotFoundError } from './errors'
import { assertAdminSchemaReady } from './gate'
import {
  getMembership,
  listMembersForTenant,
  upsertMembershipInTx,
  type MembershipRow,
} from './memberships'
import { newId } from './ids'
import type { AdminDb } from './store'
import { createTenant, getTenant, type TenantRow } from './tenants'

export function countActiveOwners(db: AdminDb, tenantId: string): number {
  assertAdminSchemaReady(db)
  const row = db.get<{ n: number }>(
    `SELECT COUNT(*) AS n FROM tenant_memberships
     WHERE tenant_id = ? AND role = 'owner' AND status = 'active'`,
    tenantId,
  )
  return Number(row?.n ?? 0)
}

function assertCanDropOwner(db: AdminDb, tenantId: string, clerkUserId: string): void {
  const current = getMembership(db, tenantId, clerkUserId)
  if (!current || current.status !== 'active' || current.role !== 'owner') {
    throw new NotFoundError('owner_not_found', 'Owner ativo inexistente')
  }
  if (countActiveOwners(db, tenantId) <= 1) {
    throw new ForbiddenError(
      'last_owner_protected',
      'Não é permitido remover ou despromover o último owner ativo',
    )
  }
}

export function createTenantWithOwner(
  db: AdminDb,
  clock: Clock,
  input: {
    id?: string
    name: string
    timezone?: string
    ownerClerkUserId: string
    actorClerkUserId: string
  },
): { tenant: TenantRow; owner: MembershipRow } {
  assertAdminSchemaReady(db)
  const ownerId = input.ownerClerkUserId.trim()
  if (!ownerId) {
    throw new ConflictError('owner_required', 'Primeiro owner obrigatório')
  }
  const name = input.name.trim()
  if (!name) {
    throw new ConflictError('tenant_name_required', 'Nome do tenant obrigatório')
  }

  return db.immediate(() => {
    // createTenant aninha immediate — usar insert inline para uma só transação.
    const now = clock.nowMs()
    const id = input.id ?? newId('tenant')
    const timezone = input.timezone?.trim() || 'America/Sao_Paulo'
    if (getTenant(db, id)) {
      throw new ConflictError('tenant_id_conflict', 'Tenant id já existe')
    }
    db.run(
      `INSERT INTO tenants (id, name, timezone, status, created_at, updated_at, suspended_at, pending_deletion_at)
       VALUES (?, ?, ?, 'active', ?, ?, NULL, NULL)`,
      id,
      name,
      timezone,
      now,
      now,
    )
    writeAudit(db, clock, {
      actorClerkUserId: input.actorClerkUserId,
      tenantId: id,
      action: 'tenant.create',
      objectType: 'tenant',
      objectId: id,
      outcome: 'success',
      metadata: { name, firstOwner: ownerId },
    })
    const owner = upsertMembershipInTx(db, clock, {
      tenantId: id,
      clerkUserId: ownerId,
      role: 'owner',
      actorClerkUserId: input.actorClerkUserId,
    })
    writeAudit(db, clock, {
      actorClerkUserId: input.actorClerkUserId,
      subjectClerkUserId: ownerId,
      tenantId: id,
      action: 'owner.assign',
      objectType: 'tenant_membership',
      objectId: `${id}:${ownerId}`,
      outcome: 'success',
      metadata: { as: 'first_owner' },
    })
    return { tenant: getTenant(db, id)!, owner }
  })
}

/** Atribui ou promove a owner (attendant→owner ou reativa revoked). */
export function assignOwner(
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
    if (existing?.status === 'active' && existing.role === 'owner') {
      return existing
    }
    if (existing?.status === 'active' && existing.role === 'attendant') {
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
        metadata: { from: 'attendant', to: 'owner' },
      })
      return getMembership(db, input.tenantId, input.clerkUserId)!
    }

    const membership = upsertMembershipInTx(db, clock, {
      tenantId: input.tenantId,
      clerkUserId: input.clerkUserId,
      role: 'owner',
      actorClerkUserId: input.actorClerkUserId,
    })
    writeAudit(db, clock, {
      actorClerkUserId: input.actorClerkUserId,
      subjectClerkUserId: input.clerkUserId,
      tenantId: input.tenantId,
      action: 'owner.assign',
      objectType: 'tenant_membership',
      objectId: `${input.tenantId}:${input.clerkUserId}`,
      outcome: 'success',
      metadata: { as: existing?.status === 'revoked' ? 'reactivate_as_owner' : 'new_owner' },
    })
    return membership
  })
}

/** Remove owner ativo; protege o último. Não afeta outros tenants. */
export function removeOwner(
  db: AdminDb,
  clock: Clock,
  input: {
    tenantId: string
    clerkUserId: string
    actorClerkUserId: string
  },
): MembershipRow {
  assertAdminSchemaReady(db)
  const now = clock.nowMs()
  return db.immediate(() => {
    assertCanDropOwner(db, input.tenantId, input.clerkUserId)
    const result = db.run(
      `UPDATE tenant_memberships
       SET status = 'revoked', revoked_at = ?
       WHERE tenant_id = ? AND clerk_user_id = ? AND status = 'active' AND role = 'owner'`,
      now,
      input.tenantId,
      input.clerkUserId,
    )
    if (result.changes !== 1) {
      throw new ConflictError('owner_remove_conflict', 'Remoção de owner não aplicada')
    }
    writeAudit(db, clock, {
      actorClerkUserId: input.actorClerkUserId,
      subjectClerkUserId: input.clerkUserId,
      tenantId: input.tenantId,
      action: 'owner.remove',
      objectType: 'tenant_membership',
      objectId: `${input.tenantId}:${input.clerkUserId}`,
      outcome: 'success',
    })
    return getMembership(db, input.tenantId, input.clerkUserId)!
  })
}

/**
 * Substitui owner: garante `toClerkUserId` como owner ativo e remove `fromClerkUserId`
 * na mesma transação, sem deixar o tenant sem owner.
 */
export function replaceOwner(
  db: AdminDb,
  clock: Clock,
  input: {
    tenantId: string
    fromClerkUserId: string
    toClerkUserId: string
    actorClerkUserId: string
  },
): { from: MembershipRow; to: MembershipRow } {
  assertAdminSchemaReady(db)
  if (input.fromClerkUserId === input.toClerkUserId) {
    throw new ConflictError('owner_replace_same', 'Origem e destino devem diferir')
  }
  const tenant = getTenant(db, input.tenantId)
  if (!tenant) throw new NotFoundError('tenant_not_found', 'Tenant inexistente')
  if (tenant.status === 'pending_deletion') {
    throw new ConflictError('tenant_pending_deletion', 'Tenant em exclusão lógica')
  }

  const now = clock.nowMs()
  return db.immediate(() => {
    const from = getMembership(db, input.tenantId, input.fromClerkUserId)
    if (!from || from.status !== 'active' || from.role !== 'owner') {
      throw new NotFoundError('owner_not_found', 'Owner de origem inexistente')
    }

    // Garantir destino como owner ativo primeiro.
    const toExisting = getMembership(db, input.tenantId, input.toClerkUserId)
    if (toExisting?.status === 'active' && toExisting.role === 'owner') {
      // já owner
    } else if (toExisting?.status === 'active' && toExisting.role === 'attendant') {
      const promoted = db.run(
        `UPDATE tenant_memberships
         SET role = 'owner'
         WHERE tenant_id = ? AND clerk_user_id = ? AND status = 'active' AND role = 'attendant'`,
        input.tenantId,
        input.toClerkUserId,
      )
      if (promoted.changes !== 1) {
        throw new ConflictError('owner_promote_conflict', 'Promoção no replace falhou')
      }
    } else {
      upsertMembershipInTx(db, clock, {
        tenantId: input.tenantId,
        clerkUserId: input.toClerkUserId,
        role: 'owner',
        actorClerkUserId: input.actorClerkUserId,
      })
    }

    // Agora remover origem — last_owner_protected não aplica porque destino já é owner.
    const removed = db.run(
      `UPDATE tenant_memberships
       SET status = 'revoked', revoked_at = ?
       WHERE tenant_id = ? AND clerk_user_id = ? AND status = 'active' AND role = 'owner'`,
      now,
      input.tenantId,
      input.fromClerkUserId,
    )
    if (removed.changes !== 1) {
      throw new ConflictError('owner_replace_conflict', 'Substituição não aplicada')
    }
    if (countActiveOwners(db, input.tenantId) < 1) {
      throw new ForbiddenError('last_owner_protected', 'Substituição deixaria tenant sem owner')
    }

    writeAudit(db, clock, {
      actorClerkUserId: input.actorClerkUserId,
      subjectClerkUserId: input.fromClerkUserId,
      tenantId: input.tenantId,
      action: 'owner.replace',
      objectType: 'tenant_membership',
      objectId: `${input.tenantId}:${input.fromClerkUserId}->${input.toClerkUserId}`,
      outcome: 'success',
      metadata: { from: input.fromClerkUserId, to: input.toClerkUserId },
    })

    return {
      from: getMembership(db, input.tenantId, input.fromClerkUserId)!,
      to: getMembership(db, input.tenantId, input.toClerkUserId)!,
    }
  })
}

export function listOwnersForTenant(db: AdminDb, tenantId: string): MembershipRow[] {
  return listMembersForTenant(db, tenantId).filter(
    (m) => m.role === 'owner' && m.status === 'active',
  )
}

// Re-export createTenant for callers that still need tenant-only create (tests).
export { createTenant }
