/**
 * Redator de exceção (#416 / DEC-104 · 5b).
 * Perguntas abertas fora do catálogo; factos DEC-120; validador #403.
 * Falha → frase DEC-107 + alerta à equipe (IA continua activa; #489).
 */
import {
  AI_MODEL_EXCEPTION,
  AI_TIMEOUT_MS,
  AI_MAX_OUTPUT_TOKENS_REPLY,
  EXCEPTION_STABLE_SYSTEM,
  buildExceptionUserContent,
  guardReplyOutput,
  applyDraftContinuity,
  REPLY_OUTPUT_MAX_MESSAGE_CHARS,
} from '../../ai'
import type { Clock } from '../../db/clock'
import type { ClinicCaller } from '../envelopes'
import type { ClinicDb } from '../store'
import { buildAiContextPayload } from './context'
import { validateClientOutbound } from './outbound-validate'
import type { AiAssistDeps } from './types'
import type { TurnContext } from './turn-context'

export type ExceptionReplyResult = {
  ok: boolean
  text: string
  notes: string
  modelCalled: boolean
  model: string | null
  inputTokens: number | null
  outputTokens: number | null
  latencyMs: number | null
  /** Validador ou provedor falhou → autodraft usa DEC-107 (sem pausa). */
  rejection?: string
}

/**
 * Gera resposta a pergunta aberta com contexto DEC-120 e validador factual.
 */
export async function generateExceptionReply(
  db: ClinicDb,
  caller: ClinicCaller,
  clock: Clock,
  deps: AiAssistDeps,
  input: {
    conversationId: string
    question: string
    turn?: TurnContext
    computedFacts?: string
  },
): Promise<ExceptionReplyResult> {
  const tenantId = caller.tenantId
  const contextInspection = await buildAiContextPayload(db, tenantId, input.conversationId, {
    clock,
    clinicName: deps.clinicName ?? null,
    forecast: deps.forecast,
    ...(input.turn ? { turn: input.turn } : {}),
  })

  const userContent = buildExceptionUserContent({
    context: contextInspection.payload,
    question: input.question,
    computedFacts: input.computedFacts,
  })

  const gen = await deps.adapter.generate({
    kind: 'reply',
    profile: 'exception',
    context: contextInspection.payload,
    warnings: [],
    servicesWithoutPrice: [],
    servicesWithoutExplanation: [],
    explanationSources: [],
    maxOutputTokens: AI_MAX_OUTPUT_TOKENS_REPLY,
    timeoutMs: AI_TIMEOUT_MS,
    model: AI_MODEL_EXCEPTION,
    systemPromptOverride: EXCEPTION_STABLE_SYSTEM,
    userContentOverride: userContent,
    promptCache: true,
  })

  if (!gen.ok) {
    return {
      ok: false,
      text: '',
      notes: '',
      modelCalled: true,
      model: gen.model,
      inputTokens: null,
      outputTokens: null,
      latencyMs: gen.latencyMs,
      rejection: gen.code,
    }
  }

  const guarded = guardReplyOutput(gen.text)
  if (!guarded.ok) {
    return {
      ok: false,
      text: '',
      notes: '',
      modelCalled: true,
      model: gen.model,
      inputTokens: gen.inputTokens,
      outputTokens: gen.outputTokens,
      latencyMs: gen.latencyMs,
      rejection: guarded.reason,
    }
  }

  const out = validateClientOutbound(guarded.message, {
    source: 'llm',
    context: contextInspection.payload,
    agendaFacts: contextInspection.agendaFacts,
    requireSingleQuestion: false,
    maxChars: REPLY_OUTPUT_MAX_MESSAGE_CHARS,
  })
  if (!out.ok) {
    return {
      ok: false,
      text: '',
      notes: '',
      modelCalled: true,
      model: gen.model,
      inputTokens: gen.inputTokens,
      outputTokens: gen.outputTokens,
      latencyMs: gen.latencyMs,
      rejection: out.detail ?? out.reason,
    }
  }

  const message = applyDraftContinuity(guarded.message, contextInspection.payload.messages)
  return {
    ok: true,
    text: message,
    notes: guarded.notes,
    modelCalled: true,
    model: gen.model,
    inputTokens: gen.inputTokens,
    outputTokens: gen.outputTokens,
    latencyMs: gen.latencyMs,
  }
}
