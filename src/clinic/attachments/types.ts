import type { AttachmentSource, AttachmentStatus } from '../constants'

export type AttachmentRow = {
  id: string
  tenantId: string
  messageId: string | null
  conversationId: string | null
  r2Key: string
  contentType: string
  byteSize: number
  filename: string | null
  sha256: string | null
  source: AttachmentSource
  providerMediaId: string | null
  status: AttachmentStatus
  failureCode: string | null
  createdAt: number
  updatedAt: number
  readyAt: number | null
  deletedAt: number | null
}

export type CreatePendingAttachmentInput = {
  id?: string
  conversationId?: string | null
  messageId?: string | null
  contentType: string
  filename?: string | null
  source: AttachmentSource
  providerMediaId?: string | null
  /** Pré-reserva do tamanho conhecido (0 se ainda a descarregar). */
  byteSize?: number
}

export type MarkAttachmentReadyInput = {
  attachmentId: string
  byteSize: number
  contentType: string
  sha256?: string | null
  filename?: string | null
}

export type MarkAttachmentFailedInput = {
  attachmentId: string
  failureCode: string
  /** `failed` = erro de processamento; `unavailable` = blob ausente / Meta. */
  status?: 'failed' | 'unavailable'
}

export type LinkAttachmentToMessageInput = {
  attachmentId: string
  messageId: string
  conversationId: string
}
