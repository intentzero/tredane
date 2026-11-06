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
    synonyms: [],
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
        synonyms: [],
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
        turnText: 'quero axila amanhã de manhã',
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
        turnText: 'quero axila amanhã de manhã',
        today: '2026-11-02',
        services: [svc],
        professionals: [{ id: 'pro_1', name: 'Bia' }],
        pending: null,
        base,
      },
    )
    expect(v.discarded).toEqual(expect.arrayContaining(['serviceId', 'variantIds', 'professionalId']))
  })

  it('id de catálogo sem a palavra na frase não preenche o campo (DEC-104, 06/11/2026)', () => {
    const quiet = interpretTurn({
      turnText: 'pode ser então',
      messageId: 'msg_2',
      today: '2026-11-02',
      services: [svc],
    })
    const v = validateExtractorOutput(
      {
        acts: ['marcar'],
        serviceId: 'svc_dep',
        variantIds: ['zone_ax'],
        professionalId: 'pro_1',
        line: 'feminino',
        period: 'manha',
        dateLiteral: 'amanhã',
        timeLiteral: '18:00',
        optionIndex: 0,
      },
      {
        messageId: 'msg_2',
        turnText: 'pode ser então',
        today: '2026-11-02',
        services: [svc],
        professionals: [{ id: 'pro_1', name: 'Bia' }],
        pending: {
          slot: 'horario',
          messageId: 'm',
          options: [{ key: '2026-11-06T18:00', label: 'sexta 06/11 18:00' }],
        },
        base: quiet,
      },
    )
    expect(v.slots.serviceId?.fonte).not.toBe('llm')
    expect(v.slots.variantIds).toBeUndefined()
    expect(v.slots.professionalId).toBeUndefined()
    expect(v.slots.line?.fonte).not.toBe('llm')
    expect(v.slots.period?.fonte).not.toBe('llm')
    expect(v.slots.date?.fonte).not.toBe('llm')
    expect(v.slots.time).toBeUndefined()
    expect(v.slots.optionIndex).toBeUndefined()
    expect(v.discarded).toEqual(
      expect.arrayContaining([
        'serviceId',
        'variantIds',
        'professionalId',
        'line',
        'period',
        'dateUnresolved',
        'timeUnresolved',
        'optionIndex',
      ]),
    )
  })

  it('hora só entra se parseTimes a confirma na frase da cliente', () => {
    const quiet = interpretTurn({
      turnText: 'pode ser às 18',
      messageId: 'msg_3',
      today: '2026-11-02',
      services: [svc],
    })
    const opts = {
      messageId: 'msg_3',
      turnText: 'pode ser às 18',
      today: '2026-11-02',
      services: [svc],
      professionals: [{ id: 'pro_1', name: 'Bia' }],
      pending: null,
      base: quiet,
    }
    const accepted = validateExtractorOutput({ acts: ['marcar'], timeLiteral: '18:00' }, opts)
    expect(accepted.slots.time?.value).toBe('18:00')
    expect(accepted.slots.time?.fonte).toBe('llm')
    const bare = interpretTurn({
      turnText: 'pode ser',
      messageId: 'msg_3',
      today: '2026-11-02',
      services: [svc],
    })
    const invented = validateExtractorOutput(
      { acts: ['marcar'], timeLiteral: '18:00' },
      { ...opts, turnText: 'pode ser', base: bare },
    )
    expect(invented.slots.time).toBeUndefined()
    expect(invented.discarded).toContain('timeUnresolved')
  })

  it('sinónimo na frase sustenta o serviço; o nome do catálogo como trecho, não', () => {
    const withSyn = service({ id: 'svc_dep', name: 'Depilação', synonyms: ['depilar'] })
    const baseSyn = interpretTurn({
      turnText: 'quero depilar',
      messageId: 'msg_4',
      today: '2026-11-02',
      services: [withSyn],
    })
    const v = validateExtractorOutput(
      { acts: ['marcar'], serviceId: 'svc_dep', variantIds: ['zone_ax'] },
      {
        messageId: 'msg_4',
        turnText: 'quero depilar',
        today: '2026-11-02',
        services: [withSyn],
        professionals: [],
        pending: null,
        base: baseSyn,
      },
    )
    expect(v.slots.serviceId?.value).toBe('svc_dep')
    expect(v.slots.variantIds).toBeUndefined()
    expect(v.discarded).toContain('variantIds')
  })
})
