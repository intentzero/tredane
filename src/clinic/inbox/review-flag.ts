/**
 * DEC-157 / DEC-166 / DEC-167 — fila de revisão de conversas.
 * Flag no SQLite do Clinic DO; não pausa IA nem limpa BookingFrame.
 * DEC-166: comentário livre opcional após «avaliar» / «feedback».
 * DEC-167: cada comentário em re-flag é appendado (metadados do flag
 * continuam first-flag-wins); outbox dispara upsert D1.
 */
import type { Clock } from '../../db/clock'
import { insertOutboxEvent, type OutboxRow } from '../outbox'
import type { ClinicDb } from '../store'
import { assertClinicSchemaReady } from '../migrations'
import { requireConversation } from './conversations'

export const REVIEW_FLAG_SOURCES = ['client', 'staff', 'auto'] as const
export type ReviewFlagSource = (typeof REVIEW_FLAG_SOURCES)[number]

export const REVIEW_FLAG_REASONS = ['client_request', 'staff', 'nao_encontrei'] as const
export type ReviewFlagReason = (typeof REVIEW_FLAG_REASONS)[number]

export type ReviewFlagState = {
  flaggedAt: number
  source: ReviewFlagSource
  reason: ReviewFlagReason | null
  /**
   * 1.º comentário livre (DEC-166); null se ainda não houve texto.
   * Mantido estável em re-flag (DEC-167).
   */
  clientComment: string | null
  /** Todos os comentários na ordem de chegada (DEC-167). */
  clientComments: string[]
}

/** Serializa a lista de comentários para a coluna JSON do DO. */
export function serializeClientComments(comments: readonly string[]): string | null {
  if (comments.length === 0) return null
  return JSON.stringify(comments)
}

/**
 * Lê a lista a partir de `review_client_comments` (JSON) com fallback
 * lazy para o 1.º comentário em `review_client_comment` (0061).
 */
export function parseStoredClientComments(
  commentsJson: string | null | undefined,
  firstComment: string | null | undefined,
): string[] {
  if (typeof commentsJson === 'string' && commentsJson.trim() !== '') {
    try {
      const parsed: unknown = JSON.parse(commentsJson)
      if (Array.isArray(parsed)) {
        return parsed
          .filter((c): c is string => typeof c === 'string')
          .map((c) => c.trim())
          .filter((c) => c.length > 0)
          .map((c) => c.slice(0, REVIEW_FLAG_CLIENT_COMMENT_MAX_LEN))
      }
    } catch {
      /* fallback abaixo */
    }
  }
  if (typeof firstComment === 'string' && firstComment.trim() !== '') {
    return [firstComment.trim().slice(0, REVIEW_FLAG_CLIENT_COMMENT_MAX_LEN)]
  }
  return []
}

export function readReviewFlag(
  db: ClinicDb,
  tenantId: string,
  conversationId: string,
): ReviewFlagState | null {
  assertClinicSchemaReady(db)
  const row = db.get<{
    review_flagged_at: number | null
    review_flagged_source: string | null
    review_flag_reason: string | null
    review_client_comment: string | null
    review_client_comments: string | null
  }>(
    `SELECT review_flagged_at, review_flagged_source, review_flag_reason,
            review_client_comment, review_client_comments
     FROM conversations WHERE tenant_id = ? AND id = ?`,
    tenantId,
    conversationId,
  )
  if (!row?.review_flagged_at) return null
  const source = (REVIEW_FLAG_SOURCES as readonly string[]).includes(
    row.review_flagged_source ?? '',
  )
    ? (row.review_flagged_source as ReviewFlagSource)
    : 'staff'
  const reason =
    row.review_flag_reason &&
    (REVIEW_FLAG_REASONS as readonly string[]).includes(row.review_flag_reason)
      ? (row.review_flag_reason as ReviewFlagReason)
      : null
  const clientComments = parseStoredClientComments(
    row.review_client_comments,
    row.review_client_comment,
  )
  const clientComment = clientComments[0] ?? null
  return { flaggedAt: row.review_flagged_at, source, reason, clientComment, clientComments }
}

/**
 * Marca para revisão. Metadados (source/at/reason) são first-flag-wins.
 * DEC-167: se já flagged e chega comentário novo, appenda e emite outbox
 * para o upsert D1 (sem alterar source/at/reason).
 */
export function flagConversationForReview(
  db: ClinicDb,
  tenantId: string,
  conversationId: string,
  input: {
    source: ReviewFlagSource
    reason: ReviewFlagReason
    clientComment?: string | null
  },
  clock: Clock,
): { changed: boolean; outbox: OutboxRow[] } {
  assertClinicSchemaReady(db)
  requireConversation(db, tenantId, conversationId)
  const existing = readReviewFlag(db, tenantId, conversationId)
  const incoming = normalizeStoredClientComment(input.clientComment)
  const now = clock.nowMs()

  if (existing) {
    if (!incoming) return { changed: false, outbox: [] }
    const clientComments = [...existing.clientComments, incoming]
    const firstComment = clientComments[0] ?? null
    db.run(
      `UPDATE conversations
       SET review_client_comment = ?, review_client_comments = ?, updated_at = ?
       WHERE tenant_id = ? AND id = ?`,
      firstComment,
      serializeClientComments(clientComments),
      now,
      tenantId,
      conversationId,
    )
    const outbox = [
      insertOutboxEvent(
        db,
        {
          tenantId,
          type: 'conversation.review_flagged',
          aggregateType: 'conversation',
          aggregateId: conversationId,
          idempotencyKey: `conversation.review_flagged:${conversationId}:${now}:comment`,
          payload: {
            conversationId,
            source: existing.source,
            reason: existing.reason,
            reviewFlaggedAt: existing.flaggedAt,
            clientComment: firstComment,
            clientComments,
            commentAppended: true,
          },
        },
        clock,
      ),
    ]
    return { changed: true, outbox }
  }

  const clientComments = incoming ? [incoming] : []
  const clientComment = clientComments[0] ?? null
  db.run(
    `UPDATE conversations
     SET review_flagged_at = ?, review_flagged_source = ?, review_flag_reason = ?,
         review_client_comment = ?, review_client_comments = ?, updated_at = ?
     WHERE tenant_id = ? AND id = ?`,
    now,
    input.source,
    input.reason,
    clientComment,
    serializeClientComments(clientComments),
    now,
    tenantId,
    conversationId,
  )
  const outbox = [
    insertOutboxEvent(
      db,
      {
        tenantId,
        type: 'conversation.review_flagged',
        aggregateType: 'conversation',
        aggregateId: conversationId,
        idempotencyKey: `conversation.review_flagged:${conversationId}:${now}`,
        payload: {
          conversationId,
          source: input.source,
          reason: input.reason,
          reviewFlaggedAt: now,
          clientComment,
          clientComments,
          commentAppended: false,
        },
      },
      clock,
    ),
  ]
  return { changed: true, outbox }
}

export function clearConversationReviewFlag(
  db: ClinicDb,
  tenantId: string,
  conversationId: string,
  clock: Clock,
): { changed: boolean; outbox: OutboxRow[] } {
  assertClinicSchemaReady(db)
  requireConversation(db, tenantId, conversationId)
  const existing = readReviewFlag(db, tenantId, conversationId)
  if (!existing) return { changed: false, outbox: [] }
  const now = clock.nowMs()
  db.run(
    `UPDATE conversations
     SET review_flagged_at = NULL, review_flagged_source = NULL, review_flag_reason = NULL,
         review_client_comment = NULL, review_client_comments = NULL, updated_at = ?
     WHERE tenant_id = ? AND id = ?`,
    now,
    tenantId,
    conversationId,
  )
  const outbox = [
    insertOutboxEvent(
      db,
      {
        tenantId,
        type: 'conversation.review_cleared',
        aggregateType: 'conversation',
        aggregateId: conversationId,
        idempotencyKey: `conversation.review_cleared:${conversationId}:${now}`,
        payload: {
          conversationId,
          clearedAt: now,
          previousSource: existing.source,
        },
      },
      clock,
    ),
  ]
  return { changed: true, outbox }
}

/** DEC-104 — ack ao pedido «avaliar» / «feedback». */
export const REVIEW_FLAG_CLIENT_ACK =
  'Obrigado. Marquei esta conversa para a equipe revisar.'

/**
 * Botões reply no ack de revisão (TRE-29 / Paulo 13/11/2026).
 * Continuar → retoma marcação (mesmo caminho do Prosseguir idle / DEC-087).
 * Terminar → encerra sessão (mesmo caminho Terminar idle/DEC-086).
 */
export const REVIEW_FLAG_ACK_BUTTONS = {
  continue: { idSuffix: 'continue', title: 'Continuar' },
  end: { idSuffix: 'end', title: 'Terminar' },
} as const

/** Id opaco: fu:review:{conversationId}:{continue|end} */
export function reviewFlagAckButtonId(
  conversationId: string,
  action: 'continue' | 'end',
): string {
  return `fu:review:${conversationId}:${action}`
}

export function parseReviewFlagAckButtonId(
  raw: string,
): { conversationId: string; action: 'continue' | 'end' } | null {
  const m = /^fu:review:([^:]+):(continue|end)$/.exec(raw.trim())
  if (!m) return null
  return { conversationId: m[1]!, action: m[2] as 'continue' | 'end' }
}

export function reviewFlagAckInteractiveButtons(
  conversationId: string,
): Array<{ id: string; title: string }> {
  return [
    {
      id: reviewFlagAckButtonId(conversationId, 'continue'),
      title: REVIEW_FLAG_ACK_BUTTONS.continue.title,
    },
    {
      id: reviewFlagAckButtonId(conversationId, 'end'),
      title: REVIEW_FLAG_ACK_BUTTONS.end.title,
    },
  ]
}

/** Corpo normalizado máximo (keyword + comentário opcional). */
export const REVIEW_FLAG_REQUEST_MAX_LEN = 500

/** Comentário guardado por pedido Avaliar/feedback. */
export const REVIEW_FLAG_CLIENT_COMMENT_MAX_LEN = 400

/**
 * Normaliza o comando WhatsApp: trim, minúsculas, sem acentos.
 * Case («Avaliar» / «AVALIAR») e pontuação final não devem falhar o match.
 */
export function normalizeReviewFlagText(text: string): string {
  return (text ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .trim()
    .toLowerCase()
}

/**
 * Cabeça do comando: prefixos leves + «avaliar»|«feedback» no início
 * (não mid-frase). Após a keyword: fim, espaço ou pontuação comum
 * (`.!?`, vírgula, dois-pontos, travessão) antes do comentário opcional.
 */
export const REVIEW_FLAG_HEAD_RE =
  /^(?:(?:ok|pode|podes|quero|por\s+favor|pf)[,.\s!]*)*(?:avaliar|feedback)(?=$|[\s,.!?:\-–—])/

const REVIEW_FLAG_OBJECT_RE =
  /^(?:o\s+)?(?:atendimento|bot|assistente)(?=$|[\s,.!?:\-–—])/

/**
 * @deprecated Prefer {@link REVIEW_FLAG_HEAD_RE} + {@link parseReviewFlagRequest}.
 * Mantido para callers/testes que ainda referenciam o regex «mensagem inteira».
 */
export const REVIEW_FLAG_REQUEST_RE =
  /^(?:(?:ok|pode|podes|quero|por\s+favor|pf)[,.\s!]*)*(?:avaliar|feedback)(?:\s+(?:o\s+)?(?:atendimento|bot|assistente))?[.!?\s]*$/

export type ReviewFlagRequestMatch =
  | { matched: true; clientComment: string | null }
  | { matched: false }

function stripEdgePunctuation(text: string): string {
  // `-` no fim da classe (sem escape) — evita no-useless-escape do ESLint.
  return text
    .replace(/^[,.:\s!?–—-]+/, '')
    .replace(/[,.:\s!?–—-]+$/, '')
    .trim()
}


function normalizeStoredClientComment(
  value: string | null | undefined,
): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  return trimmed.slice(0, REVIEW_FLAG_CLIENT_COMMENT_MAX_LEN)
}

/**
 * Extrai o comentário no texto original (preserva acentos) depois da keyword
 * e do objecto opcional «o atendimento|bot|assistente».
 */
function extractOriginalClientComment(original: string): string | null {
  const head = original.match(
    /^(?:(?:ok|pode|podes|quero|por\s+favor|pf)[,.\s!]*)*(?:avaliar|feedback)(?=$|[\s,.!?:\-–—])/i,
  )
  if (!head) return null
  let rest = original.slice(head[0].length).trim()
  const obj = rest.match(
    /^(?:o\s+)?(?:atendimento|bot|assistente)(?=$|[\s,.!?:\-–—])/i,
  )
  if (obj) rest = rest.slice(obj[0].length).trim()
  rest = stripEdgePunctuation(rest)
  return rest || null
}


/**
 * Comando explícito de revisão (cliente / designer).
 * Casa só no *início* (após prefixos leves); o resto trimado é
 * `clientComment` opcional (DEC-166). Não casa prosa mid-texto
 * («me ajuda a avaliar»).
 */
export function parseReviewFlagRequest(text: string): ReviewFlagRequestMatch {
  const trimmed = (text ?? '').trim()
  if (!trimmed) return { matched: false }
  const body = normalizeReviewFlagText(trimmed)
  if (!body || body.length > REVIEW_FLAG_REQUEST_MAX_LEN) return { matched: false }
  const head = body.match(REVIEW_FLAG_HEAD_RE)
  if (!head) return { matched: false }

  let rest = body.slice(head[0].length).trim()
  const obj = rest.match(REVIEW_FLAG_OBJECT_RE)
  if (obj) rest = rest.slice(obj[0].length).trim()
  rest = stripEdgePunctuation(rest)

  if (!rest) return { matched: true, clientComment: null }

  const fromOriginal = extractOriginalClientComment(trimmed)
  const clientComment = normalizeStoredClientComment(fromOriginal ?? rest)
  return { matched: true, clientComment }
}

export function isReviewFlagRequest(text: string): boolean {
  return parseReviewFlagRequest(text).matched
}
