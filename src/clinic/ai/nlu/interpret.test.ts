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
    zones: [],
    combos: [],
    ...partial,
  }
}

describe('interpretTurn (#416)', () => {
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
})
