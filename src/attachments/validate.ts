/**
 * Validação de tipo/tamanho/conteúdo antes de gravar em R2 (#34).
 * URLs externas não autorizadas são recusadas — só ingestão Meta ou upload
 * autenticado com bytes no Worker.
 */
import {
  isAllowedContentType,
  maxBytesForContentType,
  PILOT_BLOCKED_CONTENT_TYPES,
} from './policy'

export type AttachmentValidationOk = {
  ok: true
  contentType: string
  byteSize: number
}

export type AttachmentValidationErr = {
  ok: false
  code:
    | 'type_blocked'
    | 'type_not_allowed'
    | 'size_exceeded'
    | 'empty_body'
    | 'external_url_forbidden'
    | 'filename_invalid'
  message: string
}

export type AttachmentValidationResult =
  | AttachmentValidationOk
  | AttachmentValidationErr

const SAFE_FILENAME = /^[\w.\- ()\u00C0-\u024F]{1,180}$/u

/** Magic bytes mínimos (não substitui antivírus; reduz MIME spoof óbvio). */
function sniffLooksPlausible(contentType: string, bytes: Uint8Array): boolean {
  if (bytes.length < 4) return false
  const ct = contentType.toLowerCase().split(';')[0]!.trim()
  if (ct === 'image/jpeg') {
    return bytes[0] === 0xff && bytes[1] === 0xd8
  }
  if (ct === 'image/png') {
    return (
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x4e &&
      bytes[3] === 0x47
    )
  }
  if (ct === 'image/webp') {
    return (
      bytes[0] === 0x52 &&
      bytes[1] === 0x49 &&
      bytes[2] === 0x46 &&
      bytes[3] === 0x46
    )
  }
  if (ct === 'application/pdf') {
    return (
      bytes[0] === 0x25 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x44 &&
      bytes[3] === 0x46
    )
  }
  // Áudio: Ogg / ID3 / ftyp — aceitar se tamanho ok (sniff fraco).
  if (ct.startsWith('audio/')) return true
  return false
}

export function validateAttachmentBytes(input: {
  contentType: string
  bytes: Uint8Array
  filename?: string | null
}): AttachmentValidationResult {
  const contentType = input.contentType.toLowerCase().split(';')[0]!.trim()
  if (!contentType) {
    return { ok: false, code: 'type_not_allowed', message: 'Content-Type em falta' }
  }
  if ((PILOT_BLOCKED_CONTENT_TYPES as readonly string[]).includes(contentType)) {
    return {
      ok: false,
      code: 'type_blocked',
      message: `Tipo bloqueado: ${contentType}`,
    }
  }
  if (!isAllowedContentType(contentType)) {
    return {
      ok: false,
      code: 'type_not_allowed',
      message: `Tipo não permitido no piloto: ${contentType}`,
    }
  }
  if (input.bytes.byteLength === 0) {
    return { ok: false, code: 'empty_body', message: 'Corpo vazio' }
  }
  const max = maxBytesForContentType(contentType)
  if (max == null || input.bytes.byteLength > max) {
    return {
      ok: false,
      code: 'size_exceeded',
      message: `Ficheiro acima do limite (${max ?? 0} bytes)`,
    }
  }
  if (!sniffLooksPlausible(contentType, input.bytes)) {
    return {
      ok: false,
      code: 'type_blocked',
      message: 'Conteúdo incompatível com o Content-Type declarado',
    }
  }
  if (input.filename != null && input.filename !== '') {
    if (!SAFE_FILENAME.test(input.filename) || input.filename.includes('..')) {
      return {
        ok: false,
        code: 'filename_invalid',
        message: 'Nome de ficheiro inválido',
      }
    }
  }
  return { ok: true, contentType, byteSize: input.bytes.byteLength }
}

/**
 * Recusa download/proxy a partir de URL externa fornecida pelo cliente.
 * Ingestão Meta usa o adaptador com media_id — nunca URL arbitrária do browser.
 */
export function assertNoExternalDownloadUrl(url: string | null | undefined): AttachmentValidationErr | null {
  if (url == null || url === '') return null
  return {
    ok: false,
    code: 'external_url_forbidden',
    message: 'URL externa não autorizada para anexos',
  }
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  const digest = await crypto.subtle.digest('SHA-256', copy)
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}
