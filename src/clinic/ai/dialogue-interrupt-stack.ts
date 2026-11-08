/**
 * Pilha explícita de interrupção / retoma (DEC-C4 / arquitectura P1).
 *
 * Cross-cutting (`ask_info`, esclarecer, handoff) **empilha** a obrigação
 * pendente, responde, e **retoma** a mesma obrigação — sem limpar variante
 * nem reabrir ask-tipo por engano.
 *
 * Nesta fatia a pilha é **por turno** (push → realize → pop/resume no mesmo
 * turno). Persistência cross-turn fica fora do recorte (handoff DEC-083/148).
 *
 * **Proposto → em progresso.** Não viola DEC-061/104/137/147/152.
 */
import type { AskInfoTopic } from './booking-turn-gate'
import type { DialogueObligation } from './dialogue-obligation'
import { obligationFromFrame, resumeObligationAfterAskInfo } from './dialogue-obligation'
import type { BookingFrame, BookingFramePending } from './schedule-session'

/** Motivo da interrupção (política — não copy). */
export type InterruptReason = 'ask_info' | 'clarify' | 'handoff'

export type ParkedInterrupt = {
  reason: InterruptReason
  topic?: AskInfoTopic
  /** Obrigação aberta no momento do park (ou null se só havia serviço/oferta). */
  obligation: DialogueObligation | null
  /** Snapshot mínimo para assert de resume (não limpar variante / lastOffer). */
  snapshot: {
    serviceId: string | null
    variantIds: string[] | null
    pending: BookingFramePending | null
    hasLastOffer: boolean
  }
}

export type DialogueInterruptStack = ParkedInterrupt[]

export function emptyInterruptStack(): DialogueInterruptStack {
  return []
}

export function parkInterrupt(
  stack: DialogueInterruptStack,
  entry: ParkedInterrupt,
): DialogueInterruptStack {
  return [...stack, entry]
}

export function popInterrupt(
  stack: DialogueInterruptStack,
): { entry: ParkedInterrupt | null; stack: DialogueInterruptStack } {
  if (stack.length === 0) return { entry: null, stack }
  const next = stack.slice(0, -1)
  return { entry: stack[stack.length - 1]!, stack: next }
}

export function peekInterrupt(stack: DialogueInterruptStack): ParkedInterrupt | null {
  return stack.length === 0 ? null : stack[stack.length - 1]!
}

/** Constrói o park a partir do quadro actual. */
export function parkFromFrame(
  frame: BookingFrame | null | undefined,
  reason: InterruptReason,
  topic?: AskInfoTopic,
): ParkedInterrupt {
  return {
    reason,
    topic,
    obligation: obligationFromFrame(frame),
    snapshot: {
      serviceId: frame?.serviceId ?? null,
      variantIds: frame?.variantIds ?? null,
      pending: frame?.pending ?? null,
      hasLastOffer: Boolean(frame?.lastOffer?.slots?.length),
    },
  }
}

/**
 * Retoma a obrigação após a interrupção (DEC-C1/C4).
 * Identidade: a mesma pending / variante; `ask_info` usa o contrato tipado.
 */
export function resumeParkedObligation(parked: ParkedInterrupt): DialogueObligation | null {
  if (parked.reason === 'ask_info') {
    return resumeObligationAfterAskInfo(parked.obligation)
  }
  // esclarecer / handoff: pending não se limpa neste turno — mesma obrigação.
  return parked.obligation
}

/** True se o resume deve reabrir a pergunta de horário (oferta / choose_slot). */
export function shouldResumeSlotAsk(parked: ParkedInterrupt): boolean {
  return (
    parked.snapshot.hasLastOffer ||
    parked.obligation?.kind === 'choose_slot' ||
    parked.snapshot.pending?.slot === 'horario'
  )
}

/**
 * True se o resume deve reabrir ask-tipo / zonas (serviço aberto sem variante,
 * ou pending de variantes/linha).
 */
export function shouldResumeVariantAsk(parked: ParkedInterrupt): boolean {
  if (shouldResumeSlotAsk(parked)) return false
  const hasVariants = Boolean(parked.snapshot.variantIds && parked.snapshot.variantIds.length > 0)
  if (hasVariants) return false
  if (!parked.snapshot.serviceId) return false
  return (
    parked.obligation?.kind === 'choose_variants' ||
    parked.obligation?.kind === 'choose_line' ||
    parked.obligation == null
  )
}
