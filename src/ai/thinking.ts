/**
 * Modo de extended thinking no pedido Anthropic (proposta H9).
 * `default` = não envia campo (comportamento actual em staging/prod).
 */
export type AiThinkingMode = 'default' | 'off' | 'minimal'

export type AnthropicThinkingPayload =
  | { type: 'disabled' }
  | { type: 'enabled'; budget_tokens: number }

/** Teto sugerido para experiência «minimal» (só quando env pede). */
export const AI_THINKING_MINIMAL_BUDGET_TOKENS = 1024

export function parseThinkingMode(raw: string | undefined): AiThinkingMode {
  if (raw === 'off' || raw === 'minimal') return raw
  return 'default'
}

export function thinkingPayloadForMode(
  mode: AiThinkingMode | undefined,
  budgetTokens = AI_THINKING_MINIMAL_BUDGET_TOKENS,
): AnthropicThinkingPayload | undefined {
  if (!mode || mode === 'default') return undefined
  if (mode === 'off') return { type: 'disabled' }
  return { type: 'enabled', budget_tokens: budgetTokens }
}