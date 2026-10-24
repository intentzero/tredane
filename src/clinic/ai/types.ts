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
}
