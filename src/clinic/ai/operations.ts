import {
  AI_MAX_OUTPUT_TOKENS_REPLY,
  AI_MAX_OUTPUT_TOKENS_SUMMARY,
  AI_TIMEOUT_MS,
  analyzeContentRules,
  warningLabel,
  type AiProviderAdapter,
} from '../../ai'
import type { Clock } from '../../db/clock'
import { assertValidCaller, type ClinicCaller } from '../envelopes'
import { ClinicError, NotFoundError, ValidationError } from '../errors'
import { isClinicAiAssistEnabled } from '../config/settings'
import { getConversation } from '../inbox/conversations'
import { assertClinicSchemaReady } from '../migrations'
import type { ClinicDb } from '../store'
import { bindOrAssertTenant } from '../tenant'
import { assertContextMinimized, buildAiContextPayload } from './context'
import {
  findAiCommand,
  getSuggestion,
  insertAiCommand,
  insertSuggestion,
  listSuggestionsForConversation,
  markSuggestionSuperseded,
  updateSuggestionDecision,
} from './suggestions'
import type {
  AiAssistDeps,
  AiSuggestionRow,
  DecideSuggestionInput,
  SuggestReplyInput,
  SummarizeInput,
} from './types'

export type SuggestResult = {
  suggestion: AiSuggestionRow
  /** Payload exacto inspecionado (AC-37) — sem PII proibida. */
  contextInspection: ReturnType<typeof buildAiContextPayload>
  gatewayInspection: ReturnType<AiProviderAdapter['lastInspection']>
  duplicate: boolean
  /** Sempre false — a IA nunca envia. */
  messageSent: false
}

function parseCachedSuggest(json: string): SuggestResult {
  return JSON.parse(json) as SuggestResult
}

async function runGenerate(
  db: ClinicDb,
  caller: ClinicCaller,
  clock: Clock,
  deps: AiAssistDeps,
  input: {
    conversationId: string
    clientRequestId: string
    kind: 'reply' | 'summary'
    command: 'suggest_reply' | 'summarize'
    actorClerkUserId: string
    actorDisplayName: string
    parentSuggestionId?: string | null
  },
): Promise<SuggestResult> {
  assertClinicSchemaReady(db)
  assertValidCaller(caller)
  const meta = bindOrAssertTenant(db, caller, clock)

  // Opt-in por clínica (política §6): sem opt-in, nenhuma chamada ao modelo.
  if (!isClinicAiAssistEnabled(db, meta.tenantId)) {
    throw new ClinicError('ai_not_enabled', 'IA assistiva desligada para esta clínica')
  }

  if (!input.clientRequestId.trim()) {
    throw new ValidationError('client_request_id_required', 'clientRequestId obrigatório')
  }

  const cached = findAiCommand(db, meta.tenantId, input.clientRequestId)
  if (cached) {
    const parsed = parseCachedSuggest(cached.resultJson)
    return { ...parsed, duplicate: true, messageSent: false }
  }

  if (!getConversation(db, meta.tenantId, input.conversationId)) {
    throw new NotFoundError('conversation_not_found', 'Conversa não encontrada')
  }

  if (input.parentSuggestionId) {
    const parent = getSuggestion(db, meta.tenantId, input.parentSuggestionId)
    if (!parent || parent.conversationId !== input.conversationId) {
      throw new NotFoundError('parent_suggestion_not_found', 'Sugestão anterior não encontrada')
    }
  }

  const contextInspection = buildAiContextPayload(
    db,
    meta.tenantId,
    input.conversationId,
  )
  assertContextMinimized(contextInspection.payload)

  const rules = analyzeContentRules(
    contextInspection.payload.messages,
    contextInspection.payload.services,
  )

  const gen = await deps.adapter.generate({
    kind: input.kind,
    context: contextInspection.payload,
    warnings: rules.warnings,
    servicesWithoutPrice: rules.servicesWithoutPrice,
    servicesWithoutExplanation: rules.servicesWithoutExplanation,
    explanationSources: rules.explanationSources,
    maxOutputTokens:
      input.kind === 'summary'
        ? AI_MAX_OUTPUT_TOKENS_SUMMARY
        : AI_MAX_OUTPUT_TOKENS_REPLY,
    timeoutMs: AI_TIMEOUT_MS,
  })

  const now = clock.nowMs()
  const warningCodes = [...rules.warnings]
  if (!gen.ok) warningCodes.push('provider_unavailable')
  const warningLabels = warningCodes.map(warningLabel)
  const sourceRefs = rules.explanationSources.map((s) => ({
    serviceName: s.serviceName,
    kind: 'client_explanation' as const,
  }))

  const suggestion = db.transactionSync(() => {
    if (input.parentSuggestionId) {
      markSuggestionSuperseded(db, meta.tenantId, input.parentSuggestionId, now)
    }

    const row = insertSuggestion(db, {
      tenantId: meta.tenantId,
      conversationId: input.conversationId,
      kind: input.kind,
      status: gen.ok ? 'pending' : 'failed',
      provider: gen.provider,
      model: gen.model,
      suggestedText: gen.ok ? gen.text : '',
      warningCodes,
      warningLabels,
      sourceRefs,
      requestMeta: {
        latencyMs: gen.latencyMs,
        inputTokens: gen.ok ? gen.inputTokens : null,
        outputTokens: gen.ok ? gen.outputTokens : null,
        messageCount: contextInspection.payload.messages.length,
        mode: deps.mode,
      },
      errorCode: gen.ok ? null : gen.code,
      requestedByClerkUserId: input.actorClerkUserId,
      requestedByDisplayName: input.actorDisplayName,
      parentSuggestionId: input.parentSuggestionId ?? null,
      createdAt: now,
    })

    const result: SuggestResult = {
      suggestion: row,
      contextInspection,
      gatewayInspection: deps.adapter.lastInspection(),
      duplicate: false,
      messageSent: false,
    }
    insertAiCommand(db, {
      tenantId: meta.tenantId,
      clientRequestId: input.clientRequestId,
      command: input.command,
      conversationId: input.conversationId,
      suggestionId: row.id,
      result,
      createdAt: now,
    })
    return row
  })

  return {
    suggestion,
    contextInspection,
    gatewayInspection: deps.adapter.lastInspection(),
    duplicate: false,
    messageSent: false,
  }
}

export async function suggestReplyOp(
  db: ClinicDb,
  caller: ClinicCaller,
  input: SuggestReplyInput,
  clock: Clock,
  deps: AiAssistDeps,
): Promise<SuggestResult> {
  return runGenerate(db, caller, clock, deps, {
    conversationId: input.conversationId,
    clientRequestId: input.clientRequestId,
    kind: 'reply',
    command: 'suggest_reply',
    actorClerkUserId: input.actorClerkUserId,
    actorDisplayName: input.actorDisplayName,
    parentSuggestionId: input.parentSuggestionId,
  })
}

export async function summarizeConversationOp(
  db: ClinicDb,
  caller: ClinicCaller,
  input: SummarizeInput,
  clock: Clock,
  deps: AiAssistDeps,
): Promise<SuggestResult> {
  return runGenerate(db, caller, clock, deps, {
    conversationId: input.conversationId,
    clientRequestId: input.clientRequestId,
    kind: 'summary',
    command: 'summarize',
    actorClerkUserId: input.actorClerkUserId,
    actorDisplayName: input.actorDisplayName,
  })
}

export type DecideResult = {
  suggestion: AiSuggestionRow
  duplicate: boolean
  messageSent: false
}

export function decideSuggestionOp(
  db: ClinicDb,
  caller: ClinicCaller,
  input: DecideSuggestionInput,
  clock: Clock,
): DecideResult {
  assertClinicSchemaReady(db)
  assertValidCaller(caller)
  const meta = bindOrAssertTenant(db, caller, clock)

  if (!input.clientRequestId.trim()) {
    throw new ValidationError('client_request_id_required', 'clientRequestId obrigatório')
  }

  const cached = findAiCommand(db, meta.tenantId, input.clientRequestId)
  if (cached) {
    const parsed = JSON.parse(cached.resultJson) as DecideResult
    return { ...parsed, duplicate: true, messageSent: false }
  }

  const existing = getSuggestion(db, meta.tenantId, input.suggestionId)
  if (!existing) {
    throw new NotFoundError('suggestion_not_found', 'Sugestão não encontrada')
  }

  if (input.decision === 'regenerate') {
    throw new ValidationError(
      'use_suggest_for_regenerate',
      'Para gerar outra, chame suggest com parentSuggestionId',
    )
  }

  const now = clock.nowMs()
  let status: AiSuggestionRow['status']
  if (input.decision === 'discard') status = 'discarded'
  else if (input.decision === 'edit') status = 'edited'
  else status = 'used'

  const suggestion = db.transactionSync(() => {
    const row = updateSuggestionDecision(db, {
      tenantId: meta.tenantId,
      suggestionId: input.suggestionId,
      status,
      decision: input.decision,
      actorClerkUserId: input.actorClerkUserId,
      revisedText: input.revisedText ?? null,
      outboundMessageId: input.outboundMessageId ?? null,
      updatedAt: now,
    })
    const result: DecideResult = {
      suggestion: row,
      duplicate: false,
      messageSent: false,
    }
    insertAiCommand(db, {
      tenantId: meta.tenantId,
      clientRequestId: input.clientRequestId,
      command: 'decide',
      conversationId: row.conversationId,
      suggestionId: row.id,
      result,
      createdAt: now,
    })
    return row
  })

  return { suggestion, duplicate: false, messageSent: false }
}

export function listConversationSuggestionsOp(
  db: ClinicDb,
  caller: ClinicCaller,
  conversationId: string,
  clock: Clock,
  opts: { kind?: 'reply' | 'summary'; limit?: number } = {},
): AiSuggestionRow[] {
  assertClinicSchemaReady(db)
  assertValidCaller(caller)
  const meta = bindOrAssertTenant(db, caller, clock)
  if (!getConversation(db, meta.tenantId, conversationId)) {
    throw new NotFoundError('conversation_not_found', 'Conversa não encontrada')
  }
  return listSuggestionsForConversation(db, meta.tenantId, conversationId, opts)
}

export function getSuggestionOp(
  db: ClinicDb,
  caller: ClinicCaller,
  suggestionId: string,
  clock: Clock,
): AiSuggestionRow {
  assertClinicSchemaReady(db)
  assertValidCaller(caller)
  const meta = bindOrAssertTenant(db, caller, clock)
  const row = getSuggestion(db, meta.tenantId, suggestionId)
  if (!row) throw new NotFoundError('suggestion_not_found', 'Sugestão não encontrada')
  return row
}

/**
 * Liga um envio humano já persistido a uma sugestão (histórico interno).
 * Não reenvia — só marca decisão. Chamado após sendOutbound com aiSuggestionId.
 */
export function attachSuggestionToOutboundOp(
  db: ClinicDb,
  caller: ClinicCaller,
  input: {
    suggestionId: string
    outboundMessageId: string
    messageId: string
    revisedText: string
    actorClerkUserId: string
    actorDisplayName: string
  },
  clock: Clock,
): AiSuggestionRow {
  assertClinicSchemaReady(db)
  assertValidCaller(caller)
  const meta = bindOrAssertTenant(db, caller, clock)
  const existing = getSuggestion(db, meta.tenantId, input.suggestionId)
  if (!existing) {
    throw new NotFoundError('suggestion_not_found', 'Sugestão não encontrada')
  }

  const edited =
    input.revisedText.trim() !== existing.suggestedText.trim()
  const now = clock.nowMs()

  db.run(
    `UPDATE outbound_messages SET
      ai_suggestion_id = ?,
      ai_origin_note = ?
     WHERE tenant_id = ? AND id = ?`,
    input.suggestionId,
    edited
      ? `Sugestão da IA, editada por ${input.actorDisplayName}`
      : `Sugestão da IA, usada por ${input.actorDisplayName}`,
    meta.tenantId,
    input.outboundMessageId,
  )

  return updateSuggestionDecision(db, {
    tenantId: meta.tenantId,
    suggestionId: input.suggestionId,
    status: edited ? 'edited' : 'used',
    decision: edited ? 'edit' : 'use',
    actorClerkUserId: input.actorClerkUserId,
    revisedText: input.revisedText,
    outboundMessageId: input.messageId,
    updatedAt: now,
  })
}
