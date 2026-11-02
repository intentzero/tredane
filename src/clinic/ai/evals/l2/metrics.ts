/**
 * EE-04 / EE-05 / EE-06 a partir de uma corrida L2 (#417 · plano §4.2).
 */

export type Ee05Message = {
  chars: number
  paragraphs: number
  withinLimit: boolean
}

export type EeMetrics = {
  /** EE-04: latências do modelo (ms), sem o debounce simulado de 7 s. */
  ee04: {
    samplesMs: number[]
    p50: number | null
    p95: number | null
  }
  /** EE-05: concisão das mensagens outbound. */
  ee05: {
    messages: Ee05Message[]
    pctWithinLimit: number | null
  }
  /** EE-06: chamadas e tokens (o custo USD está no ledger). */
  ee06: {
    agentCalls: number
    discardedCalls: number
    inputTokens: number
    outputTokens: number
  }
}

function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))
  return sorted[idx]!
}

export function measureEe05(bodies: string[]): EeMetrics['ee05'] {
  const messages = bodies.map((b) => {
    const chars = b.length
    const paragraphs = b.split(/\n\s*\n/).filter((p) => p.trim().length > 0).length || (b.trim() ? 1 : 0)
    return {
      chars,
      paragraphs,
      withinLimit: chars <= 300 && paragraphs <= 3,
    }
  })
  const pct =
    messages.length === 0
      ? null
      : (100 * messages.filter((m) => m.withinLimit).length) / messages.length
  return { messages, pctWithinLimit: pct }
}

export function buildEeMetrics(input: {
  modelLatenciesMs: number[]
  outboundBodies: string[]
  agentCalls: number
  discardedCalls?: number
  inputTokens: number
  outputTokens: number
}): EeMetrics {
  const sorted = [...input.modelLatenciesMs].sort((a, b) => a - b)
  return {
    ee04: {
      samplesMs: input.modelLatenciesMs,
      p50: percentile(sorted, 50),
      p95: percentile(sorted, 95),
    },
    ee05: measureEe05(input.outboundBodies),
    ee06: {
      agentCalls: input.agentCalls,
      discardedCalls: input.discardedCalls ?? 0,
      inputTokens: input.inputTokens,
      outputTokens: input.outputTokens,
    },
  }
}
