/**
 * Metadados de anexos para o histórico da conversa (P2, #184). Nunca bytes, chave R2,
 * URL pública ou credenciais; anexos nunca entram no contexto IA (DEC-011).
 */
import type { MessageAttachmentSummary } from '../inbox/types'
import type { AttachmentRow } from './types'

const MEDIA_PLACEHOLDERS = new Set(['[Imagem]', '[Documento]', '[Áudio]', '[Anexo]'])

/** Corpo é só o placeholder de mídia (sem legenda)? Vale também para mensagens antigas. */
export function isMediaPlaceholderBody(body: string): boolean {
  return MEDIA_PLACEHOLDERS.has(body.trim())
}

/** Legenda separada do placeholder; null quando não há legenda. */
export function captionFromBody(body: string): string | null {
  const t = body.trim()
  return t && !isMediaPlaceholderBody(t) ? body : null
}

export type AttachmentDisplayStatus = MessageAttachmentSummary['status']

/** Textos verificáveis por estado; a mensagem continua compreensível em falha. */
export function attachmentStatusLabel(status: AttachmentDisplayStatus): string {
  switch (status) {
    case 'pending':
      return 'Anexo a carregar'
    case 'ready':
      return 'Anexo recebido'
    case 'unavailable':
      return 'Anexo indisponível'
    case 'failed':
      return 'Não foi possível receber o anexo'
    case 'deleted':
      return 'Anexo removido'
  }
}

export function summarizeAttachment(a: AttachmentRow): MessageAttachmentSummary {
  if (a.deletedAt != null) {
    return {
      id: a.id,
      contentType: a.contentType,
      byteSize: 0,
      filename: null,
      status: 'deleted',
      failureCode: null,
      statusLabel: attachmentStatusLabel('deleted'),
      includedInAiContext: false,
    }
  }
  return {
    id: a.id,
    contentType: a.contentType,
    byteSize: a.byteSize,
    filename: a.filename,
    status: a.status,
    failureCode: a.failureCode,
    statusLabel: attachmentStatusLabel(a.status),
    includedInAiContext: false,
  }
}
