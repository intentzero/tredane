/**
 * Deteção determinística (sem LLM) para red-line e misunderstanding.
 */
import { textPromisesTeamFollowUp } from '../clinic/ai/promise-team-follow-up'
import type { FalseConfirmationSignal } from './types'

export function detectFalseConfirmationSignals(text: string): FalseConfirmationSignal[] {
  const folded = text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .trim()
  if (!folded) return []
  const out: FalseConfirmationSignal[] = []
  if (textPromisesTeamFollowUp(text)) out.push('team_will_confirm')
  if (
    /^agendado\b/.test(folded) ||
    /\best[aá] marcad[oa]\b/.test(folded) ||
    /\bconfirmad[oa] o hor[aá]rio\b/.test(folded) ||
    /\bdeixei (sua|o) (solicita[cç][aã]o|pedido).*(equipe|confirmar)/.test(folded)
  ) {
    out.push('claimed_booked')
  }
  return out
}

export function outboundLooksLikeMisunderstanding(text: string): boolean {
  const folded = text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .trim()
  if (!folded) return false
  if (/\bn[aã]o (entendi|consegui entender)\b/.test(folded)) return true
  if (/\bquer ver as op[cç][oõ]es\b/.test(folded) && /\bn[aã]o entendi\b/.test(folded)) return true
  return false
}

export function normalizeOutboundForRepeatCheck(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}