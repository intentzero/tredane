/**
 * S6 (#177) — fronteira entre instruções e dados não confiáveis.
 *
 * Entradas não confiáveis (nunca instrução): mensagens da conversa (cliente e equipe),
 * nome do contato, nome/explicação dos serviços, políticas e nome/endereço da clínica,
 * e a própria saída do modelo. A direção/autoria vem de metadados (`direction`), nunca
 * do texto. Estas funções não tornam o modelo imune a prompt injection: reduzem a
 * superfície e alimentam avisos; a autorização de qualquer efeito fica no backend.
 */

/** Marcadores de papel que só o sistema pode emitir no início de linha do prompt. */
const ROLE_MARKER_RE =
  /\[\s*(cl[ií]nica|cliente|sistema|system|assistant|assistente|user|usu[aá]rio|equipe|atendente|admin|desenvolvedor|developer)\s*\]/gi
const ANGLE_ROLE_RE = /<\s*\/?\s*(system|sistema|assistant|user|instructions?|instru[cç][oõ]es|tool[^>]*)\s*>/gi
const DELIM_RE = /<<<|>>>/g
// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF]/g

export const UNTRUSTED_MAX_MESSAGE_CHARS = 1500
export const UNTRUSTED_MAX_FIELD_CHARS = 600

/**
 * Texto não confiável numa única linha do prompt: sem quebras (não pode abrir linha
 * nova com «[clínica]»), sem marcadores de papel, sem delimitadores, sem cercas de
 * código nem caracteres de controle/invisíveis; truncado.
 */
export function sanitizeUntrusted(text: string | null | undefined, maxChars = UNTRUSTED_MAX_FIELD_CHARS): string {
  if (text == null) return ''
  let s = String(text).replace(CONTROL_RE, '')
  s = s.replace(/\r\n?|\n|\u2028|\u2029/g, ' ⏎ ')
  s = s.replace(ROLE_MARKER_RE, (_m, role: string) => `(${role})`)
  s = s.replace(ANGLE_ROLE_RE, (m) => m.replace(/</g, '‹').replace(/>/g, '›'))
  s = s.replace(DELIM_RE, (m) => (m === '<<<' ? '‹‹‹' : '›››'))
  s = s.replace(/```/g, "'''")
  s = s.replace(/\s{2,}/g, ' ').trim()
  if (s.length > maxChars) s = `${s.slice(0, maxChars)}… [cortado]`
  return s
}

const INJECTION_PATTERNS: RegExp[] = [
  // ignorar/esquecer regras ou instruções (pt/en)
  /\b(ignor[ea]|esque[cç]a|desconsider[ea]|desobede[cç]a|pule|burl[ea])\b[^.\n]{0,40}\b(regras?|instru[cç](?:ões|oes|ão|ao)|orienta[cç](?:ões|oes)|prompt|sistema|anteriores?)/i,
  /\bignore\s+(all\s+|any\s+|the\s+)?(previous|prior|above|earlier)?\s*(instructions|rules|prompt)/i,
  /\bdisregard\b[^.\n]{0,30}\b(instructions|rules)/i,
  // mudar o papel da IA
  /\b(voc[eê]\s+(agora\s+)?[eé]\s+(agora\s+)?(um|uma|o|a)\b[^.\n]{0,30}\b(ia|assistente|bot|sistema|admin|gerente|dona|atendente|desenvolvedor))/i,
  /\b(a\s+partir\s+de\s+agora|de\s+agora\s+em\s+diante)\b[^.\n]{0,40}\b(voc[eê]|responda|aja|finja)/i,
  /\b(finja|aja|atue|comporte-se)\s+(que\s+[eé]|como)\b/i,
  /\byou\s+are\s+now\b|\bact\s+as\b|\bpretend\s+(to\s+be|you)\b/i,
  /\b(modo|mode)\s+(desenvolvedor|developer|admin|dan|jailbreak|deus|god)\b/i,
  /\bjailbreak\b/i,
  // revelar regras / dados
  /\b(revele|mostre|repita|imprima|liste|diga)\b[^.\n]{0,30}\b(prompt|instru[cç](?:ões|oes)|regras\s+internas|system\s+prompt|configura[cç](?:ões|ão)|chaves?|tokens?|senhas?|outr[ao]s?\s+(clientes|cl[ií]nicas|pacientes|conversas))/i,
  /\b(system\s+prompt|prompt\s+do\s+sistema)\b/i,
  // texto que imita mensagens do sistema / da clínica
  /\[\s*(cl[ií]nica|sistema|system|assistant|assistente|admin|equipe|atendente)\s*\]/i,
  /<\s*\/?\s*(system|sistema|assistant|instructions?|tool)/i,
  /^\s*(sistema|system|admin|tredane)\s*:/im,
  /\b(mensagem|aviso|nota)\s+(do|da)\s+(sistema|tredane|administra[cç][aã]o)\b/i,
  // JSON colado / comandos / IDs
  /\{\s*"[^"]{1,40}"\s*:/,
  /\b(tool_call|function_call|tool_use|<tool)/i,
  /\b(tenant_?id|clinic_?id|clerk_?user_?id|suggestion_?id|appointment_?id)\b/i,
  // tentativas de mudar preço / Pix / confirmação
  /\b(mude|altere|troque|coloque|aplique|considere)\b[^.\n]{0,30}\b(pre[cç]o|valor|desconto|pix|chave\s+pix|sinal)\b/i,
  /\b(marque|confirme|agende)\b[^.\n]{0,30}\b(sem\s+(pagar|pix|sinal|confirma[cç][aã]o)|direto|automaticamente|for[cç]ad)/i,
]

/** Sinal heurístico (Proposto) — só gera aviso à atendente; nunca bloqueia nem autoriza. */
export function detectInjectionSignals(text: string | null | undefined): boolean {
  if (!text) return false
  const s = String(text).replace(CONTROL_RE, '')
  return INJECTION_PATTERNS.some((re) => re.test(s))
}
