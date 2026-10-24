/**
 * Namespace R2 por clínica — DEC-038 / tenant-boundaries.
 * Nunca servir objecto só com chave fornecida pelo cliente; sempre revalidar
 * tenant + membership + metadados SQLite.
 */

const TENANT_SEGMENT = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/
const ATTACHMENT_SEGMENT = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/

export function attachmentR2Key(tenantId: string, attachmentId: string): string {
  if (!TENANT_SEGMENT.test(tenantId)) {
    throw new Error('invalid_tenant_id_for_r2_key')
  }
  if (!ATTACHMENT_SEGMENT.test(attachmentId)) {
    throw new Error('invalid_attachment_id_for_r2_key')
  }
  return `tenants/${tenantId}/attachments/${attachmentId}`
}

export function tenantAttachmentsPrefix(tenantId: string): string {
  if (!TENANT_SEGMENT.test(tenantId)) {
    throw new Error('invalid_tenant_id_for_r2_prefix')
  }
  return `tenants/${tenantId}/attachments/`
}

/**
 * Extrai tenantId da chave canónica. Rejeita chaves fora do namespace.
 */
export function parseAttachmentR2Key(
  key: string,
): { tenantId: string; attachmentId: string } | null {
  const m = /^tenants\/([^/]+)\/attachments\/([^/]+)$/.exec(key)
  if (!m) return null
  const tenantId = m[1]!
  const attachmentId = m[2]!
  if (!TENANT_SEGMENT.test(tenantId) || !ATTACHMENT_SEGMENT.test(attachmentId)) {
    return null
  }
  return { tenantId, attachmentId }
}

/** Origens de download autorizadas (Worker apenas — sem URL pública R2). */
export const ATTACHMENT_DOWNLOAD_ORIGINS = [
  'worker_authenticated',
  'worker_ephemeral_token',
] as const

export type AttachmentDownloadOrigin = (typeof ATTACHMENT_DOWNLOAD_ORIGINS)[number]
