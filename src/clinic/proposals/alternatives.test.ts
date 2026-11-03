/**
 * #511 — copy de validade e alternativas (unidade).
 * Dados fictícios. Relógio da clínica; sem IANA na copy.
 */
import { describe, expect, it } from 'vitest'
import { formatOfferedSlotsListing } from './alternatives'
import {
  proposalValidityLine,
  renderProposalInteractive,
  renderProposalResultBody,
} from './render'
import type { AppointmentProposalRow } from './types'

function sampleProposal(
  overrides: Partial<AppointmentProposalRow> = {},
): AppointmentProposalRow {
  return {
    id: 'prop_test',
    tenantId: 't1',
    contactId: 'c1',
    conversationId: 'cnv1',
    serviceId: 'svc1',
    serviceName: 'Limpeza de pele',
    professionalId: 'p1',
    professionalName: 'Gi',
    startsAt: Date.UTC(2026, 10, 6, 18, 0),
    endsAt: Date.UTC(2026, 10, 6, 19, 0),
    durationMinutes: 60,
    timezone: 'America/Sao_Paulo',
    priceCents: 15000,
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
    expiresAt: null,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  } as AppointmentProposalRow
}

describe('#511 validade visível e Confirmar expirado (copy)', () => {
  it('proposta mostra Válida até HH:MM no relógio da clínica, sem IANA', () => {
    const proposal = sampleProposal()
    const until = Date.UTC(2026, 10, 5, 16, 30) // 13:30 America/Sao_Paulo
    const body = renderProposalInteractive(proposal, undefined, {
      validUntilMs: until,
    }).body
    expect(body).toMatch(/Válida até 13:30\./)
    expect(body).not.toContain('America/')
    expect(body).not.toMatch(/\([A-Za-z]+\/[A-Za-z_]+\)/)
    expect(proposalValidityLine('America/Sao_Paulo', until)).toBe('Válida até 13:30.')
  })

  it('expirada com alternativas explica e lista horas; sem frase da equipe', () => {
    const body = renderProposalResultBody(sampleProposal(), 'expired', {
      alternativesListing: 'sexta 06/11 às 14:00, 16:00',
    })
    expect(body).toMatch(/já não está válida/i)
    expect(body).toMatch(/14:00/)
    expect(body).toMatch(/16:00/)
    expect(body).not.toMatch(/A equipe pode enviar uma nova proposta/i)
    expect(body).not.toContain('America/')
  })

  it('vaga perdida com alternativas oferece horas; sem «equipe envia»', () => {
    const body = renderProposalResultBody(sampleProposal(), 'slot_refused', {
      alternativesListing: 'sexta 06/11 às 14:00, 16:00',
    })
    expect(body).toMatch(/já não está livre/i)
    expect(body).toMatch(/14:00/)
    expect(body).toMatch(/16:00/)
    expect(body).not.toMatch(/A equipe envia outra opção/i)
  })

  it('formatOfferedSlotsListing junta dia e horas', () => {
    expect(
      formatOfferedSlotsListing([
        { date: '2026-11-06', time: '14:00', startsAt: 1 },
        { date: '2026-11-06', time: '16:00', startsAt: 2 },
      ]),
    ).toBe('sexta 06/11 às 14:00, 16:00')
  })
})
