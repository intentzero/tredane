/**
 * Acesso ao bucket ATTACHMENTS — sempre com chave namespaced por tenant.
 * Sem URLs públicas; Content-Disposition: attachment evita execução no browser.
 */
import { attachmentR2Key, parseAttachmentR2Key, tenantAttachmentsPrefix } from './keys'

export type PutAttachmentObjectInput = {
  bucket: R2Bucket
  tenantId: string
  attachmentId: string
  bytes: Uint8Array
  contentType: string
  sha256Hex?: string | null
}

export type PutAttachmentObjectResult = {
  key: string
  etag: string | undefined
  size: number
}

export async function putAttachmentObject(
  input: PutAttachmentObjectInput,
): Promise<PutAttachmentObjectResult> {
  const key = attachmentR2Key(input.tenantId, input.attachmentId)
  const customMetadata: Record<string, string> = {
    tenantId: input.tenantId,
    attachmentId: input.attachmentId,
  }
  if (input.sha256Hex) customMetadata.sha256 = input.sha256Hex

  const result = await input.bucket.put(key, input.bytes, {
    httpMetadata: {
      contentType: input.contentType,
      contentDisposition: contentDispositionAttachment(input.attachmentId),
      cacheControl: 'private, no-store',
    },
    customMetadata,
  })
  return {
    key,
    etag: result?.etag,
    size: input.bytes.byteLength,
  }
}

export async function getAttachmentObject(
  bucket: R2Bucket,
  tenantId: string,
  attachmentId: string,
): Promise<R2ObjectBody | null> {
  const key = attachmentR2Key(tenantId, attachmentId)
  const obj = await bucket.get(key)
  if (!obj) return null
  const parsed = parseAttachmentR2Key(obj.key)
  if (!parsed || parsed.tenantId !== tenantId || parsed.attachmentId !== attachmentId) {
    return null
  }
  if (obj.customMetadata?.tenantId && obj.customMetadata.tenantId !== tenantId) {
    return null
  }
  return obj
}

export async function deleteAttachmentObject(
  bucket: R2Bucket,
  tenantId: string,
  attachmentId: string,
): Promise<void> {
  await bucket.delete(attachmentR2Key(tenantId, attachmentId))
}

/**
 * Lista chaves sob o prefixo do tenant (limpeza / exclusão REQ-071).
 * Paginação R2; caller decide o limite.
 */
export async function listTenantAttachmentKeys(
  bucket: R2Bucket,
  tenantId: string,
  opts: { cursor?: string; limit?: number } = {},
): Promise<{ keys: string[]; truncated: boolean; cursor?: string }> {
  const listed = await bucket.list({
    prefix: tenantAttachmentsPrefix(tenantId),
    cursor: opts.cursor,
    limit: opts.limit ?? 100,
  })
  return {
    keys: listed.objects.map((o) => o.key),
    truncated: listed.truncated,
    cursor: listed.truncated ? listed.cursor : undefined,
  }
}

export function contentDispositionAttachment(filenameHint: string): string {
  const safe = filenameHint.replace(/[^\w.-]+/g, '_').slice(0, 120) || 'attachment'
  return `attachment; filename="${safe}"`
}

/** Headers de resposta seguros — nunca inline para HTML/script. */
export function downloadResponseHeaders(input: {
  contentType: string
  filename: string | null
  byteSize: number
}): HeadersInit {
  const filename = (input.filename ?? 'attachment').replace(/[^\w.-]+/g, '_').slice(0, 120)
  return {
    'Content-Type': input.contentType,
    'Content-Length': String(input.byteSize),
    'Content-Disposition': `attachment; filename="${filename}"`,
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'private, no-store',
    'Content-Security-Policy': "default-src 'none'",
  }
}
