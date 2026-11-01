/**
 * #405 / CF-16 / INV-05 / CF-12: copy sem jargão e corte de cumprimento.
 * Dados fictícios.
 */
import { describe, expect, it } from 'vitest'
import { stripLeadingGreeting } from '../../ai/continuity'
import {
  TEMPO_REFUSED_PHRASE,
  TEMPO_UNCONFIRMED_PHRASE,
  renderProposalInteractive,
  renderProposalResultBody,
} from '../proposals/render'
import type { AppointmentProposalRow } from '../proposals/types'
import { askZonesReply } from './autobook'
import {
  DEFAULT_OPTION_KIND_PLURAL,
  FORBIDDEN_CLIENT_TERM_PATTERNS,
  MIXED_AUDIENCE_REPLY,
  SERVICE_CHANGED_REPLY,
  SERVICE_NOT_FOUND_REPLY,
  forbiddenClientTermsIn,
  teamConfirmsSoonReply,
} from './client-copy'
import { AI_TRANSPARENCY_TEXT, HUMAN_HANDOFF_TEXT } from './human-handoff'
import { MODEL_FALLBACK_TEXT } from './model-fallback'
import { audienceLineQuestion, variantListQuestion } from './variant-line'

function sampleProposal(): AppointmentProposalRow {
  return {
    id: 'prop_test',
    tenantId: 't1',
    contactId: 'c1',
    conversationId: 'cnv1',
    serviceId: 'svc1',
    serviceName: 'Massagem',
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
    clinicLocationText: 'Rua Fictícia, 10',
    version: 1,
    state: 'enviada',
    beneficiaryKind: 'titular',
    replacesAppointmentId: null,
    createdAt: 0,
    updatedAt: 0,
  } as unknown as AppointmentProposalRow
}

function scan(label: string, text: string) {
  const hits = forbiddenClientTermsIn(text)
  expect(hits, `${label}: ${text}`).toEqual([])
}

describe('#405 copy sem jargão (J-09, INV-05)', () => {
  it('lista de termos proibidos detecta os exemplos CF-16', () => {
    expect(forbiddenClientTermsIn('A equipe confirma pelo Agendar.')).toContain('Agendar')
    expect(forbiddenClientTermsIn('O catálogo mudou.')).toContain('catálogo')
    expect(forbiddenClientTermsIn('ambos combina com os dois')).toContain('ambos')
    expect(forbiddenClientTermsIn('escolha a variante')).toContain('variante')
    expect(forbiddenClientTermsIn('qual linha você quer')).toContain('linha')
    expect(forbiddenClientTermsIn('sala 2')).toContain('sala')
    expect(forbiddenClientTermsIn('mais 15 min de buffer')).toContain('buffer')
    expect(forbiddenClientTermsIn('id svc_abc123')).toContain('ids')
  })

  it('frases determinísticas à cliente passam no filtro', () => {
    const proposal = sampleProposal()
    const interactive = renderProposalInteractive(proposal)
    const phrases: Array<[string, string]> = [
      ['MIXED_AUDIENCE_REPLY', MIXED_AUDIENCE_REPLY],
      ['SERVICE_NOT_FOUND_REPLY', SERVICE_NOT_FOUND_REPLY],
      ['SERVICE_CHANGED_REPLY', SERVICE_CHANGED_REPLY],
      ['teamConfirmsSoonReply', teamConfirmsSoonReply('Massagem', '15:00')],
      ['HUMAN_HANDOFF_TEXT', HUMAN_HANDOFF_TEXT],
      [
        'HUMAN_HANDOFF_TEXT DEC-113',
        `${HUMAN_HANDOFF_TEXT} A equipe responde a partir de segunda às 09:00.`,
      ],
      ['AI_TRANSPARENCY_TEXT', AI_TRANSPARENCY_TEXT],
      ['MODEL_FALLBACK_TEXT', MODEL_FALLBACK_TEXT],
      ['TEMPO_REFUSED_PHRASE', TEMPO_REFUSED_PHRASE],
      ['TEMPO_UNCONFIRMED_PHRASE', TEMPO_UNCONFIRMED_PHRASE],
      ['audienceLineQuestion', audienceLineQuestion('Depilação')],
      [
        'variantListQuestion',
        variantListQuestion('Depilação', 'zonas', [
          { id: 'z1', name: 'Axila', audience: 'feminino', durationMinutes: 15, priceCents: 5000 },
        ]),
      ],
      ['askZonesReply', askZonesReply(`as ${DEFAULT_OPTION_KIND_PLURAL}`, ['Axila', 'Buço'], '14:00')],
      ['askZonesReply zonas', askZonesReply('as zonas', ['Axila'], '10:00')],
      ['proposal body', interactive.body],
      ['proposal booked', renderProposalResultBody(proposal, 'booked')],
      ['proposal expired', renderProposalResultBody(proposal, 'expired')],
      ['proposal slot_refused', renderProposalResultBody(proposal, 'slot_refused')],
    ]
    for (const [label, text] of phrases) scan(label, text)
  })

  it('DEFAULT_OPTION_KIND_PLURAL não é jargão', () => {
    expect(DEFAULT_OPTION_KIND_PLURAL).toBe('opções')
    scan('default kind', DEFAULT_OPTION_KIND_PLURAL)
  })

  it('FORBIDDEN_CLIENT_TERM_PATTERNS cobre INV-05', () => {
    const ids = FORBIDDEN_CLIENT_TERM_PATTERNS.map((p) => p.id)
    for (const need of [
      'sala',
      'intervalo',
      'buffer',
      'Agendar',
      'catálogo',
      'linha',
      'variante',
      'ambos',
      'ids',
    ]) {
      expect(ids).toContain(need)
    }
  })
})

describe('#405 corte de cumprimento (J-04, CF-12)', () => {
  it.each([
    ['Oi Carla, tenho 15:00 amanhã', 'Tenho 15:00 amanhã'],
    ['Oi, Carla, tenho 15:00 amanhã', 'Tenho 15:00 amanhã'],
    ['Olá Ana! posso marcar?', 'Posso marcar?'],
    ['Oi Paulo, 😊 tudo bem?', 'Tudo bem?'],
    ['Bom dia, Maria. Horário às 10.', 'Horário às 10.'],
  ])('stripLeadingGreeting(%j) → %j', (input, expected) => {
    expect(stripLeadingGreeting(input)).toBe(expected)
  })
})
