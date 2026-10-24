/**
 * Barreiras anti-reintrodução após exclusão (#43 / REQ-071).
 */
import type { AdminDb } from '../db/admin/store'
import { assertAdminSchemaReady } from '../db/admin/gate'
import { getTenant } from '../db/admin/tenants'
import type { ClinicDb } from '../clinic/store'
import { findContactTombstoneByWaId } from '../clinic/retention'

export function isTenantPurged(db: AdminDb, tenantId: string): boolean {
  assertAdminSchemaReady(db)
  const row = db.get<{ tenant_id: string }>(
    `SELECT tenant_id FROM purged_tenants WHERE tenant_id = ?`,
    tenantId,
  )
  if (row) return true
  const tenant = getTenant(db, tenantId)
  return tenant?.status === 'purged'
}

/**
 * Recusar mutações clínicas / webhooks para tenant purgado ou em exclusão
 * quando a política exige freeze total pós-purga.
 */
export function assertTenantAcceptsClinicalIngest(
  db: AdminDb,
  tenantId: string,
): { ok: true } | { ok: false; reason: 'tenant_purged' | 'tenant_pending_deletion' | 'tenant_not_found' | 'tenant_suspended' } {
  if (isTenantPurged(db, tenantId)) {
    return { ok: false, reason: 'tenant_purged' }
  }
  const tenant = getTenant(db, tenantId)
  if (!tenant) return { ok: false, reason: 'tenant_not_found' }
  if (tenant.status === 'pending_deletion') {
    return { ok: false, reason: 'tenant_pending_deletion' }
  }
  if (tenant.status === 'suspended') {
    return { ok: false, reason: 'tenant_suspended' }
  }
  return { ok: true }
}

/** Replay de webhook/job não recria contacto tombstoned. */
export function isContactWaIdTombstoned(
  clinicDb: ClinicDb,
  tenantId: string,
  waId: string,
): boolean {
  return findContactTombstoneByWaId(clinicDb, tenantId, waId) != null
}

export function recordPurgedTenant(
  db: AdminDb,
  input: {
    tenantId: string
    deletionCommandId: string
    pendingDeletionAt: number | null
    deadlineAt: number | null
    purgedAt: number
  },
): void {
  assertAdminSchemaReady(db)
  db.run(
    `INSERT OR REPLACE INTO purged_tenants (
      tenant_id, purged_at, deletion_command_id, pending_deletion_at, deadline_at
    ) VALUES (?, ?, ?, ?, ?)`,
    input.tenantId,
    input.purgedAt,
    input.deletionCommandId,
    input.pendingDeletionAt,
    input.deadlineAt,
  )
}
