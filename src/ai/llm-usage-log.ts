/**
 * Telemetria de chamada LLM sem PII (só ids, métricas e modelo).
 */
export type LlmUsageLog = {
  purpose: 'extract' | 'exception' | 'reply' | 'summary' | 'shadow' | 'panel'
  provider: string
  model: string
  latencyMs: number
  inputTokens: number | null
  outputTokens: number | null
  thinkingTokens: number | null
  tenantId?: string
  conversationId?: string
  messageId?: string
  ok: boolean
}

export function logLlmUsage(entry: LlmUsageLog): void {
  console.log(
    JSON.stringify({
      level: 'info',
      event: 'ai.llm_usage',
      ...entry,
    }),
  )
}