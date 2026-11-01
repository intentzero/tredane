/**
 * Validador único de saída à cliente (M4 / #414, núcleo §3.6).
 * Aplica-se a modelos de frase **e** ao texto do LLM (#403).
 *
 * INV-04 (reserva), INV-05 (jargão), INV-11 (formato) + forma J-07 (pergunta/tamanho).
 * Preço/hora (INV-02/03) reutilizam `validateReplyFacts` quando há contexto.
 */
import { claimsBooking, validateReplyFacts } from '../../ai/reply-facts'
import type { AiAgendaFacts, AiContextPayload } from '../../ai/types'
import { forbiddenClientTermsIn } from './client-copy'

export type OutboundSource = 'phrase' | 'llm'

export type OutboundRejection =
  | 'forbidden_terms'
  | 'claims_booking'
  | 'format'
  | 'too_long'
  | 'too_many_paragraphs'
  | 'too_many_questions'
  | 'factual_mismatch'

export type OutboundValidateOpts = {
  source?: OutboundSource
  /** Contexto do modelo — activa INV-02/03 via #403. */
  context?: AiContextPayload
  /** DEC-118: factos de agenda locais (nunca no gateway). */
  agendaFacts?: AiAgendaFacts | null
  /**
   * J-07: no máximo uma pergunta. Default true para LLM;
   * frases com listas de horário podem desligar (ex.: «Qual fica melhor?»).
   */
  requireSingleQuestion?: boolean
  /** Limite de caracteres da mensagem (J-07 = 300; WhatsApp soft = 1000). */
  maxChars?: number
}

export type OutboundValidateResult =
  | { ok: true }
  | { ok: false; reason: OutboundRejection; detail?: string }

const MARKDOWN_OR_JSON = /```|^\s*\{/m
/** Conta «?» que não estejam em URLs simples. */
const QUESTION_MARK = /\?/g

export function countQuestions(text: string): number {
  return (text.match(QUESTION_MARK) ?? []).length
}

export function countParagraphs(text: string): number {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean).length
}

/**
 * Valida texto pronto a sair à cliente.
 * Sem contexto: só forma + INV-04/05/11. Com contexto: + factos #403.
 */
export function validateClientOutbound(
  text: string,
  opts: OutboundValidateOpts = {},
): OutboundValidateResult {
  const source = opts.source ?? 'llm'
  const maxChars = opts.maxChars ?? (source === 'phrase' ? 1000 : 300)
  const requireSingleQuestion = opts.requireSingleQuestion ?? source === 'llm'

  if (!text.trim()) return { ok: false, reason: 'format', detail: 'empty' }
  if (text.length > maxChars) {
    return { ok: false, reason: 'too_long', detail: `${text.length}>${maxChars}` }
  }
  if (MARKDOWN_OR_JSON.test(text)) {
    return { ok: false, reason: 'format', detail: 'markdown_or_json' }
  }
  if (countParagraphs(text) > 3) {
    return { ok: false, reason: 'too_many_paragraphs' }
  }
  if (requireSingleQuestion && countQuestions(text) > 1) {
    return { ok: false, reason: 'too_many_questions', detail: String(countQuestions(text)) }
  }

  const jargon = forbiddenClientTermsIn(text)
  if (jargon.length > 0) {
    return { ok: false, reason: 'forbidden_terms', detail: jargon.join(',') }
  }
  if (claimsBooking(text)) {
    return { ok: false, reason: 'claims_booking' }
  }

  if (opts.context) {
    const facts = validateReplyFacts(text, opts.context, opts.agendaFacts)
    if (!facts.ok) {
      return { ok: false, reason: 'factual_mismatch', detail: facts.violation }
    }
  }

  return { ok: true }
}
