import { describe, expect, it } from 'vitest'
import type { ServiceRow } from '../config/types'
import { interpretTurn } from './nlu/interpret'
import { validateExtractorOutput } from './llm-extractor'

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
    professionalIds: ['pro_1'],
    roomRequirement: { mode: 'none' },
    equipmentResourceId: null,
    weeklyWindows: [],
    deletable: true,
    variantKind: 'Zona',
    variantKindPlural: 'Zonas',
    zones: [
      {
        id: 'zone_ax',
        tenantId: 't',
        serviceId: partial.id,
        name: 'Axila',
        durationMinutes: 15,
        priceCents: 5000,
        audience: 'feminino',
        active: true,
        sortOrder: 0,
      },
    ],
    combos: [],
    ...partial,
  }
}

describe('validateExtractorOutput (#416 / DEC-109)', () => {
  const svc = service({ id: 'svc_dep', name: 'Depilação' })
  const base = interpretTurn({
    turnText: 'quero axila amanhã de manhã',
    messageId: 'msg_1',
    today: '2026-11-02',
    services: [svc],
  })

  it('aceita ids do catálogo e resolve dateLiteral', () => {
    const v = validateExtractorOutput(
      {
        acts: ['marcar'],
        serviceId: 'svc_dep',
        variantIds: ['zone_ax'],
        dateLiteral: 'amanhã',
        period: 'manha',
        confidence: 0.99,
      },
      {
        messageId: 'msg_1',
        today: '2026-11-02',
        services: [svc],
        professionals: [{ id: 'pro_1', name: 'Bia' }],
        pending: null,
        base,
      },
    )
    expect(v.slots.serviceId?.value).toBe('svc_dep')
    expect(v.slots.serviceId?.fonte).toBe('llm')
    expect(v.slots.variantIds?.value).toEqual(['zone_ax'])
    expect(v.slots.date?.value).toBe('2026-11-03')
    expect(v.slots.period?.value).toBe('manha')
    // Confiança alta não aparece como autorização.
    expect(v.discarded).not.toContain('confidence')
  })

  it('descarta ids fora do enum', () => {
    const v = validateExtractorOutput(
      {
        acts: ['marcar'],
        serviceId: 'svc_outro_tenant',
        variantIds: ['zone_hack'],
        professionalId: '_none',
      },
      {
        messageId: 'msg_1',
        today: '2026-11-02',
        services: [svc],
        professionals: [{ id: 'pro_1', name: 'Bia' }],
        pending: null,
        base,
      },
    )
    expect(v.discarded).toEqual(expect.arrayContaining(['serviceId', 'variantIds', 'professionalId']))
  })
})
