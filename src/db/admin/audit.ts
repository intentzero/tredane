import type { Clock } from '../clock'
import { redactSecrets } from '../tokens'
import { assertAdminSchemaReady } from './gate'
import { newId } from './ids'
import type { AdminDb } from './store'

export type AuditWrite = {
  actorClerkUserId: string
  subjectClerkUserId?: string | null
  tenantId?: string | null
  action: string
  objectType: string
  objectId?: string | null
  outcome: 'success' | 'denied' | 'conflict' | 'error'
  supportSessionId?: string | null
  /** Apenas metadados não clínicos; secrets são redigidos. */
  metadata?: Record<string, unknown> | null
}

export type AuditEvent = {
  id: string
  occurredAt: number
  actorClerkUserId: string
  subjectClerkUserId: string | null
  tenantId: string | null
  action: string
  objectType: string
  objectId: string | null
  outcome: string
  supportSessionId: string | null
  metadataJson: string | null
}

export function writeAudit(db: AdminDb, clock: Clock, input: AuditWrite): AuditEvent {
  assertAdminSchemaReady(db)
  const id = newId('aud')
  const occurredAt = clock.nowMs()
  const safeMeta = input.metadata ? redactSecrets(input.metadata) : null
  const metadataJson = safeMeta ? JSON.stringify(safeMeta) : null

  db.run(
    `INSERT INTO central_audit_events (
      id, occurred_at, actor_clerk_user_id, subject_clerk_user_id, tenant_id,
      action, object_type, object_id, outcome, support_session_id, metadata_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    occurredAt,
    input.actorClerkUserId,
    input.subjectClerkUserId ?? null,
    input.tenantId ?? null,
    input.action,
    input.objectType,
    input.objectId ?? null,
    input.outcome,
    input.supportSessionId ?? null,
    metadataJson,
  )

  return {
    id,
    occurredAt,
    actorClerkUserId: input.actorClerkUserId,
    subjectClerkUserId: input.subjectClerkUserId ?? null,
    tenantId: input.tenantId ?? null,
    action: input.action,
    objectType: input.objectType,
    objectId: input.objectId ?? null,
    outcome: input.outcome,
    supportSessionId: input.supportSessionId ?? null,
    metadataJson,
  }
}

/** Consulta de auditoria escopada a um tenant (Platform Admin / owners). */
export function listAuditForTenant(
  db: AdminDb,
  tenantId: string,
  opts: { limit?: number } = {},
): AuditEvent[] {
  assertAdminSchemaReady(db)
  const limit = opts.limit ?? 100
  const rows = db.all<{
    id: string
    occurred_at: number
    actor_clerk_user_id: string
    subject_clerk_user_id: string | null
    tenant_id: string | null
    action: string
    object_type: string
    object_id: string | null
    outcome: string
    support_session_id: string | null
    metadata_json: string | null
  }>(
    `SELECT id, occurred_at, actor_clerk_user_id, subject_clerk_user_id, tenant_id,
            action, object_type, object_id, outcome, support_session_id, metadata_json
     FROM central_audit_events
     WHERE tenant_id = ?
     ORDER BY occurred_at DESC, id DESC
     LIMIT ?`,
    tenantId,
    limit,
  )
  return rows.map((r) => ({
    id: r.id,
    occurredAt: r.occurred_at,
    actorClerkUserId: r.actor_clerk_user_id,
    subjectClerkUserId: r.subject_clerk_user_id,
    tenantId: r.tenant_id,
    action: r.action,
    objectType: r.object_type,
    objectId: r.object_id,
    outcome: r.outcome,
    supportSessionId: r.support_session_id,
    metadataJson: r.metadata_json,
  }))
}
