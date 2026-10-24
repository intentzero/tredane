import type { AttachmentSource, AttachmentStatus } from '../constants'
import type { AttachmentRow } from './types'

export type AttachmentSqlRow = {
  id: string
  tenant_id: string
  message_id: string | null
  conversation_id: string | null
  r2_key: string
  content_type: string
  byte_size: number
  filename: string | null
  sha256: string | null
  source: string
  provider_media_id: string | null
  status: string
  failure_code: string | null
  created_at: number
  updated_at: number
  ready_at: number | null
  deleted_at: number | null
}

export function mapAttachment(row: AttachmentSqlRow): AttachmentRow {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    messageId: row.message_id,
    conversationId: row.conversation_id,
    r2Key: row.r2_key,
    contentType: row.content_type,
    byteSize: row.byte_size,
    filename: row.filename,
    sha256: row.sha256,
    source: row.source as AttachmentSource,
    providerMediaId: row.provider_media_id,
    status: row.status as AttachmentStatus,
    failureCode: row.failure_code,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    readyAt: row.ready_at,
    deletedAt: row.deleted_at,
  }
}
