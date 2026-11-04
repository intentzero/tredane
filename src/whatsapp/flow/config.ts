/**
 * Prontidão operacional do Flow (ADR-0016).
 * Não é feature flag de produto: com `WHATSAPP_FLOW_ID` + chave privada
 * o autodraft oferece o CTA `type: flow` no lugar de Feminina/Masculina,
 * Opções e Horários. Sem esses secrets o funil M5 continua.
 * Retirar o código M5 de envio é a #515.
 */

export type WhatsappFlowEnv = {
  WHATSAPP_FLOW_ID?: string
  WHATSAPP_FLOW_PRIVATE_KEY?: string
  /** `published` (default) | `draft` — só draft em teste pré-publicação. */
  WHATSAPP_FLOW_MODE?: string
  META_APP_SECRET?: string
  ENVIRONMENT?: string
}

export function isWhatsappFlowConfigured(env: WhatsappFlowEnv): boolean {
  const id = (env.WHATSAPP_FLOW_ID ?? '').trim()
  const key = (env.WHATSAPP_FLOW_PRIVATE_KEY ?? '').trim()
  return id.length > 0 && key.length > 0
}

export function resolveFlowMode(env: WhatsappFlowEnv): 'published' | 'draft' {
  return (env.WHATSAPP_FLOW_MODE ?? '').trim().toLowerCase() === 'draft'
    ? 'draft'
    : 'published'
}

export function resolveFlowId(env: WhatsappFlowEnv): string | null {
  const id = (env.WHATSAPP_FLOW_ID ?? '').trim()
  return id.length > 0 ? id : null
}
