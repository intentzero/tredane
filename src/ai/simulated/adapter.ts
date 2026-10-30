import type { AiProviderAdapter } from '../contract'
import { priceVisit } from '../../clinic/catalog/combo'
import { variantChoiceLabel } from '../../clinic/config/zones'
import {
  AI_MODEL_REPLY_PROPOSED,
  AI_MODEL_SUMMARY_PROPOSED,
  AI_PROVIDER_SYNTHETIC,
} from '../budgets'
import { buildSystemPrompt, buildUserContent } from '../prompt'
import {
  variantAudiencesConflict,
  type AiGenerateInput,
  type AiGenerateResult,
  type AiGatewayRequestInspection,
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
      input.model ?? (input.kind === 'summary' ? AI_MODEL_SUMMARY_PROPOSED : AI_MODEL_REPLY_PROPOSED)
    const systemPrompt = buildSystemPrompt(input)
    const userContent = buildUserContent(input)
    this.#last = {
      urlPath: '/synthetic/ai/v1/messages',
      model: `${AI_PROVIDER_SYNTHETIC}/${model}`,
      systemPrompt,
      userContent,
      maxTokens: input.maxOutputTokens,
      ...(input.temperature != null ? { temperature: input.temperature } : {}),
      headers: {
        'cf-aig-collect-log-payload': 'false',
        'cf-aig-skip-cache': 'true',
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
    return `${name} — etapa «${stage}». Último contato: ${last.slice(0, 120)}${last.length > 120 ? '…' : ''}`
  }

  #buildReply(input: AiGenerateInput): string {
    if (input.warnings.includes('clinical')) {
      return 'Obrigada pela pergunta. Para questões de saúde, uma profissional da clínica vai orientar você com segurança — posso pedir para ela entrar em contato?'
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
        if (s.zones && s.zones.length > 0) {
          const named = s.zones.filter(
            (z) => z.name.trim().length >= 2 && lower.includes(z.name.trim().toLowerCase()),
          )
          const labels = s.zones.map((z) =>
            variantChoiceLabel(
              {
                name: z.name,
                audience: z.audience ?? 'ambos',
                durationMinutes: z.durationMinutes,
                priceCents: z.priceCents,
              },
              s.zones!.map((peer) => ({
                name: peer.name,
                audience: peer.audience ?? 'ambos',
                durationMinutes: peer.durationMinutes,
                priceCents: peer.priceCents,
              })),
            ),
          )
          if (named.length === 0) {
            const kind = s.variantKindPlural?.trim() || s.variantKind?.trim() || 'variantes'
            return `Para ${s.name}, quais ${kind} você quer? Temos ${labels.join(', ')}. Me diz e eu confirmo o valor.`
          }
          const seen = new Set<string>()
          const repeated = named.some((z) => {
            const key = z.name.trim().toLocaleLowerCase('pt-BR')
            if (seen.has(key)) return true
            seen.add(key)
            return false
          })
          if (repeated) {
            return `Para ${s.name}, o nome casa com mais de uma opção. Temos ${labels.join(', ')}. Me diz qual que eu confirmo o valor.`
          }
          if (variantAudiencesConflict(named)) {
            return `Para ${s.name}, masculino e feminino não entram juntos. Ambos combina com os dois. Me diz um conjunto compatível que eu confirmo o valor.`
          }
          if (named.some((z) => z.priceCents == null)) {
            return `Sobre ${s.name} (${named.map((z) => z.name).join(', ')}), a equipe vai confirmar o valor certinho com você.`
          }
          const sum =
            priceVisit(
              named.map((z) => ({ id: z.name, priceCents: z.priceCents, active: true })),
              (s.combos ?? []).map((k, i) => ({
                id: `c${i}`,
                name: k.name,
                priceCents: k.priceCents,
                zoneIds: k.zoneNames,
                active: true,
                sortOrder: i,
              })),
            ).priceCents ?? 0
          const reais = (sum / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
          return `A ${s.name} (${named.map((z) => z.name).join(', ')}) fica ${reais}. Quer que eu veja horários disponíveis?`
        }
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

    // Pedido de horário → 2–3 horários livres reais do dia/período pedido
    const slotReply = this.#buildSlotReply(input, last)
    if (slotReply) return slotReply

    // Fallback cordial — cumprimento só no primeiro contacto da clínica
    const alreadySpoke =
      input.context.hasClinicOutbound === true ||
      input.context.messages.some((m) => m.direction === 'outbound')
    if (alreadySpoke) {
      return 'Posso ajudar com informações dos nossos serviços ou a encontrar um horário. O que prefere?'
    }
    return `Olá${input.context.contactFirstName ? ` ${input.context.contactFirstName}` : ''}! Posso ajudar com informações dos nossos serviços ou a encontrar um horário. O que prefere?`
  }

  #buildSlotReply(input: AiGenerateInput, last: string): string | null {
    const c = input.context.clinic
    if (!c || c.freeSlots.length === 0) return null
    const n = last.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    if (!/(horario|vaga|disponib|agenda|tem .*(hora|dia)|amanha|hoje|manha|tarde|noite)/.test(n)) return null
    const wantTomorrow = /amanha/.test(n)
    const wantToday = /\bhoje\b/.test(n)
    const period = /tarde/.test(n) ? 'tarde' : /manha/.test(n) ? 'manha' : /noite/.test(n) ? 'noite' : null
    const inPeriod = (t: string) => {
      const h = Number(t.slice(0, 2))
      if (period === 'manha') return h < 12
      if (period === 'tarde') return h >= 12 && h < 18
      if (period === 'noite') return h >= 18
      return true
    }
    const days = c.freeSlots.filter((d) =>
      wantTomorrow ? d.dayLabel.startsWith('amanhã') : wantToday ? d.dayLabel.startsWith('hoje') : true,
    )
    for (const d of days) {
      const times = d.times.filter(inPeriod)
      if (times.length === 0) continue
      const pick = times.length <= 3 ? times : [times[0]!, times[Math.floor(times.length / 2)]!, times[times.length - 1]!]
      const when = d.dayLabel.startsWith('amanhã')
        ? `Amanhã (${d.dayLabel.split(' ').pop()})`
        : d.dayLabel.startsWith('hoje')
          ? 'Hoje'
          : `Na ${d.dayLabel}`
      const list = pick.length === 1 ? pick[0]! : `${pick.slice(0, -1).join(', ')} e ${pick[pick.length - 1]}`
      const name = input.context.contactFirstName ? `, ${input.context.contactFirstName}` : ''
      return `Tenho sim${name}! ${when} tenho ${list} para ${d.serviceName.toLowerCase()}. Qual fica melhor pra você?`
    }
    return null
  }
}
