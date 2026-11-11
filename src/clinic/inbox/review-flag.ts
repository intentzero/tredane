/**
 * DEC-157 — fila de revisão de conversas.
 * Flag no SQLite do Clinic DO; não pausa IA nem limpa BookingFrame.
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
  }>(
    `SELECT review_flagged_at, review_flagged_source, review_flag_reason
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
  return { flaggedAt: row.review_flagged_at, source, reason }
}

/**
 * Marca para revisão. Idempotente: se já flagged, não sobrescreve source/at.
 * Devolve outbox (vazio se já estava marcada).
 */
export function flagConversationForReview(
  db: ClinicDb,
  tenantId: string,
  conversationId: string,
  input: { source: ReviewFlagSource; reason: ReviewFlagReason },
  clock: Clock,
): { changed: boolean; outbox: OutboxRow[] } {
  assertClinicSchemaReady(db)
  requireConversation(db, tenantId, conversationId)
  const existing = readReviewFlag(db, tenantId, conversationId)
  if (existing) return { changed: false, outbox: [] }
  const now = clock.nowMs()
  db.run(
    `UPDATE conversations
     SET review_flagged_at = ?, review_flagged_source = ?, review_flag_reason = ?,
         updated_at = ?
     WHERE tenant_id = ? AND id = ?`,
    now,
    input.source,
    input.reason,
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
         updated_at = ?
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
 * Comando explícito de revisão (cliente / designer).
 * Mensagem inteira (após normalize): «avaliar» / «feedback» com prefixos leves
 * (ok/pode/podes/quero/por favor); não casa prosa longa nem substring solta.
 */
export const REVIEW_FLAG_REQUEST_RE =
  /^(?:(?:ok|pode|podes|quero|por\s+favor|pf)[,.\s!]*)*(?:avaliar|feedback)(?:\s+(?:o\s+)?(?:atendimento|bot|assistente))?[.!?\s]*$/

export function isReviewFlagRequest(text: string): boolean {
  const body = normalizeReviewFlagText(text)
  if (!body || body.length > 80) return false
  return REVIEW_FLAG_REQUEST_RE.test(body)
}
