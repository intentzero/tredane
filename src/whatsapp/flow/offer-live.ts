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
 *
 * Exceção: a oferta de horários. O corpo da mensagem continua a listar as horas e a perguntar
 * «Qual fica melhor?», por isso a cliente responde por texto («14»). Sem o pending e o lastOffer,
 * a resposta não tinha a que se ligar e o bot voltava a oferecer outras horas (sonda com o segundo
 * telefone, 07/11/2026). O fecho do Flow (nfm_reply) limpa os dois ao gravar o quadro.
 */
export function clearM5PendingOnDeferred(deferred: DeferredBookingFrame | undefined): void {
  if (!deferred) return
  if (deferred.pendingSlot === 'horario') return
  deferred.saveFrame({ pending: null, lastOffer: null })
}

type BindingRow = {
  id: string
  phone_number_id: string
  waba_id: string
  status: string
}

/** Motivo de o Flow não ser enviado e o turno voltar ao M5 (DEC-143, medida c). */
export type FlowOfferSkipReason = 'not_configured' | 'no_active_binding' | 'build_failed'

/** Log sem texto da conversa: só tenant e motivo. */
function logFlowOfferSkipped(tenantId: string, reason: FlowOfferSkipReason): void {
  console.warn(
    JSON.stringify({
      level: 'warn',
      event: 'whatsapp_flow.offer_skipped',
      tenantId,
      reason,
    }),
  )
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
  if (!isWhatsappFlowConfigured(input.env)) {
    logFlowOfferSkipped(input.tenantId, 'not_configured')
    return null
  }

  const row = await input.env.DB.prepare(
    `SELECT id, phone_number_id, waba_id, status
     FROM whatsapp_phone_bindings
     WHERE tenant_id = ? AND status = 'active'
     LIMIT 1`,
  )
    .bind(input.tenantId)
    .first<BindingRow>()
  if (!row) {
    logFlowOfferSkipped(input.tenantId, 'no_active_binding')
    return null
  }

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
  if (!built) {
    logFlowOfferSkipped(input.tenantId, 'build_failed')
    return null
  }

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
 * O passo do funil fica com o texto e o interativo que já calculou.
 *
 * Paulo, 07/11/2026: o CTA «Abrir opções» só sai na abertura vaga, com o
 * quadro sem pedido (`shouldAttachHubOpeningCta`). Colá-lo numa pergunta de
 * linha, variantes, zona desconhecida ou horários punha duas perguntas na
 * mesma mensagem. O corpo determinístico não volta ao C1h (CF-35).
 * Eco Sim/Corrigir continua a ser o eco.
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
  // O preparador existe para a abertura do hub. Aqui o passo já é um pedido
  // (escolha M5) ou o quadro já tem serviço: não se abre token nem se troca
  // o interativo. `prepare` fica na assinatura para os callers não mudarem.
  void input.prepare
  return { interactive: m5, body: input.replyBody, usedFlow: false }
}
