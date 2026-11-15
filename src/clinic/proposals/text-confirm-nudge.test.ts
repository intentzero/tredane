import { describe, expect, it } from 'vitest'
import {
  PROPOSAL_CONFIRM_NUDGE_LEAD,
  isProposalAffirmativeText,
  shouldReofferProposalOnAffirmText,
} from './text-confirm-nudge'
import type { AppointmentProposalRow } from './types'

function openProposal(): AppointmentProposalRow {
  return {
    id: 'prop_nudge',
    tenantId: 't1',
    contactId: 'c1',
    conversationId: 'cnv1',
    serviceId: 'svc1',
    serviceName: 'Drenagem linfática',
    professionalId: 'p1',
    professionalName: 'Gi',
    startsAt: Date.UTC(2026, 10, 18, 16, 0),
    endsAt: Date.UTC(2026, 10, 18, 16, 45),
    durationMinutes: 45,
    timezone: 'America/Sao_Paulo',
    priceCents: 16000,
    requiresSignal: false,
    signalKind: null,
    signalFixedCents: null,
    signalPercent: null,
    signalConditionsText: '',
    clinicLocationText: '',
    version: 1,
    state: 'enviada',
    beneficiaryKind: 'titular',
    replacesAppointmentId: null,
    createdAt: 0,
    updatedAt: 0,
    confirmSuspended: false,
  } as unknown as AppointmentProposalRow
}

describe('text-confirm-nudge (baseline 15/11 P1)', () => {
  it.each([
    'sim',
    'ok 👍',
    'fechado, confirmo',
    'isso pode confirmar',
    'confirmar',
    'pode marcar',
    'sim pode marcar. obrigada',
  ])('isProposalAffirmativeText(%j) = true', (text) => {
    expect(isProposalAffirmativeText(text)).toBe(true)
  })

  it.each(['quero remarcar', 'na verdade prefiro massagem', 'tem horário amanhã?'])(
    'isProposalAffirmativeText(%j) = false',
    (text) => {
      expect(isProposalAffirmativeText(text)).toBe(false)
    },
  )

  it('shouldReofferProposalOnAffirmText com proposta enviada', () => {
    const open = openProposal()
    expect(
      shouldReofferProposalOnAffirmText({
        open,
        turnText: 'sim',
        tz: 'America/Sao_Paulo',
      }),
    ).toBe(true)
    expect(
      shouldReofferProposalOnAffirmText({
        open: { ...open, confirmSuspended: true },
        turnText: 'sim',
        tz: 'America/Sao_Paulo',
      }),
    ).toBe(false)
  })

  it('nudge copy natural PT-BR', () => {
    expect(PROPOSAL_CONFIRM_NUDGE_LEAD).toMatch(/Confirmar/)
    expect(PROPOSAL_CONFIRM_NUDGE_LEAD).not.toMatch(/equipe validar|Não consigo confirmar/i)
  })
})