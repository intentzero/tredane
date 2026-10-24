export type { AiProviderAdapter } from './contract'
export {
  AI_CONTEXT_MESSAGE_LIMIT_PROPOSED,
  AI_TIMEOUT_MS,
  AI_MAX_OUTPUT_TOKENS_REPLY,
  AI_MAX_OUTPUT_TOKENS_SUMMARY,
  AI_MODEL_REPLY_PROPOSED,
  AI_MODEL_SUMMARY_PROPOSED,
  AI_PROVIDER_ANTHROPIC,
  AI_PROVIDER_SYNTHETIC,
} from './budgets'
export { buildSystemPrompt, buildUserContent } from './prompt'
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

export function buildAiAdapter(input: BuildAiAdapterInput): AiProviderAdapter {
  if (input.override) return input.override
  if (input.mode === 'gateway') {
    if (!input.gateway?.accountId || !input.gateway.gatewayId || !input.gateway.gatewayToken) {
      // Sem chaves → fallback synthetic (CI / local). Atendimento manual intacto.
      return new SimulatedAiAdapter(input.simulated)
    }
    return new AiGatewayAnthropicAdapter(input.gateway)
  }
  return new SimulatedAiAdapter(input.simulated)
}
