import type { AbuseLimits } from './abuse-limits'
import type { AiSuggestionKind, AiWarningCode } from '../../ai/types'

export type AiSuggestionStatus =
  | 'pending'
  | 'used'
  | 'edited'
  | 'discarded'
  | 'failed'
  | 'superseded'

export type AiSuggestionDecision = 'use' | 'edit' | 'discard' | 'regenerate'

export type AiSuggestionRow = {
  id: string
  tenantId: string
  conversationId: string
  kind: AiSuggestionKind
  status: AiSuggestionStatus
  provider: string
  model: string
  suggestedText: string
  warningCodes: AiWarningCode[]
  warningLabels: string[]
  sourceRefs: Array<{ serviceName: string; kind: 'client_explanation' }>
  /** Métricas sem conteúdo pessoal. */
  requestMeta: {
    latencyMs: number
    inputTokens: number | null
    outputTokens: number | null
    messageCount: number
    mode: string
  }
  errorCode: string | null
  requestedByClerkUserId: string
  requestedByDisplayName: string | null
  decision: AiSuggestionDecision | null
  decidedByClerkUserId: string | null
  decidedAt: number | null
  revisedText: string | null
  outboundMessageId: string | null
  parentSuggestionId: string | null
  /** Mensagem da cliente a que o rascunho responde. */
  replyToMessageId: string | null
  origin: 'auto' | 'manual'
  /** Notas para a atendente — nunca fazem parte do texto a enviar. */
  internalNotes: string
  createdAt: number
  updatedAt: number
}

export type SuggestReplyInput = {
  conversationId: string
  clientRequestId: string
  actorClerkUserId: string
  actorDisplayName: string
  /** Quando regenerate — id da sugestão anterior. */
  parentSuggestionId?: string | null
}

export type SummarizeInput = {
  conversationId: string
  clientRequestId: string
  actorClerkUserId: string
  actorDisplayName: string
}

export type DecideSuggestionInput = {
  suggestionId: string
  clientRequestId: string
  decision: AiSuggestionDecision
  actorClerkUserId: string
  actorDisplayName: string
  /** Texto final no compositor (use/edit). */
  revisedText?: string | null
  outboundMessageId?: string | null
}

export type AiAssistDeps = {
  adapter: import('../../ai/contract').AiProviderAdapter
  mode: 'synthetic' | 'gateway'
  /** AI_MODE=gateway mas sem chaves → simulado (aviso no painel). */
  syntheticFallback?: boolean
  /** Nome da clínica (D1) para o contexto. */
  clinicName?: string | null
  /**
   * Owner pausou novas propostas e cliques de confirmação nesta clínica.
   * Sem pausa, a capacidade está ligada.
   */
  autoBookPaused?: boolean
  /** S7 (#178): limites de abuso das automações (enable por clínica; default off). */
  abuseLimits?: AbuseLimits
  /** Previsão fictícia nos testes do bloco Tempo (DEC-077). Sem isto, o adaptador real. */
  forecast?: import('../tempo/evaluate').ForecastAdapter
  /**
   * ADR-0016 / #514: quando secrets Flow estão no Worker, o DO injecta isto
   * para trocar M5 (linha/Opções/Horários) pelo CTA `type: flow`.
   */
  prepareBookingFlowOffer?: import('../../whatsapp/flow/offer-live').PrepareBookingFlowOffer
  /**
   * Página web da cliente (ADR-0018, Fase 5): com a página ligada, remarcar e cancelar oferecem o
   * link («Abrir agenda») em vez do caminho conversacional. Ausente = comportamento de hoje.
   */
  prepareClientWebOffer?: import('../../clientweb/offer').PrepareClientWebOffer
  /**
   * Sombra do interpretador LLM (Proposto): mede cada turno de texto livre sem
   * alterar o atendimento. Desligada por omissão (`AI_INTERPRETER_SHADOW=on`).
   */
  interpreterShadow?: boolean
  /** Fallback do interpretador: só serviço (`AI_INTERPRETER_FALLBACK_SERVICE`, default on). */
  interpreterFallback?: import('./interpreter-fallback').InterpreterFallbackConfig
  /**
   * TEMPORÁRIO: recebe cada evento da sombra (o DO grava-o no D1 central para o Review MCP).
   * Nunca deve lançar; erros são engolidos por quem chama.
   */
  interpreterShadowSink?: (event: import('./interpreter-shadow').InterpreterShadowEvent) => Promise<void> | void
  /**
   * DEC-188: Claude autodraft fora do DO — enfileira em vez de `adapter.generate`
   * no extrator/redator. `suggestReply` do painel ignora isto.
   */
  llmOutOfDo?: boolean
  /**
   * Publica na fila `tredane-llm-*` (extract/redact ou sibling `llm_shadow`).
   * Obrigatório quando `llmOutOfDo` está ligado.
   */
  enqueueLlmJob?: (msg: import('./llm-queue-types').LlmQueueEnvelope) => Promise<void>
}
