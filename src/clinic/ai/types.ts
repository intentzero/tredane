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
   * Página web da cliente (ADR-0018, DEC-202): emite o link pessoal e devolve o botão «Abrir
   * agenda». Ausente (ambiente sem https) = o chat passa à equipe.
   */
  prepareClientWebOffer?: import('../../clientweb/offer').PrepareClientWebOffer
  /** P4 (Proposto): o Worker classifica a intenção por LLM antes do redator. Só staging. */
  intentLlmEnabled?: boolean
  /**
   * DEC-188: Claude autodraft fora do DO — enfileira em vez de `adapter.generate`
   * no extrator/redator. `suggestReply` do painel ignora isto.
   */
  llmOutOfDo?: boolean
  /**
   * Publica na fila `tredane-llm-*` (redator de exceção).
   * Obrigatório quando `llmOutOfDo` está ligado.
   */
  enqueueLlmJob?: (msg: import('./llm-queue-types').LlmQueueEnvelope) => Promise<void>
}
