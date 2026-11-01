/**
 * Sombra M3 (#413): compara a decisão nova com a actual sem alterar o envio.
 * As divergências vão para log estruturado (sem texto da conversa).
 */
export type ShadowDecision = {
  action:
    | 'offer_slots'
    | 'ask_empty_time'
    | 'nearby_alts'
    | 'first_slots'
    | 'ask_other_day'
    | 'next_day_alts'
    | 'catalog_price'
    | 'model'
    | 'skip_model'
    | 'other'
  detail?: string
}

export function logPolicyShadow(input: {
  tenantId: string
  conversationId: string
  phase: 'cf19' | 'cf15' | 'ca03' | 'e01'
  current: ShadowDecision
  proposed: ShadowDecision
}): void {
  if (input.current.action === input.proposed.action && input.current.detail === input.proposed.detail) {
    return
  }
  console.info(
    JSON.stringify({
      level: 'info',
      event: 'ai.policy_shadow',
      tenantId: input.tenantId,
      conversationId: input.conversationId,
      phase: input.phase,
      current: input.current.action,
      proposed: input.proposed.action,
      ...(input.current.detail ? { currentDetail: input.current.detail } : {}),
      ...(input.proposed.detail ? { proposedDetail: input.proposed.detail } : {}),
    }),
  )
}
