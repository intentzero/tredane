/**
 * DEC-152 — hint one-shot a meio do funil: «Se quiser parar, diga terminar.»
 *
 * Gatilho: BookingFrame já aberto no início do turno + resposta automática sem
 * avanço do quadro neste turno + ainda não enviado nesta tentativa.
 * Não vai na oferta de slots (P5 adiado); não no soft-decline; não no idle.
 *
 * DEC-C2 (Proposto): toda copy que ensina «diga X» de saída obriga X ∈ Class A
 * no mesmo módulo — ver `botTaughtExitCommands` + teste de paridade.
 */
import type { ClinicDb } from '../store'
import { DIALOGUE_ACTS, sayAct } from './dialogue-acts'
import type { BookingFrame } from './schedule-session'

/** Fallback Confirmado (Paulo, 08/11/2026, DEC-152 / DEC-104) — acto `orientar_terminar`. */
export const END_HELP_HINT_TEXT = 'Se quiser parar, diga terminar.'

/**
 * Hint one-shot em option-miss mid-funnel (Paulo 09/11/2026, pacote reset).
 * Paridade: «começar de novo» = CF-28; «terminar» = Class A DEC-152.
 */
export const RESET_DISCOVERY_HINT_TEXT =
  'Para recomeçar, diga começar de novo. Para parar, diga terminar.'

/**
 * Meta-pergunta «como termino?» (smoke Paulo 10/11/2026).
 * Não é Class A (não encerra); não é DEC-114 (não pausa); não chama o modelo —
 * o LLM inventava histórico falso («já tocou Terminar») e handoff.
 * Ensina o mesmo comando da DEC-152 / DEC-C2.
 */
export const HOW_TO_END_REPLY =
  'Para encerrar, diga terminar. Se o botão Terminar aparecer, pode tocar nele.'

/** Exact «Terminar» (Class A) — não é pergunta de como. */
const EXACT_TERMINAR_RE =
  /^(?:(?:ok|pode|podes|quero)[,.\s!]*)*terminar(?:\s+a\s+sess[aã]o)?[.!?\s]*$/i

/**
 * «Como faço para terminar esta conversa?» e equivalentes.
 * Não casa o abandono exacto «Terminar» / «quero terminar a sessão».
 */
export function isHowToEndQuestion(text: string): boolean {
  const body = text.trim()
  if (!body) return false
  if (EXACT_TERMINAR_RE.test(body)) return false
  if (/\bcomo\b.{0,48}\b(?:terminar|encerrar)\b/i.test(body)) return true
  if (/\b(?:terminar|encerrar)\s+(?:esta|a)\s+conversa\b/i.test(body) && /\?/.test(body)) {
    return true
  }
  return false
}

/**
 * Extrai comandos de saída ensinados por «diga X» (uma palavra).
 * Multi-token (ex. serviços masculinos no catálogo DEC-142) não casa.
 */
export function taughtExitCommandsFromCopy(texts: readonly string[]): string[] {
  const out = new Set<string>()
  // Sem aspas no padrão: o scanner de call-sites (#448) parte literais "…" no ficheiro.
  const re = /\bdiga\s+([a-záàâãéêíóôõúç]+)(?=\s*[.!?…]|$)/gi
  for (const text of texts) {
    for (const m of text.matchAll(re)) {
      const word = (m[1] ?? '').toLowerCase()
      if (word) out.add(word)
    }
  }
  return [...out]
}

/** Frases de saída que o bot ensina hoje (hint DEC-152 + option-miss + meta + acto). */
export function botTaughtExitCommands(): string[] {
  return taughtExitCommandsFromCopy([
    END_HELP_HINT_TEXT,
    RESET_DISCOVERY_HINT_TEXT,
    HOW_TO_END_REPLY,
    ...DIALOGUE_ACTS.orientar_terminar,
  ])
}

/** «começar de novo» ensinado no hint de discovery (multi-token; CF-28). */
export function botTaughtRestartPhraseInCopy(): boolean {
  return /diga\s+come[cç]ar\s+de\s+novo/i.test(RESET_DISCOVERY_HINT_TEXT)
}

/** Junta o hint de discovery ao corpo do option-miss. Idempotente. */
export function appendResetDiscoveryHint(body: string): string {
  const trimmed = body.trimEnd()
  if (!trimmed) return RESET_DISCOVERY_HINT_TEXT
  if (trimmed.includes(RESET_DISCOVERY_HINT_TEXT)) return trimmed
  if (trimmed.includes('diga começar de novo')) return trimmed
  return `${trimmed}\n\n${RESET_DISCOVERY_HINT_TEXT}`
}

export type FrameProgressHint = Pick<
  BookingFrame,
  | 'serviceId'
  | 'line'
  | 'variantIds'
  | 'date'
  | 'period'
  | 'time'
  | 'pending'
  | 'proposal'
  | 'lastOffer'
>

/** Sessão de marcação a meio (não só hold de audiência do catálogo). */
export function isOpenBookingAttempt(frame: BookingFrame | null | undefined): boolean {
  if (!frame) return false
  if (frame.serviceId) return true
  if (frame.lastOffer) return true
  if (frame.proposal) return true
  const slot = frame.pending?.slot
  return (
    slot === 'variantes' ||
    slot === 'horario' ||
    slot === 'eco' ||
    slot === 'linha' ||
    slot === 'periodo'
  )
}

/**
 * Chave de progresso do funil (ignora messageId / opções da lista).
 * Troca de `pending.slot`, variantes, data/hora ou proposta = avanço.
 */
export function bookingFrameProgressKey(frame: FrameProgressHint | null | undefined): string {
  if (!frame) return ''
  const variants = frame.variantIds?.length
    ? [...frame.variantIds].sort().join(',')
    : ''
  const pendingSlot = frame.pending?.slot ?? ''
  const proposalId = frame.proposal?.id ?? ''
  const lastOffer = frame.lastOffer != null ? '1' : '0'
  return [
    frame.serviceId ?? '',
    frame.line ?? '',
    variants,
    frame.date ?? '',
    frame.period ?? '',
    frame.time ?? '',
    pendingSlot,
    proposalId,
    lastOffer,
  ].join('|')
}

export function wasEndHelpHintSent(
  db: ClinicDb,
  tenantId: string,
  conversationId: string,
): boolean {
  const row = db.get<{ sent: number }>(
    `SELECT end_help_hint_sent AS sent FROM schedule_sessions
     WHERE tenant_id = ? AND conversation_id = ?`,
    tenantId,
    conversationId,
  )
  return row?.sent === 1
}

export function markEndHelpHintSent(
  db: ClinicDb,
  tenantId: string,
  conversationId: string,
): void {
  db.run(
    `UPDATE schedule_sessions
     SET end_help_hint_sent = 1
     WHERE tenant_id = ? AND conversation_id = ?`,
    tenantId,
    conversationId,
  )
}

/** Junta o hint ao corpo (uma linha nova). Idempotente se já estiver lá. */
export function appendEndHelpHint(body: string, conversationId = ''): string {
  const hint = sayAct(
    'orientar_terminar',
    conversationId,
    {},
    END_HELP_HINT_TEXT,
  )
  const trimmed = body.trimEnd()
  if (!trimmed) return hint
  if (trimmed.includes(hint) || trimmed.includes(END_HELP_HINT_TEXT)) return trimmed
  return `${trimmed}\n\n${hint}`
}

/** Soft-decline / adeus — não acrescentar hint. */
export function isBookingExitReply(replyText: string, notes?: string): boolean {
  if (notes && /DEC-147|abandon|soft.?decline|restart|CF-28/i.test(notes)) return true
  return /quando quiser|fico por aqui|qualquer coisa|fica à vontade|fica a vontade/i.test(
    replyText,
  )
}

export function shouldAppendEndHelpHint(input: {
  replyText: string | undefined
  proposalId?: string
  notes?: string
  frameAtStart: BookingFrame | null
  frameNow: BookingFrame | null
  alreadySent: boolean
}): boolean {
  const body = input.replyText?.trim()
  if (!body) return false
  if (input.proposalId) return false
  if (input.alreadySent) return false
  if (!isOpenBookingAttempt(input.frameAtStart)) return false
  if (!input.frameNow || !isOpenBookingAttempt(input.frameNow)) return false
  if (isBookingExitReply(body, input.notes)) return false
  if (body.includes(END_HELP_HINT_TEXT)) return false
  // Option-miss já ensinou «terminar» (+ recomeçar) — não duplicar DEC-152.
  if (body.includes(RESET_DISCOVERY_HINT_TEXT)) return false
  return (
    bookingFrameProgressKey(input.frameAtStart) === bookingFrameProgressKey(input.frameNow)
  )
}
