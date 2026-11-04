/**
 * Oferta live do Flow no funil de marcação (ADR-0016 §4 / #514).
 * Quando `WHATSAPP_FLOW_ID` + chave privada estão no ambiente, substitui
 * Feminina/Masculina, Opções e Horários (M5) pelo CTA `type: flow`.
 * Sim/Corrigir do eco (DEC-137) mantém-se — não é funil M5 (#515).
 */
import type { Clock } from '../../db/clock'
import {
  parseChoiceId,
  toSendInteractive,
  type ChoiceInteractive,
} from '../../clinic/ai/choice-offer'
import type { DeferredBookingFrame } from '../../clinic/ai/deferred-booking-frame'
import type { BookingFrame } from '../../clinic/ai/schedule-session'
import type { SendOutboundInteractiveInput } from '../../clinic/inbox/types'
import {
  isWhatsappFlowConfigured,
  type WhatsappFlowEnv,
} from './config'
import { createD1FlowOps } from './flow-d1'
import { buildBookingFlowInteractive } from './offer'
import type { FlowBookingSnapshot } from './screens'
import { generateFlowToken } from './tokens'

export type PrepareBookingFlowOfferInput = {
  tenantId: string
  conversationId: string
  catalogVersion: string
  session?: FlowBookingSnapshot
  /** Corpo C1h interpolado (clínica + hora). Sem isto usa FLOW_COPY.openBody. */
  body?: string
}

export type PreparedBookingFlowOffer = {
  interactive: SendOutboundInteractiveInput
  body: string
  flowToken: string
}

/** Callback injectado no autodraft / choice-offer (DO tem D1 + secrets). */
export type PrepareBookingFlowOffer = (
  input: PrepareBookingFlowOfferInput,
) => Promise<PreparedBookingFlowOffer | null>

/**
 * True para linha / variantes / horários do M5.
 * False para eco Sim/Corrigir e para ausência de interactive.
 */
export function isM5FunnelChoiceInteractive(
  choice: ChoiceInteractive | null | undefined,
): boolean {
  if (!choice) return false
  if (choice.mode === 'list') {
    const rowId = choice.sections[0]?.rows[0]?.id
    if (!rowId) return true
    const parsed = parseChoiceId(rowId)
    return parsed?.slot === 'variantes' || parsed?.slot === 'horario'
  }
  const firstId = choice.buttons[0]?.id
  if (!firstId) return false
  const parsed = parseChoiceId(firstId)
  return parsed?.slot === 'linha'
}

/** Snapshot inicial do Flow a partir do BookingFrame já preenchido (texto livre). */
export function sessionFromBookingFrame(
  frame: BookingFrame | null | undefined,
): FlowBookingSnapshot {
  if (!frame) {
    return { serviceId: null, line: null, variantIds: null, slotKey: null }
  }
  const line =
    frame.line === 'feminino' || frame.line === 'masculino' ? frame.line : null
  const variantIds =
    frame.variantIds && frame.variantIds.length > 0 ? [...frame.variantIds] : null
  const slotKey =
    frame.date && frame.time ? `${frame.date}T${frame.time}` : null
  return {
    serviceId: frame.serviceId,
    line,
    variantIds,
    slotKey,
  }
}

/**
 * Remove pending/lastOffer M5 do frame diferido — a sessão passa a ser o flow_token.
 * Mantém serviço/linha/variantes já no quadro.
 */
export function clearM5PendingOnDeferred(deferred: DeferredBookingFrame | undefined): void {
  if (!deferred) return
  deferred.saveFrame({ pending: null, lastOffer: null })
}

type BindingRow = {
  id: string
  phone_number_id: string
  waba_id: string
  status: string
}

/**
 * Cria `flow_token` no D1, devolve interactive Cloud API `type: flow`.
 * Sem secrets / sem binding activo → null (M5 continua).
 */
export async function prepareBookingFlowOfferFromEnv(input: {
  env: WhatsappFlowEnv & { DB: D1Database }
  clock: Clock
  tenantId: string
  conversationId: string
  catalogVersion: string
  session?: FlowBookingSnapshot
  /** Corpo C1h interpolado (clínica + hora). Sem isto usa FLOW_COPY.openBody. */
  body?: string
}): Promise<PreparedBookingFlowOffer | null> {
  if (!isWhatsappFlowConfigured(input.env)) return null

  const row = await input.env.DB.prepare(
    `SELECT id, phone_number_id, waba_id, status
     FROM whatsapp_phone_bindings
     WHERE tenant_id = ? AND status = 'active'
     LIMIT 1`,
  )
    .bind(input.tenantId)
    .first<BindingRow>()
  if (!row) return null

  const flowToken = generateFlowToken()
  const ops = createD1FlowOps(input.env.DB, input.clock)
  await ops.insertToken({
    token: flowToken,
    tenantId: input.tenantId,
    bindingId: row.id,
    phoneNumberId: row.phone_number_id,
    wabaId: row.waba_id,
    conversationId: input.conversationId,
    catalogVersion: input.catalogVersion,
    session: input.session,
  })

  const built = buildBookingFlowInteractive({
    env: input.env,
    flowToken,
    body: input.body,
  })
  if (!built) return null

  return {
    flowToken,
    body: built.body,
    interactive: {
      flow: {
        flowId: built.flowId,
        flowCta: built.flowCta,
        flowToken: built.flowToken,
        flowAction: built.flowAction,
        flowMessageVersion: built.flowMessageVersion,
        mode: built.modeDraftOrPublished,
      },
    },
  }
}

/**
 * Se o turno ia enviar M5 de funil e o preparador devolve Flow, substitui.
 * Eco Sim/Corrigir e falha do preparador → mantém M5 / texto.
 */
export async function maybeReplaceM5WithFlow(input: {
  choice: ChoiceInteractive | null | undefined
  replyBody: string
  prepare: PrepareBookingFlowOffer | null | undefined
  tenantId: string
  conversationId: string
  catalogVersion: string
  session?: FlowBookingSnapshot
  deferred?: DeferredBookingFrame
}): Promise<{
  interactive: SendOutboundInteractiveInput | null
  body: string
  usedFlow: boolean
}> {
  const m5 = toSendInteractive(input.choice ?? null)
  if (!input.prepare || !isM5FunnelChoiceInteractive(input.choice)) {
    return { interactive: m5, body: input.replyBody, usedFlow: false }
  }
  try {
    const offered = await input.prepare({
      tenantId: input.tenantId,
      conversationId: input.conversationId,
      catalogVersion: input.catalogVersion,
      session: input.session,
    })
    if (!offered) return { interactive: m5, body: input.replyBody, usedFlow: false }
    clearM5PendingOnDeferred(input.deferred)
    return {
      interactive: offered.interactive,
      body: offered.body,
      usedFlow: true,
    }
  } catch (err) {
    console.warn(
      JSON.stringify({
        level: 'warn',
        event: 'whatsapp_flow.offer_failed',
        tenantId: input.tenantId,
        error: err instanceof Error ? err.message : 'unknown',
      }),
    )
    return { interactive: m5, body: input.replyBody, usedFlow: false }
  }
}
