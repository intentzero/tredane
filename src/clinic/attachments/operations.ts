/**
 * Metadados de anexos no SQLite do DO (#34).
 * Sem put/get R2 aqui — o Worker faz I/O fora de transactionSync (ADR-0012).
 */
import { attachmentR2Key } from '../../attachments/keys'
import { RETENTION } from '../../attachments/policy'
import type { Clock } from '../../db/clock'
import type { ClinicCaller } from '../envelopes'
import { assertValidCaller } from '../envelopes'
import { NotFoundError, ValidationError } from '../errors'
import { newId } from '../ids'
import { assertClinicSchemaReady } from '../migrations'
import type { ClinicDb } from '../store'
import { bindOrAssertTenant } from '../tenant'
import { mapAttachment, type AttachmentSqlRow } from './rows'
import type {
  AttachmentRow,
  CreatePendingAttachmentInput,
  LinkAttachmentToMessageInput,
  MarkAttachmentFailedInput,
  MarkAttachmentReadyInput,
} from './types'

export function getAttachment(
  db: ClinicDb,
  tenantId: string,
  attachmentId: string,
): AttachmentRow | undefined {
  assertClinicSchemaReady(db)
  const row = db.get<AttachmentSqlRow>(
    `SELECT * FROM attachments
     WHERE tenant_id = ? AND id = ? AND deleted_at IS NULL`,
    tenantId,
    attachmentId,
  )
  return row ? mapAttachment(row) : undefined
}

export function listAttachmentsForMessage(
  db: ClinicDb,
  tenantId: string,
  messageId: string,
): AttachmentRow[] {
  assertClinicSchemaReady(db)
  const rows = db.all<AttachmentSqlRow>(
    `SELECT * FROM attachments
     WHERE tenant_id = ? AND message_id = ? AND deleted_at IS NULL
     ORDER BY created_at ASC`,
    tenantId,
    messageId,
  )
  return rows.map(mapAttachment)
}

export function listAttachmentsForConversation(
  db: ClinicDb,
  tenantId: string,
  conversationId: string,
): AttachmentRow[] {
  assertClinicSchemaReady(db)
  const rows = db.all<AttachmentSqlRow>(
    `SELECT * FROM attachments
     WHERE tenant_id = ? AND conversation_id = ? AND deleted_at IS NULL
     ORDER BY created_at ASC`,
    tenantId,
    conversationId,
  )
  return rows.map(mapAttachment)
}

export function createPendingAttachmentOp(
  db: ClinicDb,
  caller: ClinicCaller,
  input: CreatePendingAttachmentInput,
  clock: Clock,
): AttachmentRow {
  assertClinicSchemaReady(db)
  assertValidCaller(caller)
  const meta = bindOrAssertTenant(db, caller, clock)
  const id = input.id ?? newId('att')
  const now = clock.nowMs()
  const r2Key = attachmentR2Key(meta.tenantId, id)

  if (input.providerMediaId) {
    const existing = db.get<AttachmentSqlRow>(
      `SELECT * FROM attachments
       WHERE tenant_id = ? AND provider_media_id = ? AND deleted_at IS NULL`,
      meta.tenantId,
      input.providerMediaId,
    )
    if (existing) return mapAttachment(existing)
  }

  db.run(
    `INSERT INTO attachments (
      id, tenant_id, message_id, conversation_id, r2_key,
      content_type, byte_size, filename, sha256, source,
      provider_media_id, status, failure_code,
      created_at, updated_at, ready_at, deleted_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, 'pending', NULL, ?, ?, NULL, NULL)`,
    id,
    meta.tenantId,
    input.messageId ?? null,
    input.conversationId ?? null,
    r2Key,
    input.contentType,
    input.byteSize ?? 0,
    input.filename ?? null,
    input.source,
    input.providerMediaId ?? null,
    now,
    now,
  )

  return getAttachment(db, meta.tenantId, id)!
}

export function markAttachmentReadyOp(
  db: ClinicDb,
  caller: ClinicCaller,
  input: MarkAttachmentReadyInput,
  clock: Clock,
): AttachmentRow {
  assertClinicSchemaReady(db)
  assertValidCaller(caller)
  const meta = bindOrAssertTenant(db, caller, clock)
  const existing = getAttachment(db, meta.tenantId, input.attachmentId)
  if (!existing) {
    throw new NotFoundError('attachment_not_found', 'Anexo não encontrado nesta clínica')
  }
  if (existing.status === 'ready' && existing.byteSize === input.byteSize) {
    return existing
  }
  const now = clock.nowMs()
  db.run(
    `UPDATE attachments SET
      status = 'ready',
      byte_size = ?,
      content_type = ?,
      sha256 = ?,
      filename = COALESCE(?, filename),
      failure_code = NULL,
      ready_at = ?,
      updated_at = ?
     WHERE tenant_id = ? AND id = ? AND deleted_at IS NULL`,
    input.byteSize,
    input.contentType,
    input.sha256 ?? null,
    input.filename ?? null,
    now,
    now,
    meta.tenantId,
    input.attachmentId,
  )
  return getAttachment(db, meta.tenantId, input.attachmentId)!
}

export function markAttachmentFailedOp(
  db: ClinicDb,
  caller: ClinicCaller,
  input: MarkAttachmentFailedInput,
  clock: Clock,
): AttachmentRow {
  assertClinicSchemaReady(db)
  assertValidCaller(caller)
  const meta = bindOrAssertTenant(db, caller, clock)
  const existing = getAttachment(db, meta.tenantId, input.attachmentId)
  if (!existing) {
    throw new NotFoundError('attachment_not_found', 'Anexo não encontrado nesta clínica')
  }
  const status = input.status ?? 'failed'
  const now = clock.nowMs()
  db.run(
    `UPDATE attachments SET
      status = ?,
      failure_code = ?,
      updated_at = ?
     WHERE tenant_id = ? AND id = ? AND deleted_at IS NULL`,
    status,
    input.failureCode.slice(0, 80),
    now,
    meta.tenantId,
    input.attachmentId,
  )
  return getAttachment(db, meta.tenantId, input.attachmentId)!
}

export function linkAttachmentToMessageOp(
  db: ClinicDb,
  caller: ClinicCaller,
  input: LinkAttachmentToMessageInput,
  clock: Clock,
): AttachmentRow {
  assertClinicSchemaReady(db)
  assertValidCaller(caller)
  const meta = bindOrAssertTenant(db, caller, clock)
  const existing = getAttachment(db, meta.tenantId, input.attachmentId)
  if (!existing) {
    throw new NotFoundError('attachment_not_found', 'Anexo não encontrado nesta clínica')
  }
  const now = clock.nowMs()
  db.run(
    `UPDATE attachments SET
      message_id = ?,
      conversation_id = ?,
      updated_at = ?
     WHERE tenant_id = ? AND id = ? AND deleted_at IS NULL`,
    input.messageId,
    input.conversationId,
    now,
    meta.tenantId,
    input.attachmentId,
  )
  return getAttachment(db, meta.tenantId, input.attachmentId)!
}

export function getAttachmentOp(
  db: ClinicDb,
  caller: ClinicCaller,
  attachmentId: string,
  clock: Clock,
): AttachmentRow {
  assertClinicSchemaReady(db)
  assertValidCaller(caller)
  const meta = bindOrAssertTenant(db, caller, clock)
  const row = getAttachment(db, meta.tenantId, attachmentId)
  if (!row) {
    throw new NotFoundError('attachment_not_found', 'Anexo não encontrado nesta clínica')
  }
  return row
}

export function softDeleteAttachmentOp(
  db: ClinicDb,
  caller: ClinicCaller,
  attachmentId: string,
  clock: Clock,
): AttachmentRow {
  assertClinicSchemaReady(db)
  assertValidCaller(caller)
  const meta = bindOrAssertTenant(db, caller, clock)
  const existing = getAttachment(db, meta.tenantId, attachmentId)
  if (!existing) {
    throw new NotFoundError('attachment_not_found', 'Anexo não encontrado nesta clínica')
  }
  const now = clock.nowMs()
  db.run(
    `UPDATE attachments SET deleted_at = ?, updated_at = ?, status = 'unavailable'
     WHERE tenant_id = ? AND id = ?`,
    now,
    now,
    meta.tenantId,
    attachmentId,
  )
  const row = db.get<AttachmentSqlRow>(
    `SELECT * FROM attachments WHERE tenant_id = ? AND id = ?`,
    meta.tenantId,
    attachmentId,
  )
  return mapAttachment(row!)
}

/**
 * Lista anexos pending/failed sem blob utilizável para limpeza de órfãos.
 * O Worker apaga objectos R2 e marca metadados fora desta função.
 */
export function listOrphanCandidates(
  db: ClinicDb,
  tenantId: string,
  nowMs: number,
): AttachmentRow[] {
  assertClinicSchemaReady(db)
  const cutoff = nowMs - RETENTION.orphanPendingMaxAgeMs
  const rows = db.all<AttachmentSqlRow>(
    `SELECT * FROM attachments
     WHERE tenant_id = ?
       AND deleted_at IS NULL
       AND (
         (status = 'pending' AND created_at < ?)
         OR status = 'failed'
       )
     ORDER BY created_at ASC
     LIMIT 100`,
    tenantId,
    cutoff,
  )
  return rows.map(mapAttachment)
}

/**
 * Serialização segura para API — sem r2_key cru para o cliente se preferirmos
 * só id; incluímos r2Key só em logs internos. API usa id + status.
 */
export function assertAttachmentOwnedByTenant(
  row: AttachmentRow,
  tenantId: string,
): void {
  if (row.tenantId !== tenantId) {
    throw new ValidationError('tenant_mismatch', 'Anexo não pertence a esta clínica')
  }
}
