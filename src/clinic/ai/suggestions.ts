import type { AiSuggestionKind, AiWarningCode } from '../../ai/types'
import { newId } from '../ids'
import { assertClinicSchemaReady } from '../migrations'
import type { ClinicDb } from '../store'
import type {
  AiSuggestionDecision,
  AiSuggestionRow,
  AiSuggestionStatus,
} from './types'

type SugSql = {
  id: string
  tenant_id: string
  conversation_id: string
  kind: string
  status: string
  provider: string
  model: string
  suggested_text: string
  warning_codes_json: string
  warning_labels_json: string
  source_refs_json: string
  request_meta_json: string
  error_code: string | null
  requested_by_clerk_user_id: string
  requested_by_display_name: string | null
  decision: string | null
  decided_by_clerk_user_id: string | null
  decided_at: number | null
  revised_text: string | null
  outbound_message_id: string | null
  parent_suggestion_id: string | null
  reply_to_message_id?: string | null
  origin?: string | null
  internal_notes?: string | null
  created_at: number
  updated_at: number
}

function parseJsonArray<T>(raw: string, fallback: T[]): T[] {
  try {
    const v: unknown = JSON.parse(raw)
    return Array.isArray(v) ? (v as T[]) : fallback
  } catch {
    return fallback
  }
}

function mapSuggestion(row: SugSql): AiSuggestionRow {
  const meta = (() => {
    try {
      return JSON.parse(row.request_meta_json) as AiSuggestionRow['requestMeta']
    } catch {
      return {
        latencyMs: 0,
        inputTokens: null,
        outputTokens: null,
        messageCount: 0,
        mode: 'unknown',
      }
    }
  })()

  return {
    id: row.id,
    tenantId: row.tenant_id,
    conversationId: row.conversation_id,
    kind: row.kind as AiSuggestionKind,
    status: row.status as AiSuggestionStatus,
    provider: row.provider,
    model: row.model,
    suggestedText: row.suggested_text,
    warningCodes: parseJsonArray<AiWarningCode>(row.warning_codes_json, []),
    warningLabels: parseJsonArray<string>(row.warning_labels_json, []),
    sourceRefs: parseJsonArray(row.source_refs_json, []),
    requestMeta: meta,
    errorCode: row.error_code,
    requestedByClerkUserId: row.requested_by_clerk_user_id,
    requestedByDisplayName: row.requested_by_display_name,
    decision: (row.decision as AiSuggestionDecision | null) ?? null,
    decidedByClerkUserId: row.decided_by_clerk_user_id,
    decidedAt: row.decided_at,
    revisedText: row.revised_text,
    outboundMessageId: row.outbound_message_id,
    parentSuggestionId: row.parent_suggestion_id,
    replyToMessageId: row.reply_to_message_id ?? null,
    origin: row.origin === 'auto' ? 'auto' : 'manual',
    internalNotes: row.internal_notes ?? '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function getSuggestion(
  db: ClinicDb,
  tenantId: string,
  suggestionId: string,
): AiSuggestionRow | null {
  assertClinicSchemaReady(db)
  const row = db.get<SugSql>(
    `SELECT * FROM ai_suggestions WHERE tenant_id = ? AND id = ?`,
    tenantId,
    suggestionId,
  )
  return row ? mapSuggestion(row) : null
}

export function listSuggestionsForConversation(
  db: ClinicDb,
  tenantId: string,
  conversationId: string,
  opts: { kind?: AiSuggestionKind; limit?: number } = {},
): AiSuggestionRow[] {
  assertClinicSchemaReady(db)
  const limit = Math.min(Math.max(opts.limit ?? 20, 1), 50)
  const kindSql = opts.kind ? `AND kind = ?` : ''
  const params: Array<string | number> = [tenantId, conversationId]
  if (opts.kind) params.push(opts.kind)
  params.push(limit)
  const rows = db.all<SugSql>(
    `SELECT * FROM ai_suggestions
     WHERE tenant_id = ? AND conversation_id = ?
       ${kindSql}
     ORDER BY created_at DESC
     LIMIT ?`,
    ...params,
  )
  return rows.map(mapSuggestion)
}

export function insertSuggestion(
  db: ClinicDb,
  input: {
    tenantId: string
    conversationId: string
    kind: AiSuggestionKind
    status: AiSuggestionStatus
    provider: string
    model: string
    suggestedText: string
    warningCodes: AiWarningCode[]
    warningLabels: string[]
    sourceRefs: AiSuggestionRow['sourceRefs']
    requestMeta: AiSuggestionRow['requestMeta']
    errorCode?: string | null
    requestedByClerkUserId: string
    requestedByDisplayName: string | null
    parentSuggestionId?: string | null
    replyToMessageId?: string | null
    origin?: 'auto' | 'manual'
    internalNotes?: string
    id?: string
    createdAt: number
  },
): AiSuggestionRow {
  assertClinicSchemaReady(db)
  const id = input.id ?? newId('ais')
  db.run(
    `INSERT INTO ai_suggestions (
      id, tenant_id, conversation_id, kind, status,
      provider, model, suggested_text,
      warning_codes_json, warning_labels_json, source_refs_json, request_meta_json,
      error_code, requested_by_clerk_user_id, requested_by_display_name,
      parent_suggestion_id, reply_to_message_id, origin, internal_notes, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    input.tenantId,
    input.conversationId,
    input.kind,
    input.status,
    input.provider,
    input.model,
    input.suggestedText,
    JSON.stringify(input.warningCodes),
    JSON.stringify(input.warningLabels),
    JSON.stringify(input.sourceRefs),
    JSON.stringify(input.requestMeta),
    input.errorCode ?? null,
    input.requestedByClerkUserId,
    input.requestedByDisplayName,
    input.parentSuggestionId ?? null,
    input.replyToMessageId ?? null,
    input.origin ?? 'manual',
    input.internalNotes ?? '',
    input.createdAt,
    input.createdAt,
  )
  return getSuggestion(db, input.tenantId, id)!
}

export function updateSuggestionDecision(
  db: ClinicDb,
  input: {
    tenantId: string
    suggestionId: string
    status: AiSuggestionStatus
    decision: AiSuggestionDecision
    actorClerkUserId: string
    revisedText?: string | null
    outboundMessageId?: string | null
    updatedAt: number
  },
): AiSuggestionRow {
  assertClinicSchemaReady(db)
  db.run(
    `UPDATE ai_suggestions SET
      status = ?,
      decision = ?,
      decided_by_clerk_user_id = ?,
      decided_at = ?,
      revised_text = COALESCE(?, revised_text),
      outbound_message_id = COALESCE(?, outbound_message_id),
      updated_at = ?
     WHERE tenant_id = ? AND id = ?`,
    input.status,
    input.decision,
    input.actorClerkUserId,
    input.updatedAt,
    input.revisedText ?? null,
    input.outboundMessageId ?? null,
    input.updatedAt,
    input.tenantId,
    input.suggestionId,
  )
  return getSuggestion(db, input.tenantId, input.suggestionId)!
}

export function markSuggestionSuperseded(
  db: ClinicDb,
  tenantId: string,
  suggestionId: string,
  updatedAt: number,
): void {
  assertClinicSchemaReady(db)
  db.run(
    `UPDATE ai_suggestions SET status = 'superseded', updated_at = ?
     WHERE tenant_id = ? AND id = ? AND status = 'pending'`,
    updatedAt,
    tenantId,
    suggestionId,
  )
}

/** Um só rascunho pendente por conversa: novos substituem os anteriores. */
export function supersedePendingAutoDrafts(
  db: ClinicDb,
  tenantId: string,
  conversationId: string,
  updatedAt: number,
): void {
  assertClinicSchemaReady(db)
  db.run(
    `UPDATE ai_suggestions SET status = 'superseded', updated_at = ?
     WHERE tenant_id = ? AND conversation_id = ? AND kind = 'reply'
       AND status = 'pending' AND origin = 'auto'`,
    updatedAt,
    tenantId,
    conversationId,
  )
}

export function findAiCommand(
  db: ClinicDb,
  tenantId: string,
  clientRequestId: string,
): { resultJson: string } | null {
  assertClinicSchemaReady(db)
  const row = db.get<{ result_json: string }>(
    `SELECT result_json FROM ai_commands
     WHERE tenant_id = ? AND client_request_id = ?`,
    tenantId,
    clientRequestId,
  )
  return row ? { resultJson: row.result_json } : null
}

export function insertAiCommand(
  db: ClinicDb,
  input: {
    tenantId: string
    clientRequestId: string
    command: 'suggest_reply' | 'summarize' | 'decide'
    conversationId?: string | null
    suggestionId?: string | null
    result: unknown
    createdAt: number
  },
): void {
  assertClinicSchemaReady(db)
  db.run(
    `INSERT INTO ai_commands (
      tenant_id, client_request_id, command, conversation_id, suggestion_id,
      result_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    input.tenantId,
    input.clientRequestId,
    input.command,
    input.conversationId ?? null,
    input.suggestionId ?? null,
    JSON.stringify(input.result),
    input.createdAt,
  )
}
