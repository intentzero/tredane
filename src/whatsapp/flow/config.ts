/**
 * Prontidão operacional do Flow (ADR-0016).
 * Não é feature flag de produto: sem `WHATSAPP_FLOW_ID` + chave privada
 * o funil M5 (listas/botões) continua; o Flow não é oferecido.
 * Ligar o caminho principal e retirar o M5 é a #515, após Meta + copy.
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
