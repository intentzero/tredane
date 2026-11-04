/**
 * Mensagem que abre o Flow (ADR-0016 §4).
 * Só se usa quando `isWhatsappFlowConfigured` — senão o funil M5 continua.
 */
import { FLOW_COPY } from './copy'
import {
  isWhatsappFlowConfigured,
  resolveFlowId,
  resolveFlowMode,
  type WhatsappFlowEnv,
} from './config'
import { FLOW_MESSAGE_VERSION } from './definition'

export type BookingFlowInteractive = {
  mode: 'flow'
  flowId: string
  flowCta: string
  flowToken: string
  flowAction: 'data_exchange'
  flowMessageVersion: string
  modeDraftOrPublished: 'published' | 'draft'
  body: string
}

export function buildBookingFlowInteractive(input: {
  env: WhatsappFlowEnv
  flowToken: string
  /** Corpo Confirmado do hub (C1h interpolado) ou fallback FLOW_COPY.openBody. */
  body?: string
  /** Override do CTA (default C2h «Abrir opções»). */
  flowCta?: string
}): BookingFlowInteractive | null {
  if (!isWhatsappFlowConfigured(input.env)) return null
  const flowId = resolveFlowId(input.env)
  if (!flowId) return null
  return {
    mode: 'flow',
    flowId,
    flowCta: (input.flowCta ?? FLOW_COPY.flowCta).trim() || FLOW_COPY.flowCta,
    flowToken: input.flowToken,
    flowAction: 'data_exchange',
    flowMessageVersion: FLOW_MESSAGE_VERSION,
    modeDraftOrPublished: resolveFlowMode(input.env),
    body: (input.body ?? FLOW_COPY.openBody).trim(),
  }
}
