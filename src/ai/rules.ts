import { variantAudiencesConflict, type AiCatalogService, type AiContextMessage, type AiWarningCode } from './types'
import { HEALTH_RE, OFFENSE_RE } from './sensitive-lexicon'
import { detectInjectionSignals } from './untrusted'

/**
 * Detecção local de casos DEC-046 — **Proposto / Em aberto** (critérios a medir).
 * Não autoriza ações; só alimenta avisos e o prompt.
 * Saúde/ofensa: listas únicas (#409 / CF-18).
 */

const PRICE_RE =
  /\b(quanto\s+custa|pre[cç]o|valor\s+d[oea]|custa\s+quanto|r\$\s*\d)/i

const CLINICAL_RE = HEALTH_RE
const OFFENSIVE_RE = OFFENSE_RE

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
    if (priceAsk && s.zones && s.zones.length > 0) {
      const named = s.zones.filter(
        (z) => z.name.trim().length >= 2 && last.toLowerCase().includes(z.name.trim().toLowerCase()),
      )
      if (named.length === 0 || named.some((z) => z.priceCents == null) || variantAudiencesConflict(named)) {
        if (!servicesWithoutPrice.includes(s.name)) servicesWithoutPrice.push(s.name)
      }
    } else if (priceAsk && s.priceCents == null) {
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

/**
 * Remove dados proibidos no texto livre antes de enviar ao provedor (S8 / #179).
 * Confirmado: telefones e wa.me (DEC-011). Proposto: e-mails e padrões de token/credencial.
 */
export function redactProhibitedFromText(text: string): string {
  let out = text
  // E.164 / BR mobile patterns
  out = out.replace(/\+?\d[\d\s().-]{8,}\d/g, '[redacted]')
  // wa.me links
  out = out.replace(/wa\.me\/\d+/gi, '[redacted]')
  // E-mails (não necessários ao LLM; risco de PII)
  out = out.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted]')
  // Tokens / credenciais comuns em texto colado
  out = out.replace(/\bBearer\s+[A-Za-z0-9._\-+/=]{8,}/gi, '[redacted]')
  out = out.replace(/\bsk-[A-Za-z0-9_-]{8,}/g, '[redacted]')
  out = out.replace(/\b(api[_-]?key|access[_-]?token|secret[_-]?key)\s*[:=]\s*\S+/gi, '[redacted]')
  out = out.replace(/\b(xox[baprs]-|ghp_|gho_|github_pat_)[A-Za-z0-9_-]{8,}/g, '[redacted]')
  return out
}
