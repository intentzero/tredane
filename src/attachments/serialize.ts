import type { AttachmentRow } from '../clinic/attachments'

/**
 * API pública — sem r2_key, sem credenciais, sem hashes longos em logs.
 * Cliente usa id + rotas autenticadas / token efémero.
 */
export function serializeAttachment(a: AttachmentRow) {
  return {
    id: a.id,
    tenantId: a.tenantId,
    messageId: a.messageId,
    conversationId: a.conversationId,
    contentType: a.contentType,
    byteSize: a.byteSize,
    filename: a.filename,
    source: a.source,
    status: a.status,
    failureCode: a.failureCode,
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
    readyAt: a.readyAt,
    /** Confirmado DEC-011: anexos nunca entram no contexto IA. */
    includedInAiContext: false as const,
  }
}
