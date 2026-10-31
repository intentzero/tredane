/**
 * Ingestão de mídia Meta → R2 + metadados SQLite (#34).
 * Ordem: pending no DO → download/validate/put R2 (fora TX) → ready|failed no DO
 * → mensagem lógica com caption/preview. Falha de R2 não inventa «enviado».
 */
import { putAttachmentObject } from '../attachments/r2'
import { defaultMimeForWhatsappType, type WhatsappMediaType } from '../attachments/policy'
import { sha256Hex, validateAttachmentBytes } from '../attachments/validate'
import { queueCaller } from '../clinic'
import type { ClinicDurableObject } from '../worker/clinic-do'
import type { WorkerBindings } from '../worker/bindings'
import {
  createMetaMediaAdapter,
  type MetaMediaAdapter,
} from './media'
import type { WhatsappWebhookQueueMessage } from './queue-types'
import { openAccessToken } from './crypto'
import { metaSealKeys } from '../security/sealed-secret'
import { getActiveBindingForTenant, getCredentialCipher } from './bindings'
import type { AdminDb } from '../db/admin/store'
import type { Clock } from '../db/clock'
import { systemClock } from '../db/clock'

export type MediaIngestClinicStub = {
  createPendingAttachment: (
    ...args: Parameters<ClinicDurableObject['createPendingAttachment']>
  ) => ReturnType<ClinicDurableObject['createPendingAttachment']> | Promise<unknown>
  markAttachmentReady: (
    ...args: Parameters<ClinicDurableObject['markAttachmentReady']>
  ) => ReturnType<ClinicDurableObject['markAttachmentReady']> | Promise<unknown>
  markAttachmentFailed: (
    ...args: Parameters<ClinicDurableObject['markAttachmentFailed']>
  ) => ReturnType<ClinicDurableObject['markAttachmentFailed']> | Promise<unknown>
  linkAttachmentToMessage: (
    ...args: Parameters<ClinicDurableObject['linkAttachmentToMessage']>
  ) => ReturnType<ClinicDurableObject['linkAttachmentToMessage']> | Promise<unknown>
  ingestMessage: (
    caller: Parameters<ClinicDurableObject['ingestMessage']>[0],
    input: Parameters<ClinicDurableObject['ingestMessage']>[1],
    opts?: Parameters<ClinicDurableObject['ingestMessage']>[2],
  ) => Promise<{
    duplicate?: boolean
    messageId: string | null
    conversationId: string | null
  }>
}

export type MediaIngestDeps = {
  env: WorkerBindings
  clock?: Clock
  syncAdminDb?: AdminDb | null
  clinicStub: MediaIngestClinicStub
  mediaAdapter?: MetaMediaAdapter
  log?: (entry: {
    level: 'info' | 'warn' | 'error'
    event: string
    detail: Record<string, unknown>
  }) => void
}

async function resolveAccessToken(
  deps: MediaIngestDeps,
  tenantId: string,
): Promise<string | null> {
  if (deps.syncAdminDb) {
    const binding = getActiveBindingForTenant(deps.syncAdminDb, tenantId)
    if (!binding) return null
    const cipher = getCredentialCipher(deps.syncAdminDb, binding.id)
    if (!cipher) return null
    return openAccessToken(
      cipher,
      metaSealKeys(deps.env),
    )
  }
  const row = await deps.env.DB.prepare(
    `SELECT c.access_token_cipher AS access_token_cipher
     FROM whatsapp_phone_bindings b
     LEFT JOIN whatsapp_credentials c ON c.binding_id = b.id
     WHERE b.tenant_id = ? AND b.status IN ('active', 'interrupted')
     LIMIT 1`,
  )
    .bind(tenantId)
    .first<{ access_token_cipher: string | null }>()
  if (!row?.access_token_cipher) return null
  return openAccessToken(
    row.access_token_cipher,
    metaSealKeys(deps.env),
  )
}

function asMediaType(messageType: string | undefined): WhatsappMediaType {
  if (messageType === 'image' || messageType === 'document' || messageType === 'audio') {
    return messageType
  }
  return 'image'
}

export type MediaIngestOutcome = {
  result: 'ack' | 'retry'
  /** #42 — para disparar push sem corpo da mensagem. */
  createdConversation?: boolean
  /** Mensagem nova (não duplicada) — push «Nova mensagem» se a conversa já existia. */
  newMessage?: boolean
  conversationId?: string | null
  badgeCount?: number
  suppressUserIds?: string[]
}

async function linkAfterIngest(
  stub: MediaIngestClinicStub,
  caller: ReturnType<typeof queueCaller>,
  attachmentId: string,
  msg: WhatsappWebhookQueueMessage,
): Promise<{
  createdConversation: boolean
  newMessage: boolean
  conversationId: string | null
  badgeCount?: number
  suppressUserIds?: string[]
}> {
  const ingested = (await stub.ingestMessage(
    caller,
    {
      providerEventKey: msg.providerEventKey,
      waId: msg.waId!,
      displayName: msg.displayName,
      body: msg.body!,
      occurredAtMs: msg.providerTimestamp ?? undefined,
    },
    { drain: true, fanout: true },
  )) as {
    messageId: string | null
    conversationId: string | null
    createdConversation?: boolean
    duplicate?: boolean
    suppressedTombstone?: boolean
    activeViewerUserIds?: string[]
    unreadConversations?: number
  }
  if (ingested.suppressedTombstone) {
    return {
      createdConversation: false,
      newMessage: false,
      conversationId: null,
    }
  }
  if (ingested.messageId && ingested.conversationId) {
    await stub.linkAttachmentToMessage(caller, {
      attachmentId,
      messageId: ingested.messageId,
      conversationId: ingested.conversationId,
    })
  }
  return {
    createdConversation: Boolean(ingested.createdConversation),
    newMessage: !ingested.duplicate && Boolean(ingested.messageId),
    badgeCount: ingested.unreadConversations,
    suppressUserIds: ingested.activeViewerUserIds,
    conversationId: ingested.conversationId ?? null,
  }
}

/**
 * Processa um item de fila `kind=media`.
 */
export async function ingestWhatsappMediaMessage(
  deps: MediaIngestDeps,
  msg: WhatsappWebhookQueueMessage,
): Promise<MediaIngestOutcome> {
  const log = deps.log
  const caller = queueCaller(msg.tenantId)
  const mediaType = asMediaType(msg.messageType)
  const contentTypeHint =
    msg.mediaMimeType?.split(';')[0]?.trim() ||
    defaultMimeForWhatsappType(mediaType)

  void (deps.clock ?? systemClock)

  if (!msg.waId || typeof msg.body !== 'string' || !msg.mediaId) {
    log?.({
      level: 'warn',
      event: 'media.invalid_shape',
      detail: { receiptId: msg.receiptId, tenantId: msg.tenantId },
    })
    return { result: 'ack' }
  }

  const pending = (await deps.clinicStub.createPendingAttachment(caller, {
    contentType: contentTypeHint,
    filename: msg.mediaFilename ?? null,
    source: 'whatsapp_inbound',
    providerMediaId: msg.mediaId,
  })) as { id: string; status: string }

  if (pending.status === 'ready') {
    const linked = await linkAfterIngest(deps.clinicStub, caller, pending.id, msg)
    return { result: 'ack', ...linked }
  }

  const token = await resolveAccessToken(deps, msg.tenantId)
  if (!token) {
    await deps.clinicStub.markAttachmentFailed(caller, {
      attachmentId: pending.id,
      failureCode: 'meta_token_missing',
      status: 'unavailable',
    })
    const linked = await linkAfterIngest(deps.clinicStub, caller, pending.id, msg)
    return { result: 'ack', ...linked }
  }

  const mediaAdapter = deps.mediaAdapter ?? createMetaMediaAdapter(deps.env)
  const downloaded = await mediaAdapter.downloadMedia({
    mediaId: msg.mediaId,
    accessToken: token,
  })

  if (downloaded.outcome !== 'succeeded') {
    await deps.clinicStub.markAttachmentFailed(caller, {
      attachmentId: pending.id,
      failureCode: downloaded.errorCode,
      status: 'unavailable',
    })
    const linked = await linkAfterIngest(deps.clinicStub, caller, pending.id, msg)
    log?.({
      level: 'warn',
      event: 'media.download_failed',
      detail: {
        tenantId: msg.tenantId,
        receiptId: msg.receiptId,
        errorCode: downloaded.errorCode,
      },
    })
    return { result: 'ack', ...linked }
  }

  const validation = validateAttachmentBytes({
    contentType: downloaded.contentType || contentTypeHint,
    bytes: downloaded.bytes,
    filename: downloaded.filename ?? msg.mediaFilename,
  })

  if (!validation.ok) {
    await deps.clinicStub.markAttachmentFailed(caller, {
      attachmentId: pending.id,
      failureCode: validation.code,
      status: 'failed',
    })
    const linked = await linkAfterIngest(deps.clinicStub, caller, pending.id, msg)
    log?.({
      level: 'warn',
      event: 'media.validation_failed',
      detail: {
        tenantId: msg.tenantId,
        receiptId: msg.receiptId,
        code: validation.code,
      },
    })
    return { result: 'ack', ...linked }
  }

  try {
    const hash = await sha256Hex(downloaded.bytes)
    await putAttachmentObject({
      bucket: deps.env.ATTACHMENTS,
      tenantId: msg.tenantId,
      attachmentId: pending.id,
      bytes: downloaded.bytes,
      contentType: validation.contentType,
      sha256Hex: hash,
    })
    await deps.clinicStub.markAttachmentReady(caller, {
      attachmentId: pending.id,
      byteSize: validation.byteSize,
      contentType: validation.contentType,
      sha256: hash,
      filename: downloaded.filename ?? msg.mediaFilename ?? null,
    })
  } catch (err) {
    const code = err instanceof Error ? err.message.slice(0, 80) : 'r2_put_failed'
    await deps.clinicStub.markAttachmentFailed(caller, {
      attachmentId: pending.id,
      failureCode: code,
      status: 'failed',
    })
    const linked = await linkAfterIngest(deps.clinicStub, caller, pending.id, msg)
    log?.({
      level: 'error',
      event: 'media.r2_put_failed',
      detail: { tenantId: msg.tenantId, receiptId: msg.receiptId, errorCode: code },
    })
    return { result: 'ack', ...linked }
  }

  const linked = await linkAfterIngest(deps.clinicStub, caller, pending.id, msg)
  log?.({
    level: 'info',
    event: 'media.ingested',
    detail: {
      tenantId: msg.tenantId,
      receiptId: msg.receiptId,
      attachmentId: pending.id,
    },
  })
  return { result: 'ack', ...linked }
}
