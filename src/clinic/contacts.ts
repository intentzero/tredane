import type { Clock } from '../db/clock'
import { assertClinicSchemaReady } from './migrations'
import { findContactTombstoneByWaId } from './retention/tombstones'
import type { ClinicDb } from './store'
import { newId } from './ids'
import { ValidationError } from './errors'

export type ContactRow = {
  id: string
  tenantId: string
  waId: string
  displayName: string | null
  createdAt: number
}

export class ContactTombstonedError extends ValidationError {
  constructor(waId: string) {
    super(
      'contact_tombstoned',
      `Contacto com wa_id excluído; reintrodução bloqueada (${waId.slice(0, 4)}…)`,
    )
  }
}

export function upsertContact(
  db: ClinicDb,
  input: {
    tenantId: string
    waId: string
    displayName?: string | null
    id?: string
  },
  clock: Clock,
): ContactRow {
  assertClinicSchemaReady(db)
  const tombstone = findContactTombstoneByWaId(db, input.tenantId, input.waId)
  if (tombstone) {
    throw new ContactTombstonedError(input.waId)
  }
  const existing = db.get<{
    id: string
    tenant_id: string
    wa_id: string
    display_name: string | null
    created_at: number
  }>(
    `SELECT id, tenant_id, wa_id, display_name, created_at
     FROM contacts WHERE tenant_id = ? AND wa_id = ?`,
    input.tenantId,
    input.waId,
  )
  if (existing) {
    if (input.displayName != null && input.displayName !== existing.display_name) {
      db.run(
        `UPDATE contacts SET display_name = ? WHERE tenant_id = ? AND id = ?`,
        input.displayName,
        input.tenantId,
        existing.id,
      )
      return {
        id: existing.id,
        tenantId: existing.tenant_id,
        waId: existing.wa_id,
        displayName: input.displayName,
        createdAt: existing.created_at,
      }
    }
    return {
      id: existing.id,
      tenantId: existing.tenant_id,
      waId: existing.wa_id,
      displayName: existing.display_name,
      createdAt: existing.created_at,
    }
  }

  const id = input.id ?? newId('ctc')
  const createdAt = clock.nowMs()
  db.run(
    `INSERT INTO contacts (id, tenant_id, wa_id, display_name, created_at)
     VALUES (?, ?, ?, ?, ?)`,
    id,
    input.tenantId,
    input.waId,
    input.displayName ?? null,
    createdAt,
  )
  return {
    id,
    tenantId: input.tenantId,
    waId: input.waId,
    displayName: input.displayName ?? null,
    createdAt,
  }
}

export function getContact(
  db: ClinicDb,
  tenantId: string,
  contactId: string,
): ContactRow | undefined {
  assertClinicSchemaReady(db)
  const row = db.get<{
    id: string
    tenant_id: string
    wa_id: string
    display_name: string | null
    created_at: number
  }>(
    `SELECT id, tenant_id, wa_id, display_name, created_at
     FROM contacts WHERE tenant_id = ? AND id = ?`,
    tenantId,
    contactId,
  )
  if (!row) return undefined
  return {
    id: row.id,
    tenantId: row.tenant_id,
    waId: row.wa_id,
    displayName: row.display_name,
    createdAt: row.created_at,
  }
}

export function listContacts(db: ClinicDb, tenantId: string): ContactRow[] {
  assertClinicSchemaReady(db)
  return db
    .all<{
      id: string
      tenant_id: string
      wa_id: string
      display_name: string | null
      created_at: number
    }>(
      `SELECT id, tenant_id, wa_id, display_name, created_at
       FROM contacts WHERE tenant_id = ? ORDER BY created_at`,
      tenantId,
    )
    .map((row) => ({
      id: row.id,
      tenantId: row.tenant_id,
      waId: row.wa_id,
      displayName: row.display_name,
      createdAt: row.created_at,
    }))
}
