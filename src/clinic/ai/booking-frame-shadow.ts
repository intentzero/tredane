/**
 * Sombra M2 (#412): caminho antigo decide; compara com o frame novo sem enviar pelo path novo.
 * Divergências → log estruturado (sem texto da conversa).
 */
export type FrameShadowDecision = {
  action:
    | 'use_pending'
    | 'ask_which'
    | 'ask_again_expired'
    | 'use_absolute_date'
    | 'use_day_label'
    | 'ask_day_after_migration'
    | 'offer_with_last_offer'
    | 'other'
  detail?: string
}

export function logBookingFrameShadow(input: {
  tenantId: string
  conversationId: string
  current: FrameShadowDecision
  proposed: FrameShadowDecision
}): void {
  if (input.current.action === input.proposed.action && input.current.detail === input.proposed.detail) {
    return
  }
  console.info(
    JSON.stringify({
      level: 'info',
      event: 'ai.booking_frame_shadow',
      tenantId: input.tenantId,
      conversationId: input.conversationId,
      current: input.current.action,
      proposed: input.proposed.action,
      ...(input.current.detail ? { currentDetail: input.current.detail } : {}),
      ...(input.proposed.detail ? { proposedDetail: input.proposed.detail } : {}),
    }),
  )
}

/**
 * Cutover M2: quando true, pending/lastOffer/date do frame autorizam;
 * day_label / zonesOfferedToClient deixam de autorizar.
 * DEC-129: o marcador `RESCHEDULE_OFFER_MARKER` foi removido — continuidade da
 * remarcação lê só `phase === 'remarcando'` / lastOffer / pending (CF-22 fechado).
 */
export const BOOKING_FRAME_CUTOVER = true
