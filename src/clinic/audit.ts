import type { Clock } from '../db/clock'
import { assertClinicSchemaReady } from './migrations'
import type { ClinicDb } from './store'
import { newId } from './ids'

export type AuditRow = {
  id: string
  tenantId: string
  actor: string
  action: string
  objectType: string
  objectId: string
  detailJson: string | null
  occurredAt: number
}

export function writeOperationalAudit(
  db: ClinicDb,
  input: {
    tenantId: string
    actor: string
    action: string
    objectType: string
    objectId: string
    detail?: Record<string, unknown>
    id?: string
  },
  clock: Clock,
): AuditRow {
  assertClinicSchemaReady(db)
  const id = input.id ?? newId('aud')
  const occurredAt = clock.nowMs()
  const detailJson = input.detail ? JSON.stringify(input.detail) : null
  db.run(
    `INSERT INTO operational_audit (
      id, tenant_id, actor, action, object_type, object_id, detail_json, occurred_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    input.tenantId,
    input.actor,
    input.action,
    input.objectType,
    input.objectId,
    detailJson,
    occurredAt,
  )
  return {
    id,
    tenantId: input.tenantId,
    actor: input.actor,
    action: input.action,
    objectType: input.objectType,
    objectId: input.objectId,
    detailJson,
    occurredAt,
  }
}

export function listOperationalAudit(
  db: ClinicDb,
  tenantId: string,
  limit = 100,
): AuditRow[] {
  assertClinicSchemaReady(db)
  return db
    .all<{
      id: string
      tenant_id: string
      actor: string
      action: string
      object_type: string
      object_id: string
      detail_json: string | null
      occurred_at: number
    }>(
      `SELECT * FROM operational_audit
       WHERE tenant_id = ? ORDER BY occurred_at DESC LIMIT ?`,
      tenantId,
      limit,
    )
    .map((row) => ({
      id: row.id,
      tenantId: row.tenant_id,
      actor: row.actor,
      action: row.action,
      objectType: row.object_type,
      objectId: row.object_id,
      detailJson: row.detail_json,
      occurredAt: row.occurred_at,
    }))
}
