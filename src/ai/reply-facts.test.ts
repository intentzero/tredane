/**
 * #403 (CF-01, DEC-104) — validador factual do texto do modelo. Dados fictícios.
 * Casos da matriz: I-07 (reserva afirmada), I-08 (preço/hora inventados), J-08 (fora do período).
 */
import { describe, expect, it } from 'vitest'
import { allowedPricesCents, claimsBooking, pricesInText, timesInText, validateReplyFacts } from './reply-facts'
import type { AiContextPayload } from './types'

/** Quinta 05/11/2026 (cenário de referência da matriz). */
function ctx(over: Partial<AiContextPayload> = {}, lastInbound = 'Tem limpeza amanhã?'): AiContextPayload {
  return {
    contactFirstName: 'Carla',
    stage: null,
    services: [
      { name: 'Limpeza de pele', durationMinutes: 60, priceCents: 18000, clientExplanation: null, audiencia: 'qualquer' },
      {
        name: 'Depilação',
        durationMinutes: 15,
        priceCents: null,
        clientExplanation: null,
        audiencia: 'qualquer',
        zones: [
          { name: 'Axila', durationMinutes: 15, priceCents: 4000, audience: 'feminino' },
          { name: 'Pernas', durationMinutes: 30, priceCents: 12000, audience: 'feminino' },
        ],
        combos: [{ name: 'Completo', zoneNames: ['Axila', 'Pernas'], priceCents: 14500 }],
      },
      { name: 'Microagulhamento', durationMinutes: 60, priceCents: null, clientExplanation: null, audiencia: 'qualquer' },
    ],
    messages: [{ direction: 'inbound', body: lastInbound }],
    hasClinicOutbound: false,
    clinicOutboundCount: 0,
    clinic: {
      name: 'Clínica Aurora',
      address: 'Rua Exemplo, 100',
      timezone: 'America/Sao_Paulo',
      nowLabel: 'quinta-feira, 05/11/2026 10:00',
      today: '2026-11-05',
      openingHours: ['segunda a sexta: 09:00–12:00 e 13:00–18:00'],
      freeSlots: [
        { serviceName: 'Limpeza de pele', date: '2026-11-06', dayLabel: 'amanhã, sexta-feira 06/11', times: ['09:00', '10:00', '14:00', '15:00'] },
        { serviceName: 'Limpeza de pele', date: '2026-11-09', dayLabel: 'segunda-feira 09/11', times: ['13:00'] },
        { serviceName: 'Depilação', date: '2026-11-06', dayLabel: 'amanhã, sexta-feira 06/11', times: ['11:00'] },
      ],
      upcomingAppointments: [],
      reschedulePolicy: null,
      cancellationPolicy: null,
    },
    ...over,
  }
}

describe('afirmações de reserva (I-07)', () => {
  it.each([
    'Pronto, já garanti sua vaga às 15h.',
    'Tudo certo, te espero amanhã às 15h!',
    'Sua vaga está garantida 😊',
    'Está tudo certo para sexta às 10:00.',
    'Já está na agenda!',
    'Confirmado para amanhã às 14:00.',
    'Reservado pra você, Carla!',
    'Nos vemos sexta!',
  ])('«%s» é recusado', (m) => {
    expect(claimsBooking(m)).toBe(true)
  })

  it.each([
    'Quer que fique marcado para sexta às 10:00?',
    'Tenho sexta às 10:00 ou 14:00. Qual fica melhor?',
    'Assim que você tocar em Confirmar, o horário fica garantido?',
    'A equipe confirma o valor do microagulhamento.',
    'Tudo certo! Qual dia fica melhor pra você?',
  ])('«%s» passa', (m) => {
    expect(claimsBooking(m)).toBe(false)
  })
})

describe('preços (I-08)', () => {
  it('lê R$ com milhar, sem centavos e «reais»', () => {
    expect(pricesInText('R$ 1.200,00, R$180 e 40 reais')).toEqual([120000, 18000, 4000])
  })

  it('aceita linha, variante, soma de variantes e combo', () => {
    const allowed = allowedPricesCents(ctx().services)
    for (const cents of [18000, 4000, 12000, 16000, 14500]) expect(allowed.has(cents)).toBe(true)
    expect(allowed.has(5000)).toBe(false)
  })

  it.each([
    ['A limpeza de pele custa R$ 180,00 e dura 60 min.', true],
    ['Axila e pernas juntas ficam R$ 160,00.', true],
    ['O combo completo sai por R$ 145,00.', true],
    ['A limpeza custa R$ 50,00.', false],
    ['O microagulhamento custa R$ 300,00.', false],
  ] as const)('«%s» → ok=%s', (m, ok) => {
    expect(validateReplyFacts(m, ctx()).ok).toBe(ok)
  })
})

describe('horários (I-08, J-08)', () => {
  it('«dura 1h» não é horário', () => {
    expect(timesInText('A sessão dura 1h e custa R$ 180,00.')).toEqual([])
    expect(timesInText('Tenho 9:00, 10h30 e 14h.').map((h) => h.time)).toEqual(['09:00', '10:30', '14:00'])
  })

  it.each([
    ['Amanhã tenho 09:00, 10:00 ou 14:00. Qual prefere?', true],
    ['Na sexta (06/11) tenho 14:00 ou 15:00.', true],
    ['Na segunda tenho 13:00.', true],
    ['Tenho 23:00 amanhã.', false],
    ['Na segunda tenho 09:00.', false],
    ['Dia 20/11 tenho 10:00.', false],
    ['Funcionamos das 09:00 às 18:00.', true],
  ] as const)('«%s» → ok=%s', (m, ok) => {
    expect(validateReplyFacts(m, ctx()).ok).toBe(ok)
  })

  it('restringe ao serviço citado: 11:00 é da depilação, não da limpeza', () => {
    expect(validateReplyFacts('Para limpeza de pele, amanhã tenho 11:00.', ctx()).ok).toBe(false)
    expect(validateReplyFacts('Para depilação, amanhã tenho 11:00.', ctx()).ok).toBe(true)
  })

  it('pode repetir a hora que a cliente pediu, mesmo ocupada', () => {
    const c = ctx({}, 'Limpeza amanhã às 16h?')
    expect(validateReplyFacts('Às 16:00 já não tenho. Tenho 15:00, serve?', c).ok).toBe(true)
  })

  it('«às 3 da tarde» e «meio-dia» da cliente contam como repetíveis', () => {
    expect(validateReplyFacts('Às 15:00 não tenho.', ctx({}, 'pode ser às 3 da tarde?')).ok).toBe(true)
    expect(validateReplyFacts('Ao meio-dia, 12:00, estamos fechados.', ctx({}, 'tem ao meio-dia?')).ok).toBe(true)
  })

  it('J-08: pediu manhã e o modelo oferece a tarde com manhã livre nesse dia', () => {
    const c = ctx({}, 'Limpeza amanhã de manhã')
    const r = validateReplyFacts('Amanhã tenho 14:00 ou 15:00.', c)
    expect(r).toEqual({ ok: false, violation: 'time_outside_period' })
    expect(validateReplyFacts('Amanhã de manhã tenho 09:00 ou 10:00.', c).ok).toBe(true)
  })

  it('sem manhã livre no dia, a hora mais próxima de outro período é aceite', () => {
    const c = ctx({}, 'Limpeza segunda de manhã')
    expect(validateReplyFacts('Segunda de manhã não tenho; tenho 13:00.', c).ok).toBe(true)
  })

  it('sem contexto da clínica (resumo/teste), só reserva e preço são verificados', () => {
    expect(validateReplyFacts('Tenho 23:00.', ctx({ clinic: undefined })).ok).toBe(true)
  })
})
