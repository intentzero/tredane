/**
 * Pagamento / parcelamento — resposta determinística (baseline P20, 16/11/2026).
 * Com FAQ cadastrada responde; sem cadastro avisa a equipe; repetição não ecoa a mesma frase.
 */
import type { Clock } from '../../db/clock'
import type { ClinicDb } from '../store'
import { foldKnowledgeText } from '../config/knowledge'
import type { ClinicKnowledgeHit } from './clinic-knowledge-reply'
import { PAYMENT_METHOD_REPLY } from './client-copy'
import { humanTeamOfferButtons } from './human-handoff'
import { lastOutboundBody, normalizeOutboundForCompare } from './turn-misunderstanding'
import type { ChoiceInteractive } from './choice-offer'

export const PAYMENT_METHOD_REPLY_REPEAT =
  'Ainda estou aguardando a equipe confirmar cartão e parcelamento. Se preferir, toque em Falar com a equipe.'

export function isPaymentKnowledgeHit(hit: ClinicKnowledgeHit): boolean {
  const blob = foldKnowledgeText(
    [hit.entry.categoryName, hit.entry.question, ...hit.entry.matchCues].join(' '),
  )
  return /\b(cart[aã]o|parcel|pagamento|credito|debito|pix|boleto)\b/.test(blob)
}

export function outboundWasPaymentDeferral(body: string): boolean {
  const folded = normalizeOutboundForCompare(body)
  return (
    folded === normalizeOutboundForCompare(PAYMENT_METHOD_REPLY) ||
    folded === normalizeOutboundForCompare(PAYMENT_METHOD_REPLY_REPEAT)
  )
}

export function paymentAskIsRepeat(
  db: ClinicDb,
  tenantId: string,
  conversationId: string,
): boolean {
  const prior = lastOutboundBody(db, tenantId, conversationId)
  if (!prior) return false
  const lead = prior.split('\n')[0]?.trim() ?? ''
  return outboundWasPaymentDeferral(lead)
}

export function buildPaymentDeferralReply(isRepeat: boolean): string {
  return isRepeat ? PAYMENT_METHOD_REPLY_REPEAT : PAYMENT_METHOD_REPLY
}

export function paymentDeferralInteractive(
  db: ClinicDb,
  tenantId: string,
  clock: Clock,
  isRepeat: boolean,
): ChoiceInteractive | null {
  if (!isRepeat) return null
  const buttons = humanTeamOfferButtons(db, tenantId, clock)
  return buttons.length > 0 ? { mode: 'buttons', buttons } : null
}