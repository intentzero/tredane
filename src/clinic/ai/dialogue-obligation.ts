/**
 * DialogueObligation — obrigação pendente tipada (DEC-C4 / arquitectura P1).
 *
 * Uma conversa tem no máximo uma obrigação aberta (= `BookingFrame.pending` tipado).
 * Option-miss («Não encontrei … nas opções») só quando o turno *tentou* escolher
 * contra essa obrigação ou contra o catálogo de variantes (DEC-C3).
 *
 * **Proposto → em progresso** (Paulo aprovou direcção 08/11/2026). Não renumerar DEC.
 */
import type { ChoiceSlot } from './choice-offer'
import type { BookingFrame, BookingFramePending } from './schedule-session'

/** Kinds that map 1:1 to `ChoiceSlot` (pergunta aberta). */
export type DialogueObligationKind =
  | 'choose_line'
  | 'choose_variants'
  | 'choose_slot'
  | 'confirm_echo'
  | 'accumulate_zones'
  | 'choose_audience'
  | 'choose_period'
  | 'choose_alter'

export type DialogueObligation = {
  kind: DialogueObligationKind
  slot: ChoiceSlot
  options: Array<{ key: string; label: string }>
  messageId: string
}

const SLOT_TO_KIND: Record<ChoiceSlot, DialogueObligationKind> = {
  linha: 'choose_line',
  variantes: 'choose_variants',
  horario: 'choose_slot',
  eco: 'confirm_echo',
  acumular: 'accumulate_zones',
  audiencia: 'choose_audience',
  periodo: 'choose_period',
  alter: 'choose_alter',
}

const KIND_CHOICE: ReadonlySet<DialogueObligationKind> = new Set([
  'choose_line',
  'choose_variants',
  'choose_slot',
  'choose_audience',
  'choose_period',
  'choose_alter',
])

export function isChoiceSlot(slot: string): slot is ChoiceSlot {
  return (
    slot === 'linha' ||
    slot === 'variantes' ||
    slot === 'horario' ||
    slot === 'eco' ||
    slot === 'acumular' ||
    slot === 'audiencia' ||
    slot === 'periodo' ||
    slot === 'alter'
  )
}

/** Lê a obrigação a partir do pending do quadro (ou null). */
export function obligationFromPending(
  pending: BookingFramePending | null | undefined,
): DialogueObligation | null {
  if (!pending || !isChoiceSlot(pending.slot)) return null
  return {
    kind: SLOT_TO_KIND[pending.slot],
    slot: pending.slot,
    options: pending.options,
    messageId: pending.messageId,
  }
}

export function obligationFromFrame(frame: BookingFrame | null | undefined): DialogueObligation | null {
  return obligationFromPending(frame?.pending ?? null)
}

/** Obrigação de escolha fechada (lista/botões), não eco Sim/Corrigir. */
export function isChoiceObligation(ob: DialogueObligation | null): boolean {
  return ob != null && KIND_CHOICE.has(ob.kind) && ob.kind !== 'confirm_echo'
}

/**
 * DEC-C3: option-miss só quando o turno tentou escolher opção.
 *
 * - `attemptedOptionMatch`: o ramo correu match contra pending.options ou
 *   resolveZoneMention no pool de variantes do serviço aberto.
 * - Com obrigação `choose_slot`, leftover de *zona* não é miss de horário —
 *   usar esclarecer / re-oferta, não «Não encontrei X nas opções» de variantes.
 * - Sem obrigação e sem tentativa de escolha → não é option-miss.
 */
export function shouldEmitOptionMiss(input: {
  obligation: DialogueObligation | null
  unrecognizedLeftover: boolean
  /** O turno correu matching de opções/zonas (não só texto livre genérico). */
  attemptedOptionMatch: boolean
  /**
   * Hora/data no mesmo turno (ex. «09:00 e cotovelo»). Com `choose_slot`,
   * leftover de zona a meio do pedido continua option-miss (DEC-137);
   * leftover *só* (sem hora) → esclarecer (DEC-C3 / A-37).
   */
  timeInTurn?: boolean
}): boolean {
  if (!input.unrecognizedLeftover || !input.attemptedOptionMatch) return false
  if (input.obligation?.kind === 'confirm_echo') return false
  if (input.obligation?.kind === 'accumulate_zones') return false
  if (input.obligation?.kind === 'choose_audience') return false
  if (input.obligation?.kind === 'choose_slot') {
    return Boolean(input.timeInTurn)
  }
  // choose_line / choose_variants / ou ask-tipo implícito (sem pending ainda).
  if (
    input.obligation?.kind === 'choose_variants' ||
    input.obligation?.kind === 'choose_line'
  ) {
    return true
  }
  // Sem pending formal mas a tentar zonas do serviço aberto (ask-tipo / free-text).
  return input.obligation == null
}

/**
 * Após `ask_info` (preço/duração), a obrigação pendente **retoma-se** (DEC-C1/C4).
 * O frame não se limpa; esta função documenta o contrato (identidade).
 */
export function resumeObligationAfterAskInfo(
  obligation: DialogueObligation | null,
): DialogueObligation | null {
  return obligation
}
