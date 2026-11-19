import { describe, expect, it } from 'vitest'
import { renderProposalResultBody, WEB_RECEIPT_SENTENCE } from './render'
import type { AppointmentProposalRow } from './types'

const base: AppointmentProposalRow = {
  id: 'prop-test',
  tenantId: 'clinic',
  version: 1,
  contactId: 'ctc',
  conversationId: 'cnv',
  serviceId: 'svc',
  serviceName: 'Depilação',
  professionalId: 'pro',
  professionalName: 'Profissional Teste',
  startsAt: Date.UTC(2026, 10, 19, 19, 0),
  endsAt: Date.UTC(2026, 10, 19, 20, 0),
  durationMinutes: 60,
  timezone: 'America/Sao_Paulo',
  priceCents: 47_000,
  clinicLocationText: '',
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

describe('renderProposalResultBody booked — preços (P25)', () => {
  it('inclui valores por zona e total do catálogo na confirmação', () => {
    const body = renderProposalResultBody(base, 'booked', {
      webReceipt: true,
      zones: [
        { name: 'axila', audience: 'ambos', durationMinutes: 15, priceCents: 5_000 },
        { name: 'pernas', audience: 'ambos', durationMinutes: 30, priceCents: 14_000 },
      ],
    })
    expect(body).toMatch(/Valores: axila R\$ 50,00; pernas R\$ 140,00/)
    expect(body).toMatch(/Total: R\$ 470,00/)
    expect(body).toContain(WEB_RECEIPT_SENTENCE)
  })

  it('omite preço quando não há valor no cadastro', () => {
    const body = renderProposalResultBody(
      { ...base, priceCents: null },
      'booked',
      {
        zones: [{ name: 'axila', audience: 'ambos', durationMinutes: 15, priceCents: null }],
      },
    )
    expect(body).not.toMatch(/Valores:|Total:/)
  })
})