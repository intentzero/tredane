import {
  deleteAttachmentObject,
  listTenantAttachmentKeys,
} from '../attachments/r2'
import { parseAttachmentR2Key } from '../attachments/keys'

/**
 * Apaga todos os objectos sob o prefixo do tenant (REQ-071).
 * Idempotente — listar vazio = sucesso.
 */
export async function purgeTenantR2Prefix(
  bucket: R2Bucket,
  tenantId: string,
  opts: { maxPages?: number } = {},
): Promise<{ deletedKeys: number; pages: number }> {
  let deletedKeys = 0
  let pages = 0
  let cursor: string | undefined
  const maxPages = opts.maxPages ?? 50

  do {
    const listed = await listTenantAttachmentKeys(bucket, tenantId, {
      cursor,
      limit: 100,
    })
    pages += 1
    for (const key of listed.keys) {
      const parsed = parseAttachmentR2Key(key)
      if (parsed && parsed.tenantId === tenantId) {
        await deleteAttachmentObject(bucket, tenantId, parsed.attachmentId)
        deletedKeys += 1
      } else {
        await bucket.delete(key)
        deletedKeys += 1
      }
    }
    cursor = listed.truncated ? listed.cursor : undefined
    if (pages >= maxPages) break
  } while (cursor)

  return { deletedKeys, pages }
}

/** Apaga um conjunto conhecido de attachment ids (exclusão de contacto). */
export async function deleteAttachmentObjects(
  bucket: R2Bucket,
  tenantId: string,
  attachmentIds: string[],
): Promise<number> {
  let n = 0
  for (const id of attachmentIds) {
    await deleteAttachmentObject(bucket, tenantId, id)
    n += 1
  }
  return n
}
