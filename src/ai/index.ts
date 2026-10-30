export type { AiProviderAdapter } from './contract'
export {
  AI_CONTEXT_MESSAGE_LIMIT_PROPOSED,
  AI_TIMEOUT_MS,
  AI_MAX_OUTPUT_TOKENS_REPLY,
  AI_MAX_OUTPUT_TOKENS_SUMMARY,
  AI_MODEL_REPLY_PROPOSED,
  AI_MODEL_SUMMARY_PROPOSED,
  AI_MODEL_AUTODRAFT,
  AI_MODEL_REGENERATE,
  AI_REPLY_TEMPERATURE,
  AI_AUTODRAFT_DEBOUNCE_MS,
  AI_DAILY_DRAFT_CAP,
  AI_PROVIDER_ANTHROPIC,
  AI_PROVIDER_SYNTHETIC,
} from './budgets'
export { buildSystemPrompt, buildUserContent, formatBRL } from './prompt'
export {
  applyDraftContinuity,
  countClinicOutbound,
  hasClinicOutbound,
  startsWithGreeting,
  stripLeadingGreeting,
} from './continuity'
export {
  analyzeContentRules,
  warningLabel,
  redactProhibitedFromText,
  type ContentRuleHit,
} from './rules'
export { SimulatedAiAdapter, type SimulatedAiOptions } from './simulated/adapter'
export {
  AiGatewayAnthropicAdapter,
  type AiGatewayConfig,
} from './gateway/anthropic'
export type * from './types'

import type { AiProviderAdapter } from './contract'
import { AiGatewayAnthropicAdapter, type AiGatewayConfig } from './gateway/anthropic'
import { SimulatedAiAdapter, type SimulatedAiOptions } from './simulated/adapter'
import type { AiMode } from './types'

export type BuildAiAdapterInput = {
  mode: AiMode
  gateway?: AiGatewayConfig
  simulated?: SimulatedAiOptions
  /** Injecção de testes. */
  override?: AiProviderAdapter
}

export function resolveAiMode(raw: string | undefined | null): AiMode {
  const v = (raw ?? '').trim().toLowerCase()
  if (v === 'gateway' || v === 'live') return 'gateway'
  return 'synthetic'
}

/** Lista os segredos em falta (só nomes, nunca valores). */
export function missingGatewayKeys(gateway: AiGatewayConfig | undefined): string[] {
  const missing: string[] = []
  if (!gateway?.accountId) missing.push('CF_ACCOUNT_ID')
  if (!gateway?.gatewayId) missing.push('AI_GATEWAY_ID')
  if (!gateway?.gatewayToken) missing.push('AI_GATEWAY_TOKEN')
  return missing
}

/**
 * AI_MODE=gateway mas sem chaves → cai no simulado. Agora fica visível:
 * log estruturado + flag para o aviso no painel.
 */
export function isSyntheticFallback(input: BuildAiAdapterInput): boolean {
  return !input.override && input.mode === 'gateway' && missingGatewayKeys(input.gateway).length > 0
}

export function buildAiAdapter(input: BuildAiAdapterInput): AiProviderAdapter {
  if (input.override) return input.override
  if (input.mode === 'gateway') {
    const missing = missingGatewayKeys(input.gateway)
    if (missing.length > 0) {
      // Sem chaves → fallback synthetic (CI / local). Atendimento manual intacto.
      console.warn(
        JSON.stringify({ level: 'warn', event: 'ai.synthetic_fallback', aiMode: 'gateway', missing }),
      )
      return new SimulatedAiAdapter(input.simulated)
    }
    return new AiGatewayAnthropicAdapter(input.gateway!)
  }
  return new SimulatedAiAdapter(input.simulated)
}
export {
  guardReplyOutput,
  guardSummaryOutput,
  parseReplyOutput,
  stripMarkdown,
  REPLY_OUTPUT_MAX_MESSAGE_CHARS,
  REPLY_OUTPUT_MAX_NOTES_CHARS,
  type GuardedReply,
  type GuardedSummary,
  type ParsedReply,
  type ReplyOutputRejection,
} from './reply-output'
export { detectInjectionSignals, sanitizeUntrusted } from './untrusted'
