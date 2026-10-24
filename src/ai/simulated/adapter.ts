import type { AiProviderAdapter } from '../contract'
import {
  AI_MODEL_REPLY_PROPOSED,
  AI_MODEL_SUMMARY_PROPOSED,
  AI_PROVIDER_SYNTHETIC,
} from '../budgets'
import { buildSystemPrompt, buildUserContent } from '../prompt'
import type {
  AiGenerateInput,
  AiGenerateResult,
  AiGatewayRequestInspection,
} from '../types'

export type SimulatedAiOptions = {
  /** Próxima chamada falha com timeout (atendimento manual continua). */
  failNextWithTimeout?: boolean
  /** Próxima chamada falha com rate_limit. */
  failNextWithRateLimit?: boolean
  /** Latência fictícia em ms. */
  latencyMs?: number
}

/**
 * Gateway sintético para CI sem chaves (#41).
 * Respostas determinísticas alinhadas a AC-41–43; sem ferramentas.
 */
export class SimulatedAiAdapter implements AiProviderAdapter {
  readonly providerId = AI_PROVIDER_SYNTHETIC
  readonly mode = 'synthetic' as const

  #opts: SimulatedAiOptions
  #last: AiGatewayRequestInspection | null = null
  #failTimeout: boolean
  #failRate: boolean

  constructor(opts: SimulatedAiOptions = {}) {
    this.#opts = opts
    this.#failTimeout = Boolean(opts.failNextWithTimeout)
    this.#failRate = Boolean(opts.failNextWithRateLimit)
  }

  lastInspection(): AiGatewayRequestInspection | null {
    return this.#last
  }

  async generate(input: AiGenerateInput): Promise<AiGenerateResult> {
    const model =
      input.kind === 'summary' ? AI_MODEL_SUMMARY_PROPOSED : AI_MODEL_REPLY_PROPOSED
    const systemPrompt = buildSystemPrompt(input)
    const userContent = buildUserContent(input)
    this.#last = {
      urlPath: '/synthetic/ai/v1/messages',
      model: `${AI_PROVIDER_SYNTHETIC}/${model}`,
      systemPrompt,
      userContent,
      maxTokens: input.maxOutputTokens,
      headers: {
        'cf-aig-collect-log-payload': 'false',
        'x-tredane-ai-mode': 'synthetic',
      },
      context: input.context,
    }

    // Prompt injection / tool calls: nunca autorizar
    const injection =
      /ignore\s+(all\s+)?(previous|prior)\s+instructions|you\s+are\s+now|tool_call|function_call|<tool/i.test(
        userContent,
      )
    if (injection) {
      // Ainda responde de forma segura — sem ferramentas
    }

    const latency = this.#opts.latencyMs ?? 12
    if (this.#failTimeout) {
      this.#failTimeout = false
      return {
        ok: false,
        code: 'timeout',
        message: 'AI Gateway timeout (synthetic)',
        retryable: true,
        latencyMs: latency,
        provider: this.providerId,
        model,
      }
    }
    if (this.#failRate) {
      this.#failRate = false
      return {
        ok: false,
        code: 'rate_limit',
        message: 'AI Gateway rate limit (synthetic)',
        retryable: true,
        latencyMs: latency,
        provider: this.providerId,
        model,
      }
    }

    const text =
      input.kind === 'summary'
        ? this.#buildSummary(input)
        : this.#buildReply(input)

    return {
      ok: true,
      text,
      provider: this.providerId,
      model,
      latencyMs: latency,
      inputTokens: Math.ceil((systemPrompt.length + userContent.length) / 4),
      outputTokens: Math.ceil(text.length / 4),
    }
  }

  #buildSummary(input: AiGenerateInput): string {
    const name = input.context.contactFirstName ?? 'Contacto'
    const stage = input.context.stage ?? 'sem etapa'
    const last = input.context.messages.at(-1)?.body ?? ''
    return `${name} — etapa «${stage}». Último contacto: ${last.slice(0, 120)}${last.length > 120 ? '…' : ''}`
  }

  #buildReply(input: AiGenerateInput): string {
    if (input.warnings.includes('clinical')) {
      return 'Obrigada pela pergunta. Para questões de saúde, uma profissional da clínica vai orientar você com segurança — posso pedir para ela entrar em contacto?'
    }
    if (input.warnings.includes('offensive')) {
      return 'Entendo que possa estar frustrada. Estou aqui para ajudar com os nossos serviços de estética, com respeito. Como posso ajudar?'
    }
    if (input.warnings.includes('off_topic')) {
      return 'Posso ajudar com informações sobre os nossos serviços de estética e agendamentos. O que gostaria de saber?'
    }

    const last = [...input.context.messages]
      .reverse()
      .find((m) => m.direction === 'inbound')?.body ?? ''
    const lower = last.toLowerCase()

    // AC-41 preço
    for (const s of input.context.services) {
      if (!lower.includes(s.name.toLowerCase())) continue
      if (/\b(quanto|pre[cç]o|custa|valor)/i.test(last)) {
        if (s.priceCents == null) {
          return `Sobre ${s.name}, a equipe vai confirmar o valor certinho com você. Posso anotar o melhor horário para retorno?`
        }
        const reais = (s.priceCents / 100).toLocaleString('pt-BR', {
          style: 'currency',
          currency: 'BRL',
        })
        return `A ${s.name} está cadastrada por ${reais}. Quer que eu veja horários disponíveis?`
      }
      if (s.clientExplanation && /\b(como|explica|procedimento|o\s+que)/i.test(last)) {
        return `${s.clientExplanation} Quer agendar uma avaliação?`
      }
      if (
        (!s.clientExplanation || s.clientExplanation.trim() === '') &&
        /\b(como|explica|procedimento|o\s+que)/i.test(last)
      ) {
        return `Sobre ${s.name}, a equipe explica os detalhes com você no atendimento. Posso ajudar a marcar um horário?`
      }
    }

    // Fallback cordial
    return `Olá${input.context.contactFirstName ? ` ${input.context.contactFirstName}` : ''}! Posso ajudar com informações dos nossos serviços ou a encontrar um horário. O que prefere?`
  }
}
