/**
 * Telemetria estruturada do classificador de intenção (DEC-221 / loop adaptativo F3).
 * Um evento `ai.intent_llm` por decisão: etiqueta, confiança, origem, modo e outcome
 * de negócio — alimenta amostragem offline (sem fine-tune online).
 */
import type { IntentLabel } from './intent-classifier'

/** Como o turno chegou à etiqueta (léxico não grava aqui; só caminho LLM/sombra). */
export type IntentLlmOrigin = 'llm' | 'shadow' | 'none'

/**
 * Outcome de negócio observável no apply (ou sombra no consumer).
 * Nomes estáveis para agregação (`scripts/intent-llm-report.mjs`).
 */
export type IntentLlmOutcome =
  /** Fechado → frase + cta_url Abrir agenda. */
  | 'cta'
  /** Fechado → reply Abrir agenda (lab / sem https). */
  | 'cta_reply'
  /** Fechado → texto de catálogo / FAQ. */
  | 'catalog'
  /** faq_catalog sem facto → frase missing fixa. */
  | 'catalog_missing'
  /** Fechado → oferta «Falar com a equipe». */
  | 'team'
  /** Fechado sem copy → handoff / teto / pausa. */
  | 'handoff'
  /** Classificador abriu / baixa confiança / falhou → redator. */
  | 'redactor'
  /** Redator + validador → frase DEC-107. */
  | 'fallback'
  /** Sombra: fechado ≥ limiar, mas o redator seguirá (não desvia UX). */
  | 'shadow_would_close'
  /** Sombra: aberto / baixa confiança / parse nulo. */
  | 'shadow_open'
  /** Envio recusado após handler. */
  | 'send_refused'

export type IntentLlmLogDetail = {
  tenantId: string
  conversationId?: string | null
  jobId?: string | null
  messageId?: string | null
  origin: IntentLlmOrigin
  /** `live` = pode desviar; `shadow` = só mede. */
  mode: 'live' | 'shadow'
  label?: IntentLabel | string | null
  raw?: string | null
  confidence?: number | null
  closed?: boolean
  handler?: string | null
  linkPurpose?: string | null
  outcome: IntentLlmOutcome
  sent?: boolean
  model?: string | null
  inputTokens?: number | null
  outputTokens?: number | null
}

/** Emite o evento estruturado (Workers Observability / NDJSON). */
export function logIntentLlm(detail: IntentLlmLogDetail): void {
  console.info(
    JSON.stringify({
      level: 'info',
      event: 'ai.intent_llm',
      ...detail,
      at: Date.now(),
    }),
  )
}
