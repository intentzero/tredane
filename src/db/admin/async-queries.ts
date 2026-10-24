import { ADMIN_SCHEMA_VERSION } from './constants'
import { SchemaNotReadyError, ForbiddenError } from './errors'
import type { AsyncAdminDb } from './async-store'
import type { MembershipRole, MembershipStatus, TenantStatus } from '../schema'

export type AsyncTenantRow = {
  id: string
  name: string
  timezone: string
  status: TenantStatus
  createdAt: number
  updatedAt: number
  suspendedAt: number | null
  pendingDeletionAt: number | null
}

export type AsyncMembershipRow = {
  tenantId: string
  clerkUserId: string
  role: MembershipRole
  status: MembershipStatus
  createdAt: number
  revokedAt: number | null
}

/** Membership ativa com nome do tenant — lista do seletor (#22). */
export type AsyncTenantMembershipSummary = AsyncMembershipRow & {
  tenantName: string
}

async function assertAdminSchemaReadyAsync(db: AsyncAdminDb): Promise<void> {
  let row: { version: number } | undefined
  try {
    row = await db.get<{ version: number }>('SELECT version FROM admin_schema_state WHERE id = 1')
  } catch (err) {
    throw new SchemaNotReadyError(
      `tabela admin_schema_state indisponível (${err instanceof Error ? err.message : 'erro'})`,
    )
  }
  if (!row) {
    throw new SchemaNotReadyError('versão administrativa ausente')
  }
  if (row.version !== ADMIN_SCHEMA_VERSION) {
    throw new SchemaNotReadyError(
      `esperada ${ADMIN_SCHEMA_VERSION}, encontrada ${row.version}`,
    )
  }
}

function mapTenant(row: {
  id: string
  name: string
  timezone: string
  status: string
  created_at: number
  updated_at: number
  suspended_at: number | null
  pending_deletion_at: number | null
}): AsyncTenantRow {
  return {
    id: row.id,
    name: row.name,
    timezone: row.timezone,
    status: row.status as TenantStatus,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    suspendedAt: row.suspended_at,
    pendingDeletionAt: row.pending_deletion_at,
  }
}

function mapMembership(row: {
  tenant_id: string
  clerk_user_id: string
  role: string
  status: string
  created_at: number
  revoked_at: number | null
}): AsyncMembershipRow {
  return {
    tenantId: row.tenant_id,
    clerkUserId: row.clerk_user_id,
    role: row.role as MembershipRole,
    status: row.status as MembershipStatus,
    createdAt: row.created_at,
    revokedAt: row.revoked_at,
  }
}

export async function getTenantAsync(
  db: AsyncAdminDb,
  tenantId: string,
): Promise<AsyncTenantRow | undefined> {
  await assertAdminSchemaReadyAsync(db)
  const row = await db.get<{
    id: string
    name: string
    timezone: string
    status: string
    created_at: number
    updated_at: number
    suspended_at: number | null
    pending_deletion_at: number | null
  }>(
    `SELECT id, name, timezone, status, created_at, updated_at, suspended_at, pending_deletion_at
     FROM tenants WHERE id = ?`,
    tenantId,
  )
  return row ? mapTenant(row) : undefined
}

export async function listTenantsAsync(db: AsyncAdminDb): Promise<AsyncTenantRow[]> {
  await assertAdminSchemaReadyAsync(db)
  const rows = await db.all<{
    id: string
    name: string
    timezone: string
    status: string
    created_at: number
    updated_at: number
    suspended_at: number | null
    pending_deletion_at: number | null
  }>(
    `SELECT id, name, timezone, status, created_at, updated_at, suspended_at, pending_deletion_at
     FROM tenants ORDER BY id`,
  )
  return rows.map(mapTenant)
}

export async function getMembershipAsync(
  db: AsyncAdminDb,
  tenantId: string,
  clerkUserId: string,
): Promise<AsyncMembershipRow | undefined> {
  await assertAdminSchemaReadyAsync(db)
  const row = await db.get<{
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

/** Memberships ativos em tenants ativos — fonte D1, nunca claim Clerk. */
export async function listActiveMembershipsForUserAsync(
  db: AsyncAdminDb,
  clerkUserId: string,
): Promise<AsyncTenantMembershipSummary[]> {
  await assertAdminSchemaReadyAsync(db)
  const rows = await db.all<{
    tenant_id: string
    clerk_user_id: string
    role: string
    status: string
    created_at: number
    revoked_at: number | null
    tenant_name: string
  }>(
    `SELECT m.tenant_id, m.clerk_user_id, m.role, m.status, m.created_at, m.revoked_at,
            t.name AS tenant_name
     FROM tenant_memberships m
     INNER JOIN tenants t ON t.id = m.tenant_id
     WHERE m.clerk_user_id = ? AND m.status = 'active' AND t.status = 'active'
     ORDER BY m.tenant_id`,
    clerkUserId,
  )
  return rows.map((row) => ({
    ...mapMembership(row),
    tenantName: row.tenant_name,
  }))
}

/**
 * Resolve acesso a um tenant a partir do D1 vigente.
 * Não confia em clinicId/role enviados pelo cliente além do tenantId da rota
 * (já escolhido pela UI e revalidado aqui).
 */
export async function resolveActiveTenantMembership(
  db: AsyncAdminDb,
  tenantId: string,
  clerkUserId: string,
): Promise<{ tenant: AsyncTenantRow; membership: AsyncMembershipRow }> {
  const tenant = await getTenantAsync(db, tenantId)
  if (!tenant) {
    // Não revelar existência de outro tenant a quem não tem acesso.
    throw new ForbiddenError('tenant_access_denied', 'Acesso ao tenant negado')
  }
  if (tenant.status !== 'active') {
    throw new ForbiddenError('tenant_not_active', 'Tenant inativo')
  }
  const membership = await getMembershipAsync(db, tenantId, clerkUserId)
  if (!membership || membership.status !== 'active') {
    throw new ForbiddenError('tenant_access_denied', 'Acesso ao tenant negado')
  }
  return { tenant, membership }
}
