/**
 * Queixa de que o bot não responde (baseline P21, 16/11/2026).
 * Desculpa curta, resposta pendente se houver (preço), botão equipe — sem reoferta de horários.
 */
import type { Clock } from '../../db/clock'
import type { ServiceRow } from '../config/types'
import type { ClinicDb } from '../store'
import { formatBRL } from '../../ai/prompt'
import { realizeAskInfo } from './ask-info-realize'
import { isCatalogInfoAsk } from './booking-intent-text'
import { humanTeamOfferButtons } from './human-handoff'
import { wantsHumanText } from './nlu/sensitive'
import type { BookingFrame } from './schedule-session'
import { heldAudienceLine } from './schedule-session'
import { needsAudienceLine, zonesForAudienceLine } from './variant-line'
import type { ChoiceInteractive } from './choice-offer'

const BOT_NOT_ANSWERING_RE =
  /\b(?:v[cç]|voc[eê])\s+n[aã]o\s+(?:responde|entende)\b|\bn[aã]o\s+responde\s+(?:o\s+)?(?:que|o\s+que)\s+eu\s+pergunto\b/i

export const CLIENT_FRUSTRATION_APOLOGY = 'Desculpe, entendi mal o seu pedido.'

export function isClientNotAnsweredComplaint(text: string): boolean {
  if (!text.trim() || wantsHumanText(text)) return false
  return BOT_NOT_ANSWERING_RE.test(text.trim())
}

export function clientAskedPriceRecently(inboundBodies: readonly string[]): boolean {
  return inboundBodies.some((b) => isCatalogInfoAsk(b))
}

export function buildFrustrationRecoveryReply(input: {
  conversationId: string
  turnText: string
  inboundBodies: readonly string[]
  service: ServiceRow | null
  frame: BookingFrame | null
  db: ClinicDb
  tenantId: string
  clock: Clock
}): { replyText: string; interactive: ChoiceInteractive | null } | null {
  if (!isClientNotAnsweredComplaint(input.turnText)) return null
  const parts: string[] = [CLIENT_FRUSTRATION_APOLOGY]
  const svc = input.service
  const frame = input.frame
  if (svc && frame?.serviceId === svc.id && clientAskedPriceRecently(input.inboundBodies)) {
    const line = heldAudienceLine(frame) ?? frame.line ?? null
    const active = svc.zones.filter((z) => z.active)
    const pool =
      needsAudienceLine(active) && line ? zonesForAudienceLine(active, line) : active
    const zones = pool.length > 0 ? pool : active
    const quote = realizeAskInfo({
      conversationId: input.conversationId,
      topic: 'price',
      service: svc,
      zones,
      frame,
      sameFunnel: true,
      deferSlotResume: true,
    })
    if (quote?.replyText.trim()) {
      parts.push(quote.replyText.trim())
    } else if (svc.priceCents != null) {
      parts.push(
        `${svc.name} custa ${formatBRL(svc.priceCents)} e dura ${svc.durationMinutes} min.`,
      )
    }
  }
  const buttons = humanTeamOfferButtons(input.db, input.tenantId, input.clock)
  if (buttons.length > 0) {
    parts.push('Se quiser, toque em Falar com a equipe.')
  }
  return {
    replyText: parts.join('\n'),
    interactive: buttons.length > 0 ? { mode: 'buttons', buttons } : null,
  }
}