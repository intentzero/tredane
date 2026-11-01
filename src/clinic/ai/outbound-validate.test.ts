/**
 * #414 validador único (núcleo §3.6) — INV-04/05/11 + forma J-07 + factos #403.
 */
import { describe, expect, it } from 'vitest'
import type { AiContextPayload } from '../../ai/types'
import { countParagraphs, countQuestions, validateClientOutbound } from './outbound-validate'

function ctx(over: Partial<AiContextPayload> = {}): AiContextPayload {
  return {
    contactFirstName: 'Carla',
    stage: null,
    services: [
      {
        name: 'Limpeza de pele',
        durationMinutes: 60,
        priceCents: 18000,
        clientExplanation: null,
        audiencia: 'qualquer',
      },
    ],
    messages: [{ direction: 'inbound', body: 'Quanto custa a limpeza?' }],
    hasClinicOutbound: false,
    clinicOutboundCount: 0,
    clinic: {
      name: 'Clínica Aurora',
      address: 'Rua Fictícia, 10',
      timezone: 'America/Sao_Paulo',
      nowLabel: 'sexta-feira, 06/11/2026 10:00',
      today: '2026-11-06',
      openingHours: ['segunda a sexta: 09:00–18:00'],
      freeSlots: [
        {
          serviceName: 'Limpeza de pele',
          date: '2026-11-07',
          dayLabel: 'amanhã, sábado 07/11',
          times: ['09:00', '10:00', '14:00'],
        },
      ],
      upcomingAppointments: [],
      reschedulePolicy: null,
      cancellationPolicy: null,
    },
    ...over,
  }
}

describe('#414 validateClientOutbound', () => {
  it('aceita frase determinística limpa', () => {
    expect(
      validateClientOutbound('R$ 180,00, 60 min. Quer que eu veja horários?', {
        source: 'phrase',
        context: ctx(),
      }),
    ).toEqual({ ok: true })
  })

  it('rejeita jargão INV-05', () => {
    const r = validateClientOutbound('A equipe confirma pelo Agendar.', { source: 'phrase' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('forbidden_terms')
  })

  it('rejeita afirmação de reserva INV-04', () => {
    const r = validateClientOutbound('Já garanti sua vaga para amanhã.', { source: 'llm' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('claims_booking')
  })

  it('rejeita markdown / JSON (INV-11)', () => {
    expect(validateClientOutbound('```json\n{}\n```', { source: 'llm' }).ok).toBe(false)
    expect(validateClientOutbound('{"mensagem":"oi"}', { source: 'llm' }).ok).toBe(false)
  })

  it('J-07: LLM com mais de uma pergunta ou >300 chars', () => {
    const two = validateClientOutbound('Qual dia? Qual horário?', { source: 'llm' })
    expect(two.ok).toBe(false)
    if (!two.ok) expect(two.reason).toBe('too_many_questions')

    const long = validateClientOutbound('x'.repeat(301), {
      source: 'llm',
      requireSingleQuestion: false,
    })
    expect(long.ok).toBe(false)
    if (!long.ok) expect(long.reason).toBe('too_long')
  })

  it('conta perguntas e parágrafos', () => {
    expect(countQuestions('Qual fica melhor?')).toBe(1)
    expect(countQuestions('Ok.')).toBe(0)
    expect(countParagraphs('a\n\nb\n\nc')).toBe(3)
  })

  it('com contexto, preço fora do catálogo falha (INV-02 / #403)', () => {
    const r = validateClientOutbound('A limpeza custa R$ 50,00.', {
      source: 'llm',
      context: ctx(),
      requireSingleQuestion: false,
    })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.reason).toBe('factual_mismatch')
      expect(r.detail).toBe('price_not_in_catalog')
    }
  })

  it('com contexto, hora inventada falha (INV-03 / #403)', () => {
    const r = validateClientOutbound('Para limpeza de pele, amanhã tenho 23:00.', {
      source: 'llm',
      context: ctx(),
      requireSingleQuestion: false,
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('factual_mismatch')
  })
})
