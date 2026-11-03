/**
 * Copy à cliente sem jargão interno (#405, CF-16, INV-05).
 * Frases do funil via catálogo M4 (#448): sayAct + fallback literal.
 * Termos proibidos no texto WhatsApp; frases fixas partilhadas.
 */
import { sayAct } from './dialogue-acts'

/** Termos internos que nunca saem à cliente (INV-05 / DEC-090). */
export const FORBIDDEN_CLIENT_TERM_PATTERNS: ReadonlyArray<{ id: string; re: RegExp }> = [
  { id: 'sala', re: /\bsala\b/i },
  { id: 'intervalo', re: /\bintervalo\b/i },
  { id: 'buffer', re: /\bbuffer\b/i },
  { id: 'Agendar', re: /\bAgendar\b/ },
  { id: 'catálogo', re: /\bcat[aá]logo\b/i },
  { id: 'linha', re: /\blinha\b/i },
  { id: 'variante', re: /\bvariant(?:e|es)\b/i },
  { id: 'ambos', re: /\bambos\b/i },
  // IDs opacos típicos do sistema (não nomes próprios).
  { id: 'ids', re: /\b(?:svc_|zone_|res_|apt_|prop_|msg_|pcomm_)[a-z0-9]+\b/i },
]

export function forbiddenClientTermsIn(text: string): string[] {
  const hit = new Set<string>()
  for (const { id, re } of FORBIDDEN_CLIENT_TERM_PATTERNS) {
    if (re.test(text)) hit.add(id)
  }
  return [...hit]
}

export function assertNoForbiddenClientTerms(text: string, label = 'copy'): void {
  const hits = forbiddenClientTermsIn(text)
  if (hits.length > 0) {
    throw new Error(`${label}: termos proibidos à cliente (${hits.join(', ')}): ${text}`)
  }
}

/** Fallback / 1.ª redação — `recusar_mistura` (DEC-123). */
export const MIXED_AUDIENCE_REPLY =
  'Não dá para juntar masculino e feminino na mesma visita. Quer escolher só um dos dois?'

export function mixedAudienceReply(conversationId = ''): string {
  return sayAct('recusar_mistura', conversationId, {}, MIXED_AUDIENCE_REPLY)
}

/** Fallback / 1.ª redação — `servico_inexistente`. */
export const SERVICE_NOT_FOUND_REPLY =
  'Não encontrei esse procedimento por aqui. Quer ver as opções que temos?'

/**
 * Sem match no catálogo (prática 10 / #512).
 * Usa actos aprovados `servico_inexistente` + `perguntar_servico`.
 * O `{pedido}` não é copy nova: só substitui o dêitico («esse procedimento» /
 * «Esse serviço») pelo termo que a cliente escreveu, entre aspas.
 */
export function serviceNotFoundReply(
  conversationId = '',
  opts?: { pedido?: string | null; lista?: string | null },
): string {
  let text = sayAct('servico_inexistente', conversationId, {}, SERVICE_NOT_FOUND_REPLY)
  const pedido = opts?.pedido?.trim()
  if (pedido) {
    // Eco factual do pedido — clarifica o dêitico; sem frase de marketing nova (DEC-104).
    text = text
      .replace(/\besse procedimento\b/gi, `«${pedido}»`)
      .replace(/\bEsse serviço\b/, `«${pedido}»`)
  }
  const lista = opts?.lista?.trim()
  if (lista) {
    // Exige redação com `{lista}` — a 3.ª variante não lista as opções reais.
    const ask = sayAct(
      'perguntar_servico',
      conversationId,
      { lista },
      `Qual serviço você quer? Temos ${lista}.`,
      { requireInTemplate: ['{lista}'] },
    )
    text = `${text}\n${ask}`
  }
  return text
}

/** Fallback / 1.ª redação — `catalogo_mudou`. */
export const SERVICE_CHANGED_REPLY =
  'Nossas opções mudaram. Pode dizer de novo qual serviço e opção você quer?'

export function serviceChangedReply(conversationId = ''): string {
  return sayAct('catalogo_mudou', conversationId, {}, SERVICE_CHANGED_REPLY)
}

/** Fallback — `nao_consegui_fechar`. */
export function teamConfirmsSoonReply(
  serviceName: string,
  time: string,
  conversationId = '',
): string {
  const fallback = `Não consegui fechar ${serviceName} às ${time} agora. A equipe confirma em seguida.`
  return sayAct(
    'nao_consegui_fechar',
    conversationId,
    { serviço: serviceName, hora: time },
    fallback,
  )
}

/** Rótulo genérico quando o serviço não tem tipo de opção cadastrado. */
export const DEFAULT_OPTION_KIND_PLURAL = 'opções'
