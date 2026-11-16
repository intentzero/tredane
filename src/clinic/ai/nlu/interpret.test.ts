import { describe, expect, it } from 'vitest'
import type { ServiceRow } from '../../config/types'
import { COVERAGE_THRESHOLD, interpretTurn } from './interpret'

function service(partial: Partial<ServiceRow> & { id: string; name: string }): ServiceRow {
  return {
    tenantId: 't',
    durationMinutes: 30,
    bufferMinutes: 0,
    audiencia: 'qualquer',
    tempoCeu: 'tanto_faz',
    tempoTemperatura: 'tanto_faz',
    tempoCelsius: null,
    priceCents: 10000,
    clientExplanation: null,
    active: true,
    requiresSignal: false,
    signalKind: null,
    signalFixedCents: null,
    signalPercent: null,
    durationAdjustable: false,
    durationMinMinutes: null,
    durationMaxMinutes: null,
    createdAt: 0,
    updatedAt: 0,
    professionalIds: [],
    roomRequirement: { mode: 'none' },
    equipmentResourceId: null,
    weeklyWindows: [],
    deletable: true,
    variantKind: null,
    variantKindPlural: null,
    variantSelection: 'varias',
    synonyms: [],
    zones: [],
    combos: [],
    ...partial,
  }
}

describe('interpretTurn (#416)', () => {
  it('reconhece abreviação «qnto» como preço', () => {
    const r = interpretTurn({
      turnText: 'qnto custa?',
      messageId: 'msg_q',
      today: '2026-11-02',
      services: [service({ id: 'svc_1', name: 'Limpeza de pele' })],
    })
    expect(r.acts).toContain('informar_preco')
  })

  it('rsamp_1241995755: «atende no domingo» → informar_horario_funcionamento', () => {
    const r = interpretTurn({
      turnText: 'Gostaria saber se você atende j no o domingo?',
      messageId: 'msg_dom',
      today: '2026-11-15',
      services: [],
    })
    expect(r.acts).toContain('informar_horario_funcionamento')
    expect(r.acts).not.toContain('desconhecido')
  })
  it('reconhece preço e serviço com cobertura alta', () => {
    const svc = service({ id: 'svc_1', name: 'Limpeza de pele' })
    const r = interpretTurn({
      turnText: 'Oi, quanto custa a limpeza de pele?',
      messageId: 'msg_1',
      today: '2026-11-02',
      services: [svc],
    })
    expect(r.acts).toContain('informar_preco')
    expect(r.slots.serviceId?.value).toBe('svc_1')
    expect(r.coverage).toBeGreaterThan(0.3)
  })

  it('marca needsExtractor em texto coloquial sem léxico', () => {
    const r = interpretTurn({
      turnText: 'fazem pacote pra noivas no final do ano?',
      messageId: 'msg_2',
      today: '2026-11-02',
      services: [service({ id: 'svc_1', name: 'Limpeza de pele' })],
    })
    expect(r.needsExtractor || r.acts.includes('desconhecido')).toBe(true)
    expect(r.coverage).toBeLessThanOrEqual(COVERAGE_THRESHOLD + 0.2)
  })

  it('DEC-190: needsExtractor com data e sem serviço (lacuna híbrida)', () => {
    const r = interpretTurn({
      turnText: 'queria relaxar as costas amanhã',
      messageId: 'msg_h1',
      today: '2026-11-02',
      services: [service({ id: 'svc_mass', name: 'Massagem relaxante' })],
    })
    expect(r.slots.date?.value).toBe('2026-11-03')
    expect(r.slots.serviceId).toBeUndefined()
    expect(r.needsExtractor).toBe(true)
  })

  it('lê opção pendente com «a segunda»', () => {
    const r = interpretTurn({
      turnText: 'a segunda',
      messageId: 'msg_3',
      today: '2026-11-02',
      services: [],
      pending: {
        slot: 'time',
        options: [
          { key: '10:00', label: '10:00' },
          { key: '11:00', label: '11:00' },
        ],
        messageId: 'msg_out',
      },
    })
    expect(r.acts).toContain('escolher_opcao')
    expect(r.slots.optionIndex?.value).toBe(1)
  })

  it('Lab Bloco D: hit parcial único em mid-switch e booking («prefiro peeling», «troca pra drenagem»)', () => {
    const peeling = service({ id: 'svc_peel', name: 'Peeling químico' })
    const drenagem = service({ id: 'svc_dren', name: 'Drenagem linfática' })
    const limpeza = service({ id: 'svc_limp', name: 'Limpeza de pele profunda' })
    const catalog = [peeling, drenagem, limpeza]

    const prefiro = interpretTurn({
      turnText: 'prefiro peeling',
      messageId: 'msg_c3',
      today: '2026-11-02',
      services: catalog,
    })
    expect(prefiro.slots.serviceId?.value).toBe('svc_peel')
    expect(prefiro.acts).toContain('corrigir')
    expect(prefiro.acts).toContain('marcar')

    const troca = interpretTurn({
      turnText: 'troca pra drenagem',
      messageId: 'msg_c5',
      today: '2026-11-02',
      services: catalog,
    })
    expect(troca.slots.serviceId?.value).toBe('svc_dren')
    expect(troca.acts).toContain('corrigir')

    const booking = interpretTurn({
      turnText: 'quero drenagem amanhã',
      messageId: 'msg_a2',
      today: '2026-11-02',
      services: catalog,
    })
    expect(booking.slots.serviceId?.value).toBe('svc_dren')

    const ambiguous = interpretTurn({
      turnText: 'quero pele',
      messageId: 'msg_amb',
      today: '2026-11-02',
      services: catalog,
    })
    expect(ambiguous.slots.serviceId).toBeUndefined()
  })

  it('Lab #8 / PR-D: «depois das Nh» preenche period (noite) sem time pontual', () => {
    const faq = interpretTurn({
      turnText: 'tem horário depois das 20h?',
      messageId: 'msg_3b05c6',
      today: '2026-11-02',
      services: [],
    })
    expect(faq.slots.period?.value).toBe('noite')
    expect(faq.slots.time).toBeUndefined()

    const pref = interpretTurn({
      turnText: 'só posso depois das 18h',
      messageId: 'msg_h07',
      today: '2026-11-02',
      services: [],
    })
    expect(pref.slots.period?.value).toBe('noite')
    expect(pref.slots.time).toBeUndefined()
  })
})
