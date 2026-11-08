/**
 * DEC-152 — hint one-shot a meio do funil: «Se quiser parar, diga terminar.»
 *
 * Gatilho: BookingFrame já aberto no início do turno + resposta automática sem
 * avanço do quadro neste turno + ainda não enviado nesta tentativa.
 * Não vai na oferta de slots (P5 adiado); não no soft-decline; não no idle.
 */
import type { ClinicDb } from '../store'
import type { BookingFrame } from './schedule-session'

/** Copy Confirmada (Paulo, 08/11/2026, DEC-152 / DEC-104). */
export const END_HELP_HINT_TEXT = 'Se quiser parar, diga terminar.'

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
  return slot === 'variantes' || slot === 'horario' || slot === 'eco' || slot === 'linha'
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
export function appendEndHelpHint(body: string): string {
  const trimmed = body.trimEnd()
  if (!trimmed) return END_HELP_HINT_TEXT
  if (trimmed.includes(END_HELP_HINT_TEXT)) return trimmed
  return `${trimmed}\n\n${END_HELP_HINT_TEXT}`
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
  return (
    bookingFrameProgressKey(input.frameAtStart) === bookingFrameProgressKey(input.frameNow)
  )
}
