import {
  guardReplyOutput,
  guardSummaryOutput,
  AI_MODEL_AUTODRAFT,
  AI_MODEL_REGENERATE,
  AI_MAX_OUTPUT_TOKENS_REPLY,
  AI_MAX_OUTPUT_TOKENS_SUMMARY,
  AI_TIMEOUT_MS,
  analyzeContentRules,
  warningLabel,
  type AiProviderAdapter,
} from '../../ai'
import { applyDraftContinuity } from '../../ai/continuity'
import { validateReplyFacts } from '../../ai/reply-facts'
import type { Clock } from '../../db/clock'
import { assertValidCaller, type ClinicCaller } from '../envelopes'
import { ClinicError, NotFoundError, ValidationError } from '../errors'
import { isClinicAiAssistEnabled } from '../config/settings'
import { getConversation } from '../inbox/conversations'
import { assertClinicSchemaReady } from '../migrations'
import type { ClinicDb } from '../store'
import { bindOrAssertTenant } from '../tenant'
import {
  assertAiCommandResultMinimized,
  assertContextMinimized,
  buildAiContextPayload,
} from './context'
import {
  findAiCommand,
  getSuggestion,
  insertAiCommand,
  insertSuggestion,
  listSuggestionsForConversation,
  markSuggestionSuperseded,
  supersedePendingAutoDrafts,
  updateSuggestionDecision,
} from './suggestions'
import { tempoDraftRejected } from './tempo-draft'
import { getAiDailyUsage, incrementAiDailyUsage } from './usage'
import { writeOperationalAudit } from '../audit'
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
  contextInspection: Awaited<ReturnType<typeof buildAiContextPayload>>
  gatewayInspection: ReturnType<AiProviderAdapter['lastInspection']>
  duplicate: boolean
  /** Sempre false — a IA nunca envia. */
  messageSent: false
}

/**
 * Persistência mínima de idempotência (S8 / #179).
 * Nunca guarda prompts, mensagens, catálogo nem inspeção de gateway em `ai_commands`.
 */
export type StoredAiCommandV2 = {
  v: 2
  suggestionId: string
  messageSent: false
}

/** Log estruturado sem conteúdo pessoal. */
function aiLog(level: 'info' | 'warn', event: string, detail: Record<string, unknown>): void {
  const line = JSON.stringify({ level, event, ...detail })
  if (level === 'warn') console.warn(line)
  else console.log(line)
}

function storedCommandRef(suggestionId: string): StoredAiCommandV2 {
  return { v: 2, suggestionId, messageSent: false }
}

async function hydrateSuggestFromCommand(
  db: ClinicDb,
  tenantId: string,
  conversationId: string,
  resultJson: string,
  clock: Clock,
  deps: AiAssistDeps,
  kind: 'reply' | 'summary',
): Promise<SuggestResult> {
  assertAiCommandResultMinimized(resultJson)
  const parsed = JSON.parse(resultJson) as StoredAiCommandV2 | SuggestResult
  const suggestionId =
    'v' in parsed && parsed.v === 2
      ? parsed.suggestionId
      : (parsed as SuggestResult).suggestion?.id
  if (!suggestionId) {
    throw new ClinicError('ai_command_corrupt', 'Comando de IA sem sugestão')
  }
  const suggestion = getSuggestion(db, tenantId, suggestionId)
  if (!suggestion || suggestion.conversationId !== conversationId) {
    throw new NotFoundError('suggestion_not_found', 'Sugestão não encontrada')
  }
  const contextInspection = await buildAiContextPayload(db, tenantId, conversationId, {
    ...(kind === 'reply'
      ? { clock, clinicName: deps.clinicName ?? null, forecast: deps.forecast }
      : {}),
  })
  assertContextMinimized(contextInspection.payload)
  return {
    suggestion,
    contextInspection,
    gatewayInspection: null,
    duplicate: true,
    messageSent: false,
  }
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
    /** auto = rascunho em segundo plano (sem comando idempotente). */
    origin?: 'auto' | 'manual'
    /** #411 TurnContext do job autodraft. */
    turn?: import('./turn-context').TurnContext
  },
): Promise<SuggestResult> {
  const origin = input.origin ?? 'manual'
  assertClinicSchemaReady(db)
  assertValidCaller(caller)
  const meta = bindOrAssertTenant(db, caller, clock)

  // Opt-in por clínica (política §6): sem opt-in, nenhuma chamada ao modelo.
  if (!isClinicAiAssistEnabled(db, meta.tenantId)) {
    throw new ClinicError('ai_not_enabled', 'IA assistiva desligada para esta clínica')
  }

  if (origin === 'manual' && !input.clientRequestId.trim()) {
    throw new ValidationError('client_request_id_required', 'clientRequestId obrigatório')
  }

  const cached =
    origin === 'manual' ? findAiCommand(db, meta.tenantId, input.clientRequestId) : null
  if (cached) {
    return await hydrateSuggestFromCommand(
      db,
      meta.tenantId,
      input.conversationId,
      cached.resultJson,
      clock,
      deps,
      input.kind,
    )
  }

  if (!getConversation(db, meta.tenantId, input.conversationId)) {
    throw new NotFoundError('conversation_not_found', 'Conversa não encontrada')
  }

  if (input.kind === 'reply' && getAiDailyUsage(db, meta.tenantId, clock).capReached) {
    throw new ClinicError(
      'ai_daily_cap_reached',
      'Limite diário de rascunhos da IA atingido nesta clínica',
    )
  }

  if (deps.syntheticFallback) {
    aiLog('warn', 'ai.synthetic_fallback_used', { tenantId: meta.tenantId, kind: input.kind, origin })
  }

  if (input.parentSuggestionId) {
    const parent = getSuggestion(db, meta.tenantId, input.parentSuggestionId)
    if (!parent || parent.conversationId !== input.conversationId) {
      throw new NotFoundError('parent_suggestion_not_found', 'Sugestão anterior não encontrada')
    }
  }

  const contextInspection = await buildAiContextPayload(
    db,
    meta.tenantId,
    input.conversationId,
    input.kind === 'reply'
      ? {
          clock,
          clinicName: deps.clinicName ?? null,
          forecast: deps.forecast,
          ...(input.turn ? { turn: input.turn } : {}),
        }
      : {},
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
    ...(input.kind === 'reply'
      ? {
          model: input.parentSuggestionId ? AI_MODEL_REGENERATE : AI_MODEL_AUTODRAFT,
        }
      : {}),
  })
  // Saída estruturada: mensagem limpa à cliente + notas internas separadas.
  // S6 (#177): schema fechado; desvio → descartado, fallback humano.
  // Resumo é prosa interna: guarda própria, sem exigir {mensagem, notas}.
  let guarded = gen.ok && input.kind === 'reply' ? guardReplyOutput(gen.text) : null
  const summaryGuard = gen.ok && input.kind === 'summary' ? guardSummaryOutput(gen.text) : null
  if (
    guarded?.ok
    && tempoDraftRejected(guarded.message, contextInspection.payload.clinic)
  ) {
    guarded = { ok: false, reason: 'tempo_leak', notes: '' }
  }
  // #403 / DEC-104: o texto sai sozinho, por isso preço, horário e reserva têm de bater
  // com o contexto que o modelo recebeu. Falha → descartado (fallback ou equipe).
  let factsViolation: string | null = null
  if (guarded?.ok) {
    const facts = validateReplyFacts(guarded.message, contextInspection.payload)
    if (!facts.ok) {
      factsViolation = facts.violation
      guarded = { ok: false, reason: 'factual_mismatch', notes: '' }
    }
  }
  // Continuidade (Paulo 29/10/2026): se a clínica já falou, corta re-cumprimento residual.
  const parsedReply = guarded?.ok
    ? {
        message: applyDraftContinuity(guarded.message, contextInspection.payload.messages),
        notes: guarded.notes,
      }
    : null
  const summaryRejected = summaryGuard != null && !summaryGuard.ok
  const rejected = (guarded != null && !guarded.ok) || summaryRejected
  // Sem mensagem utilizável → falha amigável, nunca texto cru.
  const unusable =
    (gen.ok && input.kind === 'reply' && !parsedReply?.message) || summaryRejected
  const ok = gen.ok && !unusable

  const now = clock.nowMs()
  const warningCodes = [...rules.warnings]
  if (rejected) {
    warningCodes.push('output_rejected')
    aiLog('warn', 'ai.output_rejected', {
      tenantId: meta.tenantId,
      ...(factsViolation ? { violation: factsViolation } : {}),
      reason:
        guarded && !guarded.ok
          ? guarded.reason
          : summaryGuard && !summaryGuard.ok
            ? summaryGuard.reason
            : 'unknown',
    })
  } else if (!ok) warningCodes.push('provider_unavailable')
  const warningLabels = warningCodes.map(warningLabel)
  const sourceRefs = rules.explanationSources.map((s) => ({
    serviceName: s.serviceName,
    kind: 'client_explanation' as const,
  }))

  const suggestion = db.transactionSync(() => {
    if (input.parentSuggestionId) {
      markSuggestionSuperseded(db, meta.tenantId, input.parentSuggestionId, now)
    }
    if (input.kind === 'reply') {
      // Um só rascunho automático pendente por conversa.
      supersedePendingAutoDrafts(db, meta.tenantId, input.conversationId, now)
      if (gen.ok) {
        const usage = incrementAiDailyUsage(db, meta.tenantId, clock)
        if (usage.justReached) {
          aiLog('warn', 'ai.daily_cap_reached', { tenantId: meta.tenantId, drafts: usage.drafts })
          writeOperationalAudit(
            db,
            {
              tenantId: meta.tenantId,
              actor: 'system',
              action: 'ai.daily_cap_reached',
              objectType: 'clinic_settings',
              objectId: '1',
              detail: { drafts: usage.drafts },
            },
            clock,
          )
        }
      }
    }

    const row = insertSuggestion(db, {
      tenantId: meta.tenantId,
      conversationId: input.conversationId,
      kind: input.kind,
      status: ok ? 'pending' : 'failed',
      provider: gen.provider,
      model: gen.model,
      suggestedText: ok
        ? parsedReply
          ? parsedReply.message
          : summaryGuard?.ok
            ? summaryGuard.text
            : gen.text
        : '',
      internalNotes: ok ? (parsedReply?.notes ?? '') : '',
      warningCodes,
      warningLabels,
      sourceRefs,
      requestMeta: {
        latencyMs: gen.latencyMs,
        inputTokens: gen.ok ? gen.inputTokens : null,
        outputTokens: gen.ok ? gen.outputTokens : null,
        messageCount: contextInspection.payload.messages.length,
        mode: deps.syntheticFallback ? 'synthetic_fallback' : deps.mode,
      },
      errorCode: gen.ok ? (unusable ? 'invalid_response' : null) : gen.code,
      requestedByClerkUserId: input.actorClerkUserId,
      requestedByDisplayName: input.actorDisplayName,
      parentSuggestionId: input.parentSuggestionId ?? null,
      replyToMessageId: input.kind === 'reply' ? contextInspection.lastInboundMessageId : null,
      origin,
      createdAt: now,
    })

    if (origin === 'manual') {
      const stored = storedCommandRef(row.id)
      assertAiCommandResultMinimized(JSON.stringify(stored))
      insertAiCommand(db, {
        tenantId: meta.tenantId,
        clientRequestId: input.clientRequestId,
        command: input.command,
        conversationId: input.conversationId,
        suggestionId: row.id,
        result: stored,
        createdAt: now,
      })
    }
    return row
  })

  aiLog('info', 'ai.generated', {
    tenantId: meta.tenantId,
    kind: input.kind,
    origin,
    ok: gen.ok,
    provider: gen.provider,
    model: gen.model,
    latencyMs: gen.latencyMs,
    inputTokens: gen.ok ? gen.inputTokens : null,
    outputTokens: gen.ok ? gen.outputTokens : null,
    errorCode: gen.ok ? null : gen.code,
  })

  return {
    suggestion,
    contextInspection,
    gatewayInspection: deps.adapter.lastInspection(),
    duplicate: false,
    messageSent: false,
  }
}

export { runGenerate as runGenerateInternal }

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
    assertAiCommandResultMinimized(cached.resultJson)
    const parsed = JSON.parse(cached.resultJson) as StoredAiCommandV2 | DecideResult
    const suggestionId =
      'v' in parsed && parsed.v === 2
        ? parsed.suggestionId
        : (parsed as DecideResult).suggestion?.id
    if (!suggestionId) {
      throw new ClinicError('ai_command_corrupt', 'Comando de IA sem sugestão')
    }
    const suggestion = getSuggestion(db, meta.tenantId, suggestionId)
    if (!suggestion) {
      throw new NotFoundError('suggestion_not_found', 'Sugestão não encontrada')
    }
    return { suggestion, duplicate: true, messageSent: false }
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
    const stored = storedCommandRef(row.id)
    assertAiCommandResultMinimized(JSON.stringify(stored))
    insertAiCommand(db, {
      tenantId: meta.tenantId,
      clientRequestId: input.clientRequestId,
      command: 'decide',
      conversationId: row.conversationId,
      suggestionId: row.id,
      result: stored,
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
