import { afterEach, describe, expect, it } from 'vitest'
import { extractServices } from './autobook'
import {
  catalogMissHint,
  durationMinutesFromText,
  listBookableOptions,
  resolveBookingObject,
} from './booking-object'
import { renderEveryVariant, setDialogueVariantForTests } from './dialogue-acts'
import { EVAL_BOOKING_CATALOG } from './evals/booking-object-catalog'

describe('booking-object', () => {
  afterEach(() => setDialogueVariantForTests(null))

  it('#448 perguntar_servico / confirmar_servico via catálogo', () => {
    for (const text of renderEveryVariant('perguntar_servico', {
      lista: 'Massagem, Limpeza de pele',
    })) {
      expect(text).toMatch(/serviço|Massagem/i)
    }
    for (const text of renderEveryVariant('confirmar_servico', { serviço: 'Massagem' })) {
      expect(text).toMatch(/massagem/)
      expect(text).not.toMatch(/\bMassagem\b/)
    }
    setDialogueVariantForTests(0)
    const confirm = resolveBookingObject({
      text: 'Quero marcar uma limpeza',
      services: EVAL_BOOKING_CATALOG,
      conversationId: 'cnv_s4',
    })
    expect(confirm.question).toMatch(/limpeza de pele/)
    expect(confirm.question).not.toMatch(/\bLimpeza de pele\b/)
    expect(renderEveryVariant('confirmar_servico', { serviço: 'Limpeza de pele' })).toContain(
      confirm.question,
    )
  })

  it('normaliza opções com e sem variantes', () => {
    const options = listBookableOptions(EVAL_BOOKING_CATALOG)
    expect(options.some((o) => o.key === 'svc-limpeza' && !o.hasVariants)).toBe(true)
    expect(options.filter((o) => o.serviceId === 'svc-depilacao').length).toBe(6)
  })

  it('T14: zonas todas inactivas → sem opção bookable (não cai na linha)', () => {
    const base = EVAL_BOOKING_CATALOG.find((s) => s.id === 'svc-depilacao')!
    const deadZonesOnly = {
      ...base,
      id: 'svc-laser-off',
      name: 'Laser',
      zones: base.zones.map((z, i) =>
        i === 0 ? { ...z, id: 'z-off', active: false } : { ...z, active: false },
      ),
    }
    expect(listBookableOptions([deadZonesOnly])).toEqual([])
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

  it('catálogo vazio não handoff; deriva material sim', () => {
    expect(resolveBookingObject({ text: 'oi', services: [] }).kind).toBe('none')
    expect(
      resolveBookingObject({ text: 'Pode ser axila', services: [], catalogDrift: true }).handoffReason,
    ).toBe('catalogo_vazio')
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

  it.each([
    ['tem limpeza hoje?', 'svc-limpeza'],
    ['quero limpeza de pele', 'svc-limpeza'],
    ['limpeza de pele profunda amanhã', 'svc-limpeza-profunda'],
    ['profunda de limpeza de pele', 'svc-limpeza-profunda'],
  ] as const)('prefixo de nome «%s» → serviço %s (F-08)', (text, serviceId) => {
    const resolved = resolveBookingObject({ text, services: EVAL_BOOKING_CATALOG })
    const extracted = extractServices(text, EVAL_BOOKING_CATALOG)
    expect(extracted.map((s) => s.id).sort()).toEqual(
      resolved.serviceId ? [resolved.serviceId].sort() : extracted.map((s) => s.id).sort(),
    )
    // Ambos concordam no serviço escolhido quando há um único candidato claro.
    if (resolved.serviceId) expect(resolved.serviceId).toBe(serviceId)
    expect(extracted.some((s) => s.id === serviceId)).toBe(true)
    // «limpeza» sozinha não deve empatar com a profunda.
    if (!/profunda/.test(text)) {
      expect(extracted.every((s) => s.id !== 'svc-limpeza-profunda')).toBe(true)
    }
  })

  it('stopwords pt-BR não viram pedido inexistente («favor», «seria»)', () => {
    expect(
      catalogMissHint('Boa tarde Gostaria agendar um horário dia 13/11 por favor', EVAL_BOOKING_CATALOG),
    ).toBeNull()
    // «seria»/«favor» não ecoam; depilação casa o serviço (não handoff inexistente).
    expect(catalogMissHint('Seria botox por favor', EVAL_BOOKING_CATALOG)).toBe('botox')
    const booking = resolveBookingObject({
      text: 'Seria depilação feminina por favor',
      services: EVAL_BOOKING_CATALOG,
    })
    expect(booking.handoffReason).not.toBe('inexistente')
    expect(booking.serviceId).toBe('svc-depilacao')
  })

  it('staging: «agendamento … parte da manhã» não ecoa miss DEC-151', () => {
    // Screenshot 11/11/2026: hint era «agendamento parte» → «Não entendi bem «…»».
    const text = 'Gostaria fazer um agendamento hoje na parte da manhã'
    expect(catalogMissHint(text, EVAL_BOOKING_CATALOG)).toBeNull()
    const booking = resolveBookingObject({ text, services: EVAL_BOOKING_CATALOG })
    expect(booking.handoffReason).not.toBe('inexistente')
    expect(booking.kind).toBe('clarify')
    expect(booking.missing).toContain('servico')
    // DEC-151 real continua: termo que parece serviço sem hit.
    expect(catalogMissHint('Quero agendar uma mensagem', EVAL_BOOKING_CATALOG)).toBe('mensagem')
    expect(
      resolveBookingObject({
        text: 'Quero agendar uma mensagem',
        services: EVAL_BOOKING_CATALOG,
      }).handoffReason,
    ).toBe('inexistente')
  })

  it('#509 «Quero depilar» casa Depilação quando o sinónimo está na ficha', () => {
    const base = EVAL_BOOKING_CATALOG.find((s) => s.name === 'Depilação')
    expect(base).toBeTruthy()
    const withSyn = [
      ...EVAL_BOOKING_CATALOG.filter((s) => s.id !== base!.id),
      { ...base!, synonyms: ['depilar'] },
    ]
    expect(extractServices('Quero depilar', withSyn).map((s) => s.id)).toEqual([base!.id])
    const resolved = resolveBookingObject({ text: 'Quero depilar', services: withSyn })
    expect(resolved.serviceId).toBe(base!.id)
    // Sem o sinónimo na ficha, não inventa o match.
    expect(extractServices('Quero depilar', EVAL_BOOKING_CATALOG).map((s) => s.id)).not.toContain(
      base!.id,
    )
  })
})
