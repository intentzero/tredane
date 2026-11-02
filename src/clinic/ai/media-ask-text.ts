/**
 * CF-26 / DEC-119 / DEC-130: áudio ou imagem sem texto pedem que a cliente escreva;
 * comprovativo de pagamento e segunda mídia após o pedido passam à equipe (DEC-083).
 * Deteção pelo anexo (`attachments.content_type`), não pelo texto do marcador.
 * DEC-067 inalterada: mídia não vai à IA nem se transcreve.
 */
import type { Clock } from '../../db/clock'
import { previewLabelForMedia, type WhatsappMediaType } from '../../attachments/policy'
import { isMediaPlaceholderBody } from '../attachments/display'
import { contactHasPendingPix } from '../inbox/pending-pix'
import type { ClinicDb } from '../store'

/** Frase Confirmada (DEC-130). Sem nome, sem jargão. */
export const MEDIA_ASK_TEXT =
  'Ainda não consigo ouvir áudios nem ver imagens. Pode escrever o que precisa?'

/** Texto de pagamento na mesma mensagem ou na anterior (DEC-119 §5). */
export const PAYMENT_PROOF_TEXT_RE =
  /\b(comprovante|comprovativo|comprovante\s+de\s+pagamento|j[aá]\s+paguei|paguei(\s+o)?\s+(pix|sinal)|pagamento(\s+do)?\s+(pix|sinal)|pix\s+(pago|enviado)|transfer[iê]|enviei\s+o\s+pix|segue\s+o\s+comprovante)\b/i

/** Cobrança «recente»: criada ou paga nas últimas 48 h. */
const RECENT_PIX_MS = 48 * 60 * 60 * 1000

export type MediaAttachmentKind = 'audio' | 'image' | 'document'

export type MediaOnlyDecision =
  | { action: 'none' }
  | { action: 'ask_text' }
  | { action: 'handoff'; reason: 'payment_proof' | 'media_after_ask' }

function kindFromContentType(contentType: string): MediaAttachmentKind | null {
  const ct = contentType.toLowerCase().split(';')[0]!.trim()
  if (ct.startsWith('audio/')) return 'audio'
  if (ct.startsWith('image/')) return 'image'
  if (
    ct === 'application/pdf' ||
    ct.startsWith('application/') ||
    ct === 'text/plain'
  ) {
    return 'document'
  }
  return null
}

/** Anexos de mídia WhatsApp ligados à mensagem (deteção autoritativa). */
export function mediaKindsForMessage(
  db: ClinicDb,
  tenantId: string,
  messageId: string,
): MediaAttachmentKind[] {
  const rows = db.all<{ content_type: string }>(
    `SELECT content_type FROM attachments
     WHERE tenant_id = ? AND message_id = ? AND deleted_at IS NULL`,
    tenantId,
    messageId,
  )
  const kinds: MediaAttachmentKind[] = []
  for (const r of rows) {
    const k = kindFromContentType(r.content_type)
    if (k && !kinds.includes(k)) kinds.push(k)
  }
  return kinds
}

/**
 * Mensagem é só mídia (áudio, ou imagem/documento sem legenda)?
 * Áudio nunca tem legenda útil (DEC-119). Imagem/documento com legenda → false.
 */
export function isMediaOnlyMessage(
  db: ClinicDb,
  tenantId: string,
  messageId: string,
  body: string,
): boolean {
  const kinds = mediaKindsForMessage(db, tenantId, messageId)
  if (kinds.length === 0) return false
  if (kinds.includes('audio')) return true
  // Imagem ou documento: legenda real = corpo que não é o marcador.
  const trimmed = body.trim()
  if (!trimmed || isMediaPlaceholderBody(trimmed)) return true
  return false
}

export function conversationAlreadyAskedMediaText(
  db: ClinicDb,
  tenantId: string,
  conversationId: string,
): boolean {
  const row = db.get<{ n: number }>(
    `SELECT COUNT(*) AS n FROM messages
     WHERE tenant_id = ? AND conversation_id = ?
       AND direction = 'outbound' AND body = ?`,
    tenantId,
    conversationId,
    MEDIA_ASK_TEXT,
  )
  return (row?.n ?? 0) > 0
}

export function contactHasRecentPix(
  db: ClinicDb,
  tenantId: string,
  contactId: string,
  nowMs: number,
): boolean {
  if (contactHasPendingPix(db, tenantId, contactId, nowMs)) return true
  const since = nowMs - RECENT_PIX_MS
  const row = db.get<{ n: number }>(
    `SELECT COUNT(*) AS n FROM pix_charges
     WHERE tenant_id = ? AND contact_id = ?
       AND (
         created_at >= ?
         OR (paid_at IS NOT NULL AND paid_at >= ?)
       )`,
    tenantId,
    contactId,
    since,
    since,
  )
  return (row?.n ?? 0) > 0
}

function previousInboundBody(
  db: ClinicDb,
  tenantId: string,
  conversationId: string,
  messageId: string,
): string | null {
  const current = db.get<{ created_at: number }>(
    `SELECT created_at FROM messages WHERE tenant_id = ? AND id = ?`,
    tenantId,
    messageId,
  )
  if (!current) return null
  const prev = db.get<{ body: string }>(
    `SELECT body FROM messages
     WHERE tenant_id = ? AND conversation_id = ? AND direction = 'inbound'
       AND created_at < ?
     ORDER BY created_at DESC, rowid DESC
     LIMIT 1`,
    tenantId,
    conversationId,
    current.created_at,
  )
  return prev?.body ?? null
}

export function looksLikePaymentProofText(text: string | null | undefined): boolean {
  if (!text?.trim()) return false
  return PAYMENT_PROOF_TEXT_RE.test(text)
}

/**
 * Decide o caminho DEC-119 para a mensagem do job.
 * Só age quando a mensagem tem anexo de mídia sem legenda útil.
 */
export function decideMediaOnlyTurn(
  db: ClinicDb,
  tenantId: string,
  input: {
    conversationId: string
    contactId: string
    messageId: string
    body: string
  },
  clock: Clock,
): MediaOnlyDecision {
  if (!isMediaOnlyMessage(db, tenantId, input.messageId, input.body)) {
    return { action: 'none' }
  }

  const now = clock.nowMs()
  const prev = previousInboundBody(db, tenantId, input.conversationId, input.messageId)
  const payment =
    contactHasRecentPix(db, tenantId, input.contactId, now) ||
    looksLikePaymentProofText(input.body) ||
    looksLikePaymentProofText(prev)

  if (payment) return { action: 'handoff', reason: 'payment_proof' }

  if (conversationAlreadyAskedMediaText(db, tenantId, input.conversationId)) {
    return { action: 'handoff', reason: 'media_after_ask' }
  }

  return { action: 'ask_text' }
}

/** Corpo de mensagem inbound que não deve entrar no contexto do modelo como fala. */
export function redactMediaPlaceholderForAiContext(body: string): string | null {
  if (isMediaPlaceholderBody(body)) return null
  return body
}

export function previewBodyForMediaKind(kind: MediaAttachmentKind): string {
  return previewLabelForMedia(kind as WhatsappMediaType)
}
