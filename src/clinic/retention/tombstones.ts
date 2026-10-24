import { assertClinicSchemaReady } from '../migrations'
import type { ClinicDb } from '../store'

export type ContactTombstoneRow = {
  tenantId: string
  waId: string
  contactId: string
  deletedAt: number
  deletedByClerkUserId: string | null
}

export function findContactTombstoneByWaId(
  db: ClinicDb,
  tenantId: string,
  waId: string,
): ContactTombstoneRow | undefined {
  assertClinicSchemaReady(db)
  const row = db.get<{
    tenant_id: string
    wa_id: string
    contact_id: string
    deleted_at: number
    deleted_by_clerk_user_id: string | null
  }>(
    `SELECT tenant_id, wa_id, contact_id, deleted_at, deleted_by_clerk_user_id
     FROM contact_deletion_tombstones
     WHERE tenant_id = ? AND wa_id = ?`,
    tenantId,
    waId,
  )
  if (!row) return undefined
  return {
    tenantId: row.tenant_id,
    waId: row.wa_id,
    contactId: row.contact_id,
    deletedAt: row.deleted_at,
    deletedByClerkUserId: row.deleted_by_clerk_user_id,
  }
}

export function insertContactTombstone(
  db: ClinicDb,
  input: {
    tenantId: string
    waId: string
    contactId: string
    deletedByClerkUserId?: string | null
  },
  deletedAt: number,
): ContactTombstoneRow {
  assertClinicSchemaReady(db)
  db.run(
    `INSERT OR REPLACE INTO contact_deletion_tombstones (
      tenant_id, wa_id, contact_id, deleted_at, deleted_by_clerk_user_id
    ) VALUES (?, ?, ?, ?, ?)`,
    input.tenantId,
    input.waId,
    input.contactId,
    deletedAt,
    input.deletedByClerkUserId ?? null,
  )
  return {
    tenantId: input.tenantId,
    waId: input.waId,
    contactId: input.contactId,
    deletedAt,
    deletedByClerkUserId: input.deletedByClerkUserId ?? null,
  }
}
