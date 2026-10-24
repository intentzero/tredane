/**
 * Política mínima de anexos para o piloto (#34).
 *
 * Estados:
 * - Tipos/tamanhos abaixo: **Proposto** (fixtures sintéticas até Meta live / #18).
 * - Retenção de objectos e validade de links: ver `RETENTION` — parcialmente
 *   Confirmado (DEC-011) e residual **Em aberto**.
 * - Envio de anexo pela equipa (UI): **Em aberto** (DEC-011 / ux-ui.md); a API
 *   de upload valida e guarda, mas o compositor não activa o fluxo.
 * - Prontuário / imagem clínica / formatos médicos: **Fora do MVP**.
 */

/** Tipos MIME permitidos no piloto (Proposto). */
export const PILOT_ALLOWED_CONTENT_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
  'audio/ogg',
  'audio/mpeg',
  'audio/mp4',
] as const

export type PilotAllowedContentType = (typeof PILOT_ALLOWED_CONTENT_TYPES)[number]

/** Limites por família (bytes) — Proposto para o piloto. */
export const PILOT_MAX_BYTES: Record<'image' | 'pdf' | 'audio', number> = {
  image: 5 * 1024 * 1024,
  pdf: 10 * 1024 * 1024,
  audio: 16 * 1024 * 1024,
}

/** Tipos explicitamente bloqueados (execução / XSS / contentores). */
export const PILOT_BLOCKED_CONTENT_TYPES = [
  'text/html',
  'application/xhtml+xml',
  'image/svg+xml',
  'application/javascript',
  'text/javascript',
  'application/x-msdownload',
  'application/x-executable',
  'application/zip',
  'application/x-zip-compressed',
  'application/vnd.microsoft.portable-executable',
] as const

/**
 * Retenção e validade — misturar Confirmado / Em aberto sem promover.
 * Confirmado (DEC-011 / REQ-071): dados enquanto cliente; exclusão de contacto
 * apaga anexos; encerramento do tenant → expurgo do prefixo R2 em ≤30 dias.
 */
export const RETENTION = {
  /** Confirmado: exclusão de contacto apaga mensagens e anexos (REQ-071). */
  contactDeletionDeletesAttachments: true as const,
  /** Confirmado: encerramento da conta → exclusão total em até 30 dias. */
  tenantDeletionMaxDays: 30 as const,
  /**
   * Proposto: token de download efémero (HMAC); renovável com auth vigente.
   * Não é URL pública permanente (tenant-boundaries / DEC-038).
   */
  ephemeralDownloadTtlMs: 15 * 60 * 1000,
  /**
   * Proposto: anexos `pending` sem blob R2 após este prazo → `failed` + limpeza.
   * Política fina de conservação de órfãos: **Em aberto** (VAL-09 / revisão jurídica).
   */
  orphanPendingMaxAgeMs: 24 * 60 * 60 * 1000,
  /**
   * Em aberto: prazo específico de conservação de anexos para além de DEC-011
   * (logs técnicos, cópias Meta, recuperação parcial). Não inventar política.
   */
  detailedRetentionPolicy: 'em_aberto' as const,
  /** Confirmado (DEC-011): anexos nunca entram no contexto IA. */
  attachmentsNeverInAiContext: true as const,
} as const

export function contentFamily(
  contentType: string,
): 'image' | 'pdf' | 'audio' | null {
  const ct = contentType.toLowerCase().split(';')[0]!.trim()
  if (ct.startsWith('image/')) return 'image'
  if (ct === 'application/pdf') return 'pdf'
  if (ct.startsWith('audio/')) return 'audio'
  return null
}

export function maxBytesForContentType(contentType: string): number | null {
  const family = contentFamily(contentType)
  if (!family) return null
  return PILOT_MAX_BYTES[family]
}

export function isAllowedContentType(contentType: string): boolean {
  const ct = contentType.toLowerCase().split(';')[0]!.trim()
  if ((PILOT_BLOCKED_CONTENT_TYPES as readonly string[]).includes(ct)) {
    return false
  }
  return (PILOT_ALLOWED_CONTENT_TYPES as readonly string[]).includes(ct)
}

/** Tipos WhatsApp Cloud API mapeados para MIME piloto (Proposto). */
export const WHATSAPP_MEDIA_TYPES = ['image', 'document', 'audio'] as const

export type WhatsappMediaType = (typeof WHATSAPP_MEDIA_TYPES)[number]

export function isWhatsappPilotMediaType(type: string): type is WhatsappMediaType {
  return (WHATSAPP_MEDIA_TYPES as readonly string[]).includes(type)
}

export function defaultMimeForWhatsappType(type: WhatsappMediaType): string {
  switch (type) {
    case 'image':
      return 'image/jpeg'
    case 'document':
      return 'application/pdf'
    case 'audio':
      return 'audio/ogg'
  }
}

export function previewLabelForMedia(type: WhatsappMediaType | string): string {
  switch (type) {
    case 'image':
      return '[Imagem]'
    case 'document':
      return '[Documento]'
    case 'audio':
      return '[Áudio]'
    default:
      return '[Anexo]'
  }
}
