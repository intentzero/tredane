/**
 * Copy à cliente sem jargão interno (#405, CF-16, INV-05).
 * Termos proibidos no texto WhatsApp; frases fixas partilhadas.
 */

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

/** Recusa de misturar masculino e feminino na mesma visita (D-04). */
export const MIXED_AUDIENCE_REPLY =
  'Masculino e feminino não entram na mesma visita. Escolha um conjunto compatível — opções que sirvam para os dois também valem.'

/** Catálogo inexistente / serviço não encontrado. */
export const SERVICE_NOT_FOUND_REPLY =
  'Não encontrei esse procedimento por aqui. Quer ver as opções que temos?'

/** Catálogo mudou entre turnos. */
export const SERVICE_CHANGED_REPLY =
  'Nossas opções mudaram. Pode dizer de novo qual serviço e opção você quer?'

/** Falha ao fechar o horário — equipe segue (sem citar o painel). */
export function teamConfirmsSoonReply(serviceName: string, time: string): string {
  return `Não consegui fechar ${serviceName} às ${time} agora. A equipe confirma em seguida.`
}

/** Rótulo genérico quando o serviço não tem tipo de opção cadastrado. */
export const DEFAULT_OPTION_KIND_PLURAL = 'opções'
