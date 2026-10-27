import type { AiProviderAdapter } from '../contract'
import {
  AI_MODEL_REPLY_PROPOSED,
  AI_MODEL_SUMMARY_PROPOSED,
  AI_PROVIDER_ANTHROPIC,
  AI_TIMEOUT_MS,
} from '../budgets'
import { buildSystemPrompt, buildUserContent } from '../prompt'
import type {
  AiGenerateInput,
  AiGenerateResult,
  AiGatewayRequestInspection,
} from '../types'

export type AiGatewayConfig = {
  accountId: string
  gatewayId: string
  /** Token do AI Gateway / Unified Billing (nunca logar). */
  gatewayToken: string
  /** BYOK Anthropic opcional; se ausente, Unified Billing. */
  anthropicApiKey?: string
  fetchImpl?: typeof fetch
  replyModel?: string
  summaryModel?: string
}

/**
 * Claude via Cloudflare AI Gateway (DEC-011).
 * Header cf-aig-collect-log-payload: false — GATE-06 ainda pendente de evidência.
 */
export class AiGatewayAnthropicAdapter implements AiProviderAdapter {
  readonly providerId = AI_PROVIDER_ANTHROPIC
  readonly mode = 'gateway' as const

  #cfg: AiGatewayConfig
  #last: AiGatewayRequestInspection | null = null

  constructor(cfg: AiGatewayConfig) {
    this.#cfg = cfg
  }

  lastInspection(): AiGatewayRequestInspection | null {
    return this.#last
  }

  async generate(input: AiGenerateInput): Promise<AiGenerateResult> {
    const model =
      input.model ??
      (input.kind === 'summary'
        ? (this.#cfg.summaryModel ?? AI_MODEL_SUMMARY_PROPOSED)
        : (this.#cfg.replyModel ?? AI_MODEL_REPLY_PROPOSED))
    const systemPrompt = buildSystemPrompt(input)
    const userContent = buildUserContent(input)
    const urlPath = `/v1/${this.#cfg.accountId}/${this.#cfg.gatewayId}/anthropic/v1/messages`
    const url = `https://gateway.ai.cloudflare.com${urlPath}`

    const headers: Record<string, string> = {
      'content-type': 'application/json',
      'cf-aig-authorization': `Bearer ${this.#cfg.gatewayToken}`,
      // Confirmado como intenção de produto (DEC-011); evidência GATE-06 Em aberto.
      'cf-aig-collect-log-payload': 'false',
      'anthropic-version': '2023-06-01',
    }
    if (this.#cfg.anthropicApiKey) {
      headers['x-api-key'] = this.#cfg.anthropicApiKey
    }

    this.#last = {
      urlPath,
      model: `${AI_PROVIDER_ANTHROPIC}/${model}`,
      systemPrompt,
      userContent,
      maxTokens: input.maxOutputTokens,
      headers: {
        'cf-aig-collect-log-payload': 'false',
        'anthropic-version': '2023-06-01',
        'x-tredane-ai-mode': 'gateway',
      },
      context: input.context,
    }

    const started = Date.now()
    const timeoutMs = Math.min(input.timeoutMs, AI_TIMEOUT_MS)
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)

    try {
      const fetchImpl = this.#cfg.fetchImpl ?? fetch
      const res = await fetchImpl(url, {
        method: 'POST',
        headers,
        signal: controller.signal,
        body: JSON.stringify({
          model,
          max_tokens: input.maxOutputTokens,
          // Sem `temperature`: claude-haiku-5-5 / claude-sonnet-5-5 respondem 400
          // «`temperature` is deprecated for this model» → toda sugestão falhava
          // (provider_unavailable) em staging.
          system: systemPrompt,
          messages: [{ role: 'user', content: userContent }],
        }),
      })
      const latencyMs = Date.now() - started

      if (res.status === 429) {
        return {
          ok: false,
          code: 'rate_limit',
          message: 'AI Gateway rate limit',
          retryable: true,
          latencyMs,
          provider: this.providerId,
          model,
        }
      }
      if (!res.ok) {
        return {
          ok: false,
          code: 'provider_error',
          message: `AI Gateway HTTP ${res.status}`,
          retryable: res.status >= 500,
          latencyMs,
          provider: this.providerId,
          model,
        }
      }

      const data: unknown = await res.json()
      const text = extractAnthropicText(data)
      if (!text) {
        return {
          ok: false,
          code: 'invalid_response',
          message: 'Resposta sem texto',
          retryable: false,
          latencyMs,
          provider: this.providerId,
          model,
        }
      }

      const usage = extractUsage(data)
      return {
        ok: true,
        text,
        provider: this.providerId,
        model,
        latencyMs,
        inputTokens: usage.input,
        outputTokens: usage.output,
      }
    } catch (err) {
      const latencyMs = Date.now() - started
      const aborted = err instanceof Error && err.name === 'AbortError'
      return {
        ok: false,
        code: aborted ? 'timeout' : 'provider_error',
        message: aborted ? 'AI Gateway timeout' : 'AI Gateway network error',
        retryable: true,
        latencyMs,
        provider: this.providerId,
        model,
      }
    } finally {
      clearTimeout(timer)
    }
  }
}

function extractAnthropicText(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null
  const content = (data as { content?: unknown }).content
  if (!Array.isArray(content)) return null
  const parts: string[] = []
  for (const block of content) {
    if (
      block &&
      typeof block === 'object' &&
      (block as { type?: string }).type === 'text' &&
      typeof (block as { text?: unknown }).text === 'string'
    ) {
      parts.push((block as { text: string }).text)
    }
  }
  const joined = parts.join('\n').trim()
  return joined.length > 0 ? joined : null
}

function extractUsage(data: unknown): { input: number | null; output: number | null } {
  if (!data || typeof data !== 'object') return { input: null, output: null }
  const usage = (data as { usage?: { input_tokens?: unknown; output_tokens?: unknown } })
    .usage
  if (!usage) return { input: null, output: null }
  return {
    input: typeof usage.input_tokens === 'number' ? usage.input_tokens : null,
    output: typeof usage.output_tokens === 'number' ? usage.output_tokens : null,
  }
}
