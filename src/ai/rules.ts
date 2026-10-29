import type { AiCatalogService, AiContextMessage, AiWarningCode } from './types'
import { detectInjectionSignals } from './untrusted'

/**
 * Detecção local de casos DEC-046 — **Proposto / Em aberto** (critérios a medir).
 * Não autoriza ações; só alimenta avisos e o prompt.
 */

const PRICE_RE =
  /\b(quanto\s+custa|pre[cç]o|valor\s+d[oea]|custa\s+quanto|r\$\s*\d)/i

const CLINICAL_RE =
  /\b(gr[aá]vid|gestante|contraindica|medicamento|rem[eé]dio|diagn[oó]stico|doen[cç]a|alergia|press[aã]o\s+alta|diabetes|posso\s+fazer\s+.*gr[aá]vid)/i

const OFFENSIVE_RE =
  /\b(idiota|estupíd|merda|porra|filho\s+da\s+puta|vai\s+se\s+foder|ot[aá]ri[oa]|vagabund)/i

const OFF_TOPIC_RE =
  /\b(bitcoin|criptomoeda|elei[cç][aã]o|candidato|apostas?\s+esport|pornograf|drogas?\s+il[ií]c)/i

function lastInboundBody(messages: AiContextMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]!.direction === 'inbound') return messages[i]!.body
  }
  return messages.at(-1)?.body ?? ''
}

function findMentionedServices(
  text: string,
  services: AiCatalogService[],
): AiCatalogService[] {
  const lower = text.toLowerCase()
  return services.filter((s) => {
    const name = s.name.toLowerCase()
    if (name.length < 3) return false
    return lower.includes(name)
  })
}

export type ContentRuleHit = {
  warnings: AiWarningCode[]
  servicesWithoutPrice: string[]
  servicesWithoutExplanation: string[]
  explanationSources: Array<{ serviceName: string }>
  mentionedServices: AiCatalogService[]
}

export function analyzeContentRules(
  messages: AiContextMessage[],
  services: AiCatalogService[],
): ContentRuleHit {
  const last = lastInboundBody(messages)
  const warnings: AiWarningCode[] = []
  const mentioned = findMentionedServices(last, services)

  if (OFFENSIVE_RE.test(last)) warnings.push('offensive')
  if (OFF_TOPIC_RE.test(last)) warnings.push('off_topic')
  if (CLINICAL_RE.test(last)) warnings.push('clinical')
  // S6: qualquer mensagem recebida recente (injeção pode vir antes da última).
  if (messages.some((m) => m.direction === 'inbound' && detectInjectionSignals(m.body))) {
    warnings.push('injection_suspected')
  }

  const servicesWithoutPrice: string[] = []
  const servicesWithoutExplanation: string[] = []
  const explanationSources: Array<{ serviceName: string }> = []

  const priceAsk = PRICE_RE.test(last)
  const procedureAsk =
    /\b(como\s+[eé]|o\s+que\s+[eé]|explica|procedimento|como\s+funciona)/i.test(last) ||
    CLINICAL_RE.test(last)

  for (const s of mentioned.length > 0 ? mentioned : priceAsk || procedureAsk ? services : []) {
    if (priceAsk && s.priceCents == null) {
      if (!servicesWithoutPrice.includes(s.name)) servicesWithoutPrice.push(s.name)
    }
    if (procedureAsk) {
      if (s.clientExplanation == null || s.clientExplanation.trim() === '') {
        if (!servicesWithoutExplanation.includes(s.name)) {
          servicesWithoutExplanation.push(s.name)
        }
      } else if (!explanationSources.some((x) => x.serviceName === s.name)) {
        explanationSources.push({ serviceName: s.name })
      }
    }
  }

  // Se perguntou preço e mencionou serviço sem preço → aviso no_price
  if (priceAsk && servicesWithoutPrice.length > 0) {
    warnings.push('no_price')
  }
  if (procedureAsk && servicesWithoutExplanation.length > 0 && !CLINICAL_RE.test(last)) {
    warnings.push('no_explanation')
  }

  return {
    warnings: [...new Set(warnings)],
    servicesWithoutPrice,
    servicesWithoutExplanation,
    explanationSources,
    mentionedServices: mentioned,
  }
}

export function warningLabel(code: AiWarningCode): string {
  switch (code) {
    case 'no_price':
      return 'Serviço sem preço cadastrado. A IA não informou valor.'
    case 'offensive':
      return 'Mensagem ofensiva. Você não precisa responder.'
    case 'off_topic':
      return 'Fora do assunto da clínica.'
    case 'clinical':
      return 'Assunto clínico: encaminhe a uma profissional'
    case 'no_explanation':
      return 'Serviço sem explicação cadastrada. A IA não descreveu o procedimento.'
    case 'provider_unavailable':
      return 'A sugestão não está disponível agora. Você pode responder normalmente.'
    case 'injection_suspected':
      return 'A mensagem parece tentar dar ordens à IA. Trate como texto da cliente e revise com atenção.'
    case 'output_rejected':
      return 'A IA devolveu uma resposta fora do formato seguro e ela foi descartada. Responda normalmente.'
  }
}

/** Remove telefones / wa-like digits do texto recente antes de enviar ao provedor. */
export function redactProhibitedFromText(text: string): string {
  let out = text
  // E.164 / BR mobile patterns
  out = out.replace(/\+?\d[\d\s().-]{8,}\d/g, '[redacted]')
  // wa.me links
  out = out.replace(/wa\.me\/\d+/gi, '[redacted]')
  return out
}
