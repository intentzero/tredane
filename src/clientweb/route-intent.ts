/**
 * Encaminhamento do chat para a página web da cliente (DEC-202).
 *
 * O chat não marca, não remarca e não cancela. Qualquer pedido de marcar, remarcar, cancelar
 * ou perguntar por vaga recebe uma frase fixa do backend e o botão «Abrir agenda» com o
 * propósito certo. Este módulo só decide o propósito, e é puramente léxico: sem LLM, sem estado
 * da conversa além de «a cliente tem marcação futura».
 *
 * Perguntas de informação («quanto custa a massagem?», «quanto tempo dura?», «o que é peeling?»)
 * não são pedido de marcar, mesmo com o nome do serviço: seguem para o catálogo e a FAQ.
 */
import { CANCEL_RE, RESCHEDULE_RE, classifySensitive, hasPolicyQuestion } from '../clinic/ai/nlu/sensitive'

export type ClientWebRoutePurpose = 'agendar' | 'remarcar' | 'cancelar'

export type ClientWebRoute = {
  purpose: ClientWebRoutePurpose
  /** Serviço único reconhecido por léxico no texto (DEC-202(4)); só para `agendar`. */
  serviceId: string | null
  /** Pediu remarcar ou cancelar mas não tem marcação futura: o link abre em agendar. */
  noUpcoming: boolean
  /**
   * Turno misto (DEC-202, 18/11/2026): pede marcar **e** pergunta informação (preço, duração…).
   * O chat responde à informação e junta o link na mesma mensagem.
   */
  mixed?: boolean
}

/** Campos do catálogo que o reconhecimento lê. */
export type RouteServiceHint = {
  id: string
  name: string
  active: boolean
  synonyms?: readonly string[] | null
  zones?: readonly { name: string; active: boolean; synonyms?: readonly string[] | null }[] | null
}

/** Verbo ou expressão inequívoca de marcar ou de procurar vaga. */
const BOOK_STRONG =
  /\b(marcar|marca[cç][aã]o|marque|agendar|agendamento|agende|reservar|reserva|encaixe|encaixar|vagas?|disponibilidade|dispon[ií]ve(?:l|is)|hor[aá]rios?\s+(?:livres?|dispon)|tem\s+(?:hor[aá]rio|horario|vaga|agenda)|teria\s+(?:hor[aá]rio|vaga)|consigo\s+(?:hor[aá]rio|vaga)|abrir\s+(?:a\s+)?agenda)\b/i

/** Querer fazer algo («quero massagem», «gostaria de fazer depilação»). Só conta com um serviço nomeado. */
const WANT = /\b(quero|queria|gostaria|preciso|desejo|pretendo|vou\s+querer|posso\s+fazer|d[aá]\s+pra\s+fazer|da\s+para\s+fazer)\b/i

/** Dia, período ou hora: com um serviço nomeado já é pedido de marcar. */
const WHEN =
  /\b(hoje|amanh[aã]|depois\s+de\s+amanh[aã]|segunda|ter[cç]a|quarta|quinta|sexta|s[aá]bado|domingo|semana\s+que\s+vem|pr[oó]xima\s+semana|manh[aã]|tarde|noite|\d{1,2}\/\d{1,2}|\d{1,2}\s*(?:h|horas?)(?:\s*\d{2})?|\d{1,2}:\d{2})\b/i

/** Pergunta de informação: preço, duração, explicação, local, quem faz, política. */
const INFO =
  /\b(quanto\s+(?:custa|é|e|fica|sai|tempo|dura)|qual\s+(?:o|é\s+o)?\s*(?:valor|pre[cç]o|endere[cç]o)|valor(?:es)?|pre[cç]os?|custa|dura[cç][aã]o|demora|quanto\s+tempo|o\s+que\s+[eé]|como\s+funciona|para\s+que\s+serve|onde\s+fica|endere[cç]o|quem\s+faz|d[oó]i|contraindica|cuidados?)\b/i

/** Cumprimento puro: a abertura do chat leva o link para a página inicial. */
const GREET_ONLY =
  /^(oi+|ol[aá]|bom\s+dia|boa\s+tarde|boa\s+noite|oie|opa|e\s+a[ií]|tudo\s+bem|td\s+bem)([\s,!.?]+(tudo\s+bem|td\s+bem|como\s+vai))?[\s!.?]*$/i

export function isGreetingOnly(text: string): boolean {
  return GREET_ONLY.test(text.trim())
}

/** Pergunta condicional ou de custo sobre remarcar/cancelar («se eu remarcar, cobram?») é política, não pedido. */
const POLICY_COND =
  /\b(?:se\s+eu\s+(?:remarcar|cancelar|desmarcar|faltar|atrasar)|cobram|cobran[cç]a|multa|taxa)\b/i

export function isCancelRequest(text: string): boolean {
  const body = text.trim()
  if (!body) return false
  // Pergunta condicional sobre multa ou política não é pedido de cancelar (CF-04).
  if (hasPolicyQuestion(classifySensitive(body)) || POLICY_COND.test(body)) return false
  return CANCEL_RE.test(body) && !RESCHEDULE_RE.test(body)
}

export function isRescheduleRequest(text: string): boolean {
  const body = text.trim()
  if (!body) return false
  if (hasPolicyQuestion(classifySensitive(body)) || POLICY_COND.test(body)) return false
  return RESCHEDULE_RE.test(body)
}

function fold(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
}

/** Plural leve: «axilas» casa com «axila», «pernas» com «perna». */
function stem(word: string): string {
  return word.length > 3 && word.endsWith('s') ? word.slice(0, -1) : word
}

function tokens(text: string): string[] {
  return fold(text)
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .map(stem)
}

/** O texto cita o termo como sequência de palavras inteiras (sem acentos, plural leve). */
export function textCitesTerm(text: string, term: string): boolean {
  const needle = tokens(term)
  if (needle.length === 0 || needle.join('').length < 3) return false
  const hay = tokens(text)
  outer: for (let i = 0; i + needle.length <= hay.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (hay[i + j] !== needle[j]) continue outer
    }
    return true
  }
  return false
}

/**
 * Serviços ativos citados no texto, pelo nome, sinónimo, nome de variante ou sinónimo de variante.
 * O nome e o sinónimo do serviço ganham às variantes (uma zona com o mesmo nome em dois serviços
 * não deve impedir reconhecer o serviço nomeado).
 */
export function servicesCitedInText(services: readonly RouteServiceHint[], text: string): RouteServiceHint[] {
  const active = services.filter((s) => s.active)
  const byService = active.filter(
    (s) => textCitesTerm(text, s.name) || (s.synonyms ?? []).some((syn) => textCitesTerm(text, syn)),
  )
  if (byService.length > 0) return dropContainedNames(byService)
  return active.filter((s) =>
    (s.zones ?? []).some(
      (z) =>
        z.active &&
        (textCitesTerm(text, z.name) || (z.synonyms ?? []).some((syn) => textCitesTerm(text, syn))),
    ),
  )
}

/** «Massagem» e «Massagem relaxante» citados juntos: ganha o nome mais longo (o nome curto está contido). */
function dropContainedNames(found: RouteServiceHint[]): RouteServiceHint[] {
  const names = found.map((s) => tokens(s.name))
  const contained = (a: string[], b: string[]): boolean => {
    if (a.length >= b.length) return false
    for (let i = 0; i + a.length <= b.length; i++) {
      if (a.every((w, j) => b[i + j] === w)) return true
    }
    return false
  }
  return found.filter((_, i) => !names.some((other, j) => j !== i && contained(names[i]!, other)))
}


/**
 * Decide se o texto é pedido de marcar, remarcar ou cancelar. `null` = não é (o chat informa).
 *
 * - remarcar e cancelar ganham a marcar; sem marcação futura, abrem em agendar (`noUpcoming`);
 * - marcar: verbo inequívoco, ou um serviço nomeado com dia/hora ou com «quero»;
 * - uma pergunta de informação sem verbo inequívoco não é pedido de marcar.
 */
export function routeToClientWeb(input: {
  text: string
  services: readonly RouteServiceHint[]
  hasUpcoming: boolean
}): ClientWebRoute | null {
  const text = input.text.trim()
  if (!text) return null
  if (isCancelRequest(text)) {
    return input.hasUpcoming
      ? { purpose: 'cancelar', serviceId: null, noUpcoming: false }
      : { purpose: 'agendar', serviceId: null, noUpcoming: true }
  }
  if (isRescheduleRequest(text)) {
    return input.hasUpcoming
      ? { purpose: 'remarcar', serviceId: null, noUpcoming: false }
      : { purpose: 'agendar', serviceId: null, noUpcoming: true }
  }
  const strong = BOOK_STRONG.test(text)
  const info = INFO.test(text) || INFO.test(fold(text))
  if (info && !strong) return null
  const cited = servicesCitedInText(input.services, text)
  const serviceId = cited.length === 1 ? cited[0]!.id : null
  if (strong) return { purpose: 'agendar', serviceId, noUpcoming: false, ...(info ? { mixed: true } : {}) }
  if (cited.length > 0 && (WHEN.test(text) || WANT.test(text))) {
    return { purpose: 'agendar', serviceId, noUpcoming: false }
  }
  return null
}
