/**
 * Classificador único de handoff e temas sensíveis (#409 / CF-02, 03, 04, 13, 18).
 * Listas partilhadas por human-handoff, rules e reschedule. Sem copy nova à cliente.
 */
import {
  detectStrongInjectionSignals,
  detectWeakInjectionSignals,
} from '../../../ai/untrusted'
import { HEALTH_RE, OFFENSE_RE } from '../../../ai/sensitive-lexicon'

export type SensitiveLabel =
  | 'pedir_pessoa'
  | 'pedir_parar'
  | 'pergunta_ia'
  | 'saude'
  | 'terceiro'
  | 'cancelar'
  | 'remarcar'
  | 'ofensa'
  | 'injecao'
  | 'pergunta_politica'

export type InjectionStrength = 'fraca' | 'forte'

export type SensitiveHit = {
  label: SensitiveLabel
  injectionStrength?: InjectionStrength
  matchedBy?: string
}

/** Pedido explícito de pessoa/equipe (DEC-083). */
export const WANTS_HUMAN_RE =
  /\b(falar com (a )?(equipe|equipa|algu[eé]m|uma pessoa|atendente)|quero (uma )?pessoa|atendimento humano)\b/i

/** Pedido para parar mensagens (DEC-114). */
export const STOP_MESSAGES_RE =
  /\b(pare\s+de\s+me\s+mandar\s+mensagem|n[aã]o\s+quero\s+mais\s+mensagens|para\s+de\s+mandar)\b/i

/**
 * Transparência sobre IA (DEC-115). Antes da injeção fraca «você é atendente».
 * Não cobre elogio («ótima atendente»).
 */
export const AI_TRANSPARENCY_RE =
  /\b([eé]\s+rob[oô]\b|estou\s+falando\s+com\s+(uma\s+)?pessoa|voc[eê]\s+[eé]\s+(a\s+)?atendente|(atendente|pessoa).{0,20}rob[oô]|rob[oô].{0,20}(atendente|pessoa))\b/i

export { HEALTH_RE, OFFENSE_RE }

export const OFF_TOPIC_RE = /\b(piada|esquece a cl[ií]nica)\b/i
export const PIX_OFF_PURPOSE_RE = /\b(chave\s+pix|j[aá] paguei|pix copia)\b/i

/** Cancelar/desmarcar (acção). */
export const CANCEL_RE = /\b(cancela|cancelar|desmarca|desmarcar)\b/i

/** Remarcar / mudar horário. */
export const RESCHEDULE_RE =
  /\b(reagendar|remarca|remarcar|remarque|adiar|mudar(\s+o)?\s+hor[aá]rio|trocar(\s+o)?\s+hor[aá]rio)\b/i

/**
 * Terceiro real — alinhado a booking-object (não «para a minha pele», CF-03).
 */
export const THIRD_PARTY_RE =
  /\b(pra|para)\s+(minha|meu|o|a)\s+(m[aã]e|pai|irm[aã]|irm[aã]o|esposa|esposo|marido|filho|filha|amiga|amigo|ela|ele)\b|\be\s+pra\s+(ela|ele|outra|outro)\b|\b(agendar|marcar)\s+pra\s+(ela|ele)\b|\b(minha\s+m[aã]e|meu\s+pai|minha\s+filha|meu\s+filho|n[aã]o\s+[eé]\s+para\s+mim)\b/i

/** Pergunta condicional sobre política (CF-04 / E-06) — antes de cancelar. */
export const POLICY_QUESTION_RE =
  /\b(se\s+eu\s+(precisar|tiver\s+que|quiser)\s+(desmarcar|cancelar|remarcar)|caso\s+(eu\s+)?(desmarque|cancele|remarque)|tem\s+multa|qual\s+(a\s+)?pol[ií]tica|posso\s+(desmarcar|cancelar|remarcar)\b[^?]{0,40}\?|(desmarcar|cancelar).{0,40}\b(multa|pol[ií]tica|antes)\b)/i

function fold(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

export function classifySensitive(text: string): SensitiveHit[] {
  if (!text?.trim()) return []
  const body = String(text)
  const hits: SensitiveHit[] = []

  if (STOP_MESSAGES_RE.test(body)) hits.push({ label: 'pedir_parar', matchedBy: 'stop_messages' })
  if (WANTS_HUMAN_RE.test(body)) hits.push({ label: 'pedir_pessoa', matchedBy: 'wants_human' })
  if (AI_TRANSPARENCY_RE.test(body)) hits.push({ label: 'pergunta_ia', matchedBy: 'ai_transparency' })

  if (detectStrongInjectionSignals(body)) {
    hits.push({ label: 'injecao', injectionStrength: 'forte', matchedBy: 'strong' })
  } else if (detectWeakInjectionSignals(body) && !hits.some((h) => h.label === 'pergunta_ia')) {
    hits.push({ label: 'injecao', injectionStrength: 'fraca', matchedBy: 'role_talk' })
  }

  if (HEALTH_RE.test(body)) hits.push({ label: 'saude', matchedBy: 'health' })
  if (OFFENSE_RE.test(body)) hits.push({ label: 'ofensa', matchedBy: 'offense' })

  if (POLICY_QUESTION_RE.test(body)) {
    hits.push({ label: 'pergunta_politica', matchedBy: 'policy_q' })
  } else if (CANCEL_RE.test(body) && !RESCHEDULE_RE.test(body)) {
    hits.push({ label: 'cancelar', matchedBy: 'cancel' })
  }

  if (RESCHEDULE_RE.test(body)) hits.push({ label: 'remarcar', matchedBy: 'reschedule' })

  if (THIRD_PARTY_RE.test(fold(body))) hits.push({ label: 'terceiro', matchedBy: 'third_party' })

  return hits
}

export function isStrongInjection(hits: SensitiveHit[]): boolean {
  return hits.some((h) => h.label === 'injecao' && h.injectionStrength === 'forte')
}

export function isWeakInjection(hits: SensitiveHit[]): boolean {
  return hits.some((h) => h.label === 'injecao' && h.injectionStrength === 'fraca')
}

export function hasInjectionSignal(hits: SensitiveHit[]): boolean {
  return hits.some((h) => h.label === 'injecao')
}

/**
 * Motivos que pausam a IA (DEC-083). Não inclui pergunta_politica nem injeção fraca.
 * Ofensa, off_topic e pix off-purpose também pausam via handoffReason.
 */
export function wantsHumanPause(hits: SensitiveHit[]): boolean {
  return hits.some(
    (h) =>
      h.label === 'pedir_pessoa' ||
      h.label === 'pedir_parar' ||
      h.label === 'saude' ||
      h.label === 'terceiro' ||
      h.label === 'cancelar' ||
      h.label === 'ofensa' ||
      (h.label === 'injecao' && h.injectionStrength === 'forte'),
  )
}

export function hasPolicyQuestion(hits: SensitiveHit[]): boolean {
  return hits.some((h) => h.label === 'pergunta_politica')
}

export function hasStopRequest(hits: SensitiveHit[]): boolean {
  return hits.some((h) => h.label === 'pedir_parar')
}

export function hasAiTransparencyQuestion(hits: SensitiveHit[]): boolean {
  return hits.some((h) => h.label === 'pergunta_ia')
}

export function hasHealth(hits: SensitiveHit[]): boolean {
  return hits.some((h) => h.label === 'saude')
}

export function hasOffense(hits: SensitiveHit[]): boolean {
  return hits.some((h) => h.label === 'ofensa')
}
