import { describe, expect, it } from 'vitest'
import { renderProposalResultBody, WEB_RECEIPT_SENTENCE } from './render'
import type { AppointmentProposalRow } from './types'

const tz = 'America/Sao_Paulo'
/** sábado 21/11/2026 09:00 America/Sao_Paulo = 12:00 UTC */
const startsOld = Date.UTC(2026, 10, 21, 12, 0)
/** sábado 21/11/2026 09:30 America/Sao_Paulo = 12:30 UTC */
const startsNew = Date.UTC(2026, 10, 21, 12, 30)

const base: AppointmentProposalRow = {
  id: 'prop-remarca',
  tenantId: 'clinic',
  version: 1,
  contactId: 'ctc',
  conversationId: 'cnv',
  serviceId: 'svc',
  serviceName: 'Massagem',
  professionalId: 'pro',
  professionalName: 'Ana',
  startsAt: startsNew,
  endsAt: startsNew + 105 * 60_000,
  durationMinutes: 105,
  timezone: tz,
  priceCents: null,
  clinicLocationText: '',
  requiresSignal: false,
  signalKind: null,
  signalFixedCents: null,
  signalPercent: null,
  signalConditionsText: '',
  replacesAppointmentId: 'apt-old',
  appointmentId: 'apt-old',
  resultKind: null,
  resultOutboundId: null,
} as AppointmentProposalRow

describe('renderProposalResultBody booked — Remarcado (TRE-93)', () => {
  it('mostra horário antigo e novo distintos', () => {
    const body = renderProposalResultBody(base, 'booked', {
      replacedStartsAt: startsOld,
      webReceipt: true,
    })
    expect(body).toMatch(
      /^Remarcado: de sábado 21\/11 às 09:00 para sábado 21\/11 às 09:30\./,
    )
    expect(body).toContain(WEB_RECEIPT_SENTENCE)
    expect(body).not.toMatch(/^Agendado:/)
  })

  it('não alega remarcação quando o snapshot civil é idêntico ao novo', () => {
    const body = renderProposalResultBody(base, 'booked', {
      replacedStartsAt: startsNew,
      webReceipt: true,
    })
    expect(body).toMatch(/^Agendado: Massagem · sábado 21\/11 às 09:30/)
    expect(body).not.toMatch(/Remarcado:/)
  })

  it('sem replacedStartsAt cai em Agendado mesmo com replacesAppointmentId', () => {
    const body = renderProposalResultBody(base, 'booked', { webReceipt: true })
    expect(body).toMatch(/^Agendado:/)
    expect(body).not.toMatch(/Remarcado:/)
  })
})
