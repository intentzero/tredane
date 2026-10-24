/**
 * Normalização do payload oficial WhatsApp Cloud API (#32/#34).
 * Não cria tenant a partir de clinicId externo — só extrai phone_number_id / wamid.
 * Mídia piloto (image/document/audio) → kind `media`; restantes → unsupported.
 */
import {
  defaultMimeForWhatsappType,
  isWhatsappPilotMediaType,
  previewLabelForMedia,
  type WhatsappMediaType,
} from '../attachments/policy'

export type ParsedWebhookMedia = {
  mediaId: string
  mediaType: WhatsappMediaType
  mimeType: string | null
  filename: string | null
  caption: string | null
}

export type ParsedWebhookItem =
  | {
      kind: 'message'
      providerEventKey: string
      phoneNumberId: string
      waId: string
      displayName?: string
      body: string
      messageType: 'text'
      providerTimestamp: number | null
    }
  | {
      kind: 'media'
      providerEventKey: string
      phoneNumberId: string
      waId: string
      displayName?: string
      body: string
      messageType: WhatsappMediaType
      media: ParsedWebhookMedia
      providerTimestamp: number | null
    }
  | {
      kind: 'unsupported'
      providerEventKey: string
      phoneNumberId: string
      waId: string
      displayName?: string
      body: string
      messageType: string
      providerTimestamp: number | null
    }
  | {
      kind: 'status'
      providerEventKey: string
      phoneNumberId: string
      statusMessageId: string
      status: string
      providerTimestamp: number | null
    }
  | {
      kind: 'account_interrupt'
      providerEventKey: string
      phoneNumberId: string
      interruptReason: string
      providerTimestamp: number | null
    }

export type ParseWebhookResult = {
  items: ParsedWebhookItem[]
  /** Entradas sem phone_number_id / estrutura — não entram em clínica. */
  discarded: Array<{ reason: string; providerEventKey: string }>
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function parseUnixSeconds(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value > 1e12 ? Math.floor(value) : Math.floor(value * 1000)
  }
  if (typeof value === 'string' && value.length > 0) {
    const n = Number(value)
    if (!Number.isFinite(n)) return null
    return n > 1e12 ? Math.floor(n) : Math.floor(n * 1000)
  }
  return null
}

function textBody(message: Record<string, unknown>): string | null {
  const text = asRecord(message.text)
  const body = text ? asString(text.body) : null
  return body
}

function unsupportedBody(messageType: string): string {
  return `[Tipo não suportado: ${messageType}] — fora da política piloto de anexos; mensagem registada para não ser ignorada.`
}

function extractMedia(
  message: Record<string, unknown>,
  messageType: WhatsappMediaType,
): ParsedWebhookMedia | null {
  const block = asRecord(message[messageType])
  if (!block) return null
  const mediaId = asString(block.id)
  if (!mediaId) return null
  return {
    mediaId,
    mediaType: messageType,
    mimeType: asString(block.mime_type),
    filename: asString(block.filename),
    caption: asString(block.caption),
  }
}

function mediaBody(media: ParsedWebhookMedia): string {
  const caption = media.caption?.trim()
  if (caption) return caption
  return previewLabelForMedia(media.mediaType)
}

/**
 * Extrai itens processáveis de um body JSON já verificado por assinatura.
 */
export function parseWhatsappWebhookPayload(rawJson: unknown): ParseWebhookResult {
  const items: ParsedWebhookItem[] = []
  const discarded: ParseWebhookResult['discarded'] = []
  const root = asRecord(rawJson)
  if (!root) {
    discarded.push({ reason: 'invalid_json_root', providerEventKey: 'wa:discard:invalid_root' })
    return { items, discarded }
  }

  const entries = Array.isArray(root.entry) ? root.entry : []
  if (entries.length === 0) {
    discarded.push({ reason: 'empty_entry', providerEventKey: 'wa:discard:empty_entry' })
    return { items, discarded }
  }

  for (const entry of entries) {
    const entryObj = asRecord(entry)
    if (!entryObj) continue
    const changes = Array.isArray(entryObj.changes) ? entryObj.changes : []
    for (const change of changes) {
      const changeObj = asRecord(change)
      if (!changeObj) continue
      const value = asRecord(changeObj.value)
      if (!value) continue

      const metadata = asRecord(value.metadata)
      const phoneNumberId = metadata ? asString(metadata.phone_number_id) : null
      const field = asString(changeObj.field) ?? 'messages'

      if (field === 'account_update' || field === 'account_alerts') {
        const phoneFromValue =
          phoneNumberId ??
          asString(value.phone_number_id) ??
          asString(asRecord(value.phone_number)?.id)
        if (!phoneFromValue) {
          discarded.push({
            reason: 'account_without_phone',
            providerEventKey: `wa:discard:account:${asString(entryObj.id) ?? 'unknown'}`,
          })
          continue
        }
        const event = asString(value.event) ?? asString(value.alert_type) ?? 'account_update'
        const interruptLike =
          /BAN|DISABLED|ACCOUNT_VIOLATION|disconnected|RESTRICT|DELETED/i.test(event) ||
          field === 'account_alerts'
        if (interruptLike) {
          items.push({
            kind: 'account_interrupt',
            providerEventKey: `wa:account:${phoneFromValue}:${event}:${asString(entryObj.id) ?? 'evt'}`,
            phoneNumberId: phoneFromValue,
            interruptReason: event,
            providerTimestamp: parseUnixSeconds(value.timestamp),
          })
        } else {
          discarded.push({
            reason: `account_event_ignored:${event}`,
            providerEventKey: `wa:discard:account:${phoneFromValue}:${event}`,
          })
        }
        continue
      }

      if (!phoneNumberId) {
        discarded.push({
          reason: 'missing_phone_number_id',
          providerEventKey: `wa:discard:nophone:${asString(entryObj.id) ?? 'unknown'}`,
        })
        continue
      }

      const contacts = Array.isArray(value.contacts) ? value.contacts : []
      const contactNameByWa = new Map<string, string>()
      for (const c of contacts) {
        const cObj = asRecord(c)
        if (!cObj) continue
        const wa = asString(cObj.wa_id)
        const profile = asRecord(cObj.profile)
        const name = profile ? asString(profile.name) : null
        if (wa && name) contactNameByWa.set(wa, name)
      }

      const messages = Array.isArray(value.messages) ? value.messages : []
      for (const msg of messages) {
        const m = asRecord(msg)
        if (!m) continue
        const id = asString(m.id)
        const from = asString(m.from)
        if (!id || !from) {
          discarded.push({
            reason: 'message_missing_id_or_from',
            providerEventKey: `wa:discard:msg:${phoneNumberId}`,
          })
          continue
        }
        const messageType = asString(m.type) ?? 'unknown'
        const providerTimestamp = parseUnixSeconds(m.timestamp)
        const displayName = contactNameByWa.get(from)
        if (messageType === 'text' && textBody(m)) {
          items.push({
            kind: 'message',
            providerEventKey: `wa:msg:${id}`,
            phoneNumberId,
            waId: from,
            displayName,
            body: textBody(m)!,
            messageType: 'text',
            providerTimestamp,
          })
        } else if (isWhatsappMessageMedia(messageType)) {
          const media = extractMedia(m, messageType)
          if (!media) {
            items.push({
              kind: 'unsupported',
              providerEventKey: `wa:msg:${id}`,
              phoneNumberId,
              waId: from,
              displayName,
              body: unsupportedBody(messageType),
              messageType,
              providerTimestamp,
            })
          } else {
            items.push({
              kind: 'media',
              providerEventKey: `wa:msg:${id}`,
              phoneNumberId,
              waId: from,
              displayName,
              body: mediaBody(media),
              messageType,
              media: {
                ...media,
                mimeType: media.mimeType ?? defaultMimeForWhatsappType(messageType),
              },
              providerTimestamp,
            })
          }
        } else {
          items.push({
            kind: 'unsupported',
            providerEventKey: `wa:msg:${id}`,
            phoneNumberId,
            waId: from,
            displayName,
            body: unsupportedBody(messageType),
            messageType,
            providerTimestamp,
          })
        }
      }

      const statuses = Array.isArray(value.statuses) ? value.statuses : []
      for (const st of statuses) {
        const s = asRecord(st)
        if (!s) continue
        const id = asString(s.id)
        const status = asString(s.status)
        if (!id || !status) {
          discarded.push({
            reason: 'status_missing_fields',
            providerEventKey: `wa:discard:status:${phoneNumberId}`,
          })
          continue
        }
        items.push({
          kind: 'status',
          providerEventKey: `wa:status:${id}:${status}`,
          phoneNumberId,
          statusMessageId: id,
          status,
          providerTimestamp: parseUnixSeconds(s.timestamp),
        })
      }
    }
  }

  return { items, discarded }
}

function isWhatsappMessageMedia(type: string): type is WhatsappMediaType {
  return isWhatsappPilotMediaType(type)
}
