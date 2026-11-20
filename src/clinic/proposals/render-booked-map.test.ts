import { describe, expect, it } from 'vitest'
import { OPEN_MAP_CTA_TEXT } from '../ai/location-map-offer'
import {
  proposalBookedMapUrl,
  renderProposalResultBody,
  WEB_RECEIPT_SENTENCE,
} from './render'
import type { AppointmentProposalRow } from './types'

const base: AppointmentProposalRow = {
  id: 'prop-map',
  tenantId: 'clinic',
  version: 1,
  contactId: 'ctc',
  conversationId: 'cnv',
  serviceId: 'svc',
  serviceName: 'Bronzeamento',
  professionalId: 'pro',
  professionalName: 'Gi',
  startsAt: Date.UTC(2026, 10, 21, 12, 0),
  endsAt: Date.UTC(2026, 10, 21, 13, 0),
  durationMinutes: 60,
  timezone: 'America/Sao_Paulo',
  priceCents: 15_000,
  clinicLocationText: 'https://maps.google.com/maps/place//data=!4m2!3m1!1s0x935a2157b94ee915:0x8a0ae25f874c7f15',
  requiresSignal: false,
  signalKind: null,
  signalFixedCents: null,
  signalPercent: null,
  signalConditionsText: '',
  replacesAppointmentId: null,
  appointmentId: null,
  resultKind: null,
  resultOutboundId: null,
} as AppointmentProposalRow

describe('Agendado — Local via CTA Abrir mapa (DEC-211 opção B)', () => {
  it('corpo do page-booked sem URL; proposalBookedMapUrl devolve o link', () => {
    const body = renderProposalResultBody(base, 'booked', { webReceipt: true })
    expect(body).toMatch(/^Agendado: Bronzeamento ·/)
    expect(body).toContain(WEB_RECEIPT_SENTENCE)
    expect(body).not.toMatch(/Local:|https:\/\/maps/i)
    expect(proposalBookedMapUrl(base)).toBe(base.clinicLocationText)
    expect(OPEN_MAP_CTA_TEXT.length).toBeLessThanOrEqual(20)
  })

  it('morada legada em texto não vira CTA', () => {
    const legacy = { ...base, clinicLocationText: 'Rua Fictícia, 10' }
    expect(proposalBookedMapUrl(legacy)).toBeNull()
    expect(renderProposalResultBody(legacy, 'booked')).not.toMatch(/Local:/)
  })

  it('sem localização: sem Local e sem map URL', () => {
    const bare = { ...base, clinicLocationText: '' }
    expect(proposalBookedMapUrl(bare)).toBeNull()
    expect(renderProposalResultBody(bare, 'booked')).not.toMatch(/Local:/)
  })
})
