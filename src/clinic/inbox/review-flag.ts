/**
 * DEC-157 / DEC-166 — fila de revisão de conversas.
 * Flag no SQLite do Clinic DO; não pausa IA nem limpa BookingFrame.
 * DEC-166: comentário livre opcional após «avaliar» / «feedback».
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
  /** Observação livre da cliente no 1.º flag (DEC-166); null se bare keyword. */
  clientComment: string | null
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
  }>(
    `SELECT review_flagged_at, review_flagged_source, review_flag_reason,
            review_client_comment
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
  const clientComment =
    typeof row.review_client_comment === 'string' &&
    row.review_client_comment.trim() !== ''
      ? row.review_client_comment.trim()
      : null
  return { flaggedAt: row.review_flagged_at, source, reason, clientComment }
}

/**
 * Marca para revisão. Idempotente: se já flagged, não sobrescreve source/at/comment
 * (first-flag-wins — DEC-166). Devolve outbox (vazio se já estava marcada).
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
  if (existing) return { changed: false, outbox: [] }
  const now = clock.nowMs()
  const clientComment = normalizeStoredClientComment(input.clientComment)
  db.run(
    `UPDATE conversations
     SET review_flagged_at = ?, review_flagged_source = ?, review_flag_reason = ?,
         review_client_comment = ?, updated_at = ?
     WHERE tenant_id = ? AND id = ?`,
    now,
    input.source,
    input.reason,
    clientComment,
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
         review_client_comment = NULL, updated_at = ?
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

/** Corpo normalizado máximo (keyword + comentário opcional). */
export const REVIEW_FLAG_REQUEST_MAX_LEN = 500

/** Comentário guardado no 1.º flag / amostra central. */
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
  return text
    .replace(/^[,.:\s!?–—\-]+/, '')
    .replace(/[,.:\s!?–—\-]+$/, '')
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
