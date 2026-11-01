import { describe, expect, it } from 'vitest'
import {
  durationMinutesFromText,
  listBookableOptions,
  resolveBookingObject,
} from './booking-object'
import { EVAL_BOOKING_CATALOG } from './evals/booking-object-catalog'

describe('booking-object', () => {
  it('normaliza opções com e sem variantes', () => {
    const options = listBookableOptions(EVAL_BOOKING_CATALOG)
    expect(options.some((o) => o.key === 'svc-limpeza' && !o.hasVariants)).toBe(true)
    expect(options.filter((o) => o.serviceId === 'svc-depilacao').length).toBe(6)
  })

  it('lê duração em linguagem natural', () => {
    expect(durationMinutesFromText('o de uma hora')).toBe(60)
    expect(durationMinutesFromText('meia hora')).toBe(30)
    expect(durationMinutesFromText('90 min')).toBe(90)
    expect(durationMinutesFromText('2h')).toBe(120)
  })

  it('não fecha selecção com hit parcial fraco', () => {
    const result = resolveBookingObject({
      text: 'Quero marcar uma limpeza',
      services: EVAL_BOOKING_CATALOG,
    })
    expect(result.kind).toBe('clarify')
    expect(result.serviceId).toBe('svc-limpeza')
    expect(result.question).toMatch(/Limpeza de pele/i)
  })

  it('distingue variante por duração', () => {
    const result = resolveBookingObject({
      text: 'Laser facial o de uma hora',
      services: EVAL_BOOKING_CATALOG,
    })
    expect(result.kind).toBe('selected')
    expect(result.variantIds).toEqual(['z-laser-60'])
  })

  it('handoff para terceiro e histórico indisponível', () => {
    expect(
      resolveBookingObject({
        text: 'Marcar limpeza pra minha mãe',
        services: EVAL_BOOKING_CATALOG,
      }).handoffReason,
    ).toBe('terceiro')
    expect(
      resolveBookingObject({
        text: 'Quero igual à última vez',
        services: EVAL_BOOKING_CATALOG,
      }).handoffReason,
    ).toBe('historico_indisponivel')
  })

  it('retoma variantes da sessão após pergunta lateral', () => {
    const result = resolveBookingObject({
      text: 'Pode ser amanhã de manhã',
      services: EVAL_BOOKING_CATALOG,
      session: {
        serviceId: 'svc-depilacao',
        audienceLine: 'feminino',
        variantIds: ['z-axila-f', 'z-intima-f'],
      },
    })
    expect(result.kind).toBe('selected')
    expect(result.variantIds.sort()).toEqual(['z-axila-f', 'z-intima-f'].sort())
  })
})
