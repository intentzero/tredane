/**
 * Fallback do interpretador LLM — só serviço (Paulo, 17/11/2026 — DL D-20261117-091300-CUR).
 */
import { describe, expect, it, vi } from 'vitest'
import type { ServiceRow } from '../config/types'
import { interpretTurn, type TurnInterpretation } from './nlu/interpret'
import { validateExtractorOutput } from './llm-extractor'
import {
  DEFAULT_INTERPRETER_FALLBACK,
  interpreterFallbackConfigFromEnv,
  interpreterFallbackGaps,
  logInterpreterFallbackApplied,
  periodModelEvidence,
  shouldRunFallbackExtractor,
} from './interpreter-fallback'

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
    variantSelection: 'varias',
    synonyms: [],
    zones: [],
    combos: [],
    ...partial,
  }
}

const dep = service({ id: 'svc_dep', name: 'Depilação' })

describe('interpreterFallbackConfigFromEnv', () => {
  it('default: service on', () => {
    expect(interpreterFallbackConfigFromEnv({})).toEqual({ service: true })
    expect(interpreterFallbackConfigFromEnv({ AI_INTERPRETER_FALLBACK_SERVICE: 'off' })).toEqual({
      service: false,
    })
  })
})

describe('periodModelEvidence (sombra / validação; não aplica no atendimento)', () => {
  it('rejeita «boa tarde» como período', () => {
    expect(periodModelEvidence('boa tarde, quero depilação amanhã', 'tarde')).toBe(false)
  })
})

describe('validateExtractorOutput — fallback só serviço', () => {
  it('typo «depilaçao»: serviço via fallback com léxico vazio', () => {
    const base: TurnInterpretation = {
      acts: ['marcar'],
      slots: {
        date: { value: '2026-11-03', messageId: 'msg_typo', trecho: 'amanhã', fonte: 'regra' },
      },
      coverage: 0.4,
      needsExtractor: true,
    }
    const v = validateExtractorOutput(
      { acts: ['marcar'], serviceId: 'svc_dep' },
      {
        messageId: 'msg_typo',
        turnText: 'boa tarde quero fazer depilaçao',
        today: '2026-11-02',
        services: [dep],
        professionals: [],
        pending: null,
        base,
      },
    )
    expect(v.slots.serviceId?.value).toBe('svc_dep')
    expect(v.fallbackApplied).toBe(true)
  })

  it('não sobrescreve serviço já lido pelo léxico', () => {
    const base = interpretTurn({
      turnText: 'quero depilação amanhã',
      messageId: 'msg_keep',
      today: '2026-11-02',
      services: [dep],
    })
    const v = validateExtractorOutput(
      { acts: ['marcar'], serviceId: 'svc_outro' },
      {
        messageId: 'msg_keep',
        turnText: 'quero depilação amanhã',
        today: '2026-11-02',
        services: [dep, service({ id: 'svc_outro', name: 'Massagem', active: false })],
        professionals: [],
        pending: null,
        base,
      },
    )
    expect(v.slots.serviceId?.value).toBe('svc_dep')
    expect(v.slots.serviceId?.fonte).not.toBe('llm')
    expect(v.fallbackApplied).toBe(false)
  })

  it('rejeita id inactivo / inválido', () => {
    const base: TurnInterpretation = {
      acts: ['marcar'],
      slots: {
        date: { value: '2026-11-03', messageId: 'msg_bad', trecho: 'amanhã', fonte: 'regra' },
      },
      coverage: 0.4,
      needsExtractor: true,
    }
    const v = validateExtractorOutput(
      { acts: ['marcar'], serviceId: 'svc_ghost' },
      {
        messageId: 'msg_bad',
        turnText: 'quero marcar amanhã',
        today: '2026-11-02',
        services: [dep],
        professionals: [],
        pending: null,
        base,
      },
    )
    expect(v.slots.serviceId?.fonte).not.toBe('llm')
    expect(v.discarded).toContain('serviceId')
  })

  it('ignora line do modelo mesmo com léxico vazio', () => {
    const base: TurnInterpretation = {
      acts: ['marcar'],
      slots: {
        date: { value: '2026-11-03', messageId: 'msg_line', trecho: 'amanhã', fonte: 'regra' },
      },
      coverage: 0.4,
      needsExtractor: true,
    }
    const v = validateExtractorOutput(
      { acts: ['marcar'], serviceId: 'svc_dep', line: 'feminino' },
      {
        messageId: 'msg_line',
        turnText: 'depilação amanhã',
        today: '2026-11-02',
        services: [dep],
        professionals: [],
        pending: null,
        base,
      },
    )
    expect(v.slots.line).toBeUndefined()
    expect(v.fallbackApplied).toBe(true)
  })

  it('ignora period do modelo mesmo com flag implícita e léxico vazio', () => {
    const base: TurnInterpretation = {
      acts: ['marcar'],
      slots: {
        date: { value: '2026-11-03', messageId: 'msg_p', trecho: 'amanhã', fonte: 'regra' },
      },
      coverage: 0.4,
      needsExtractor: true,
    }
    const v = validateExtractorOutput(
      { acts: ['marcar'], serviceId: 'svc_dep', period: 'manha' },
      {
        messageId: 'msg_p',
        turnText: 'depilação amanhã de manhã',
        today: '2026-11-02',
        services: [dep],
        professionals: [],
        pending: null,
        base,
        fallbackConfig: { service: true },
      },
    )
    expect(v.slots.period).toBeUndefined()
    expect(v.fallbackApplied).toBe(true)
  })

  it('não aplica variantes nem opção do modelo', () => {
    const z = {
      id: 'zone_ax',
      tenantId: 't',
      serviceId: 'svc_dep',
      name: 'Axila',
      durationMinutes: 15,
      priceCents: 5000,
      audience: 'feminino' as const,
      active: true,
      sortOrder: 0,
      synonyms: [] as string[],
      clientExplanation: null,
    }
    const depZ = service({ id: 'svc_dep', name: 'Depilação', zones: [z] })
    const base: TurnInterpretation = {
      acts: ['marcar'],
      slots: {
        date: { value: '2026-11-03', messageId: 'msg_nv', trecho: 'amanhã', fonte: 'regra' },
      },
      coverage: 0.4,
      needsExtractor: true,
    }
    const v = validateExtractorOutput(
      {
        acts: ['escolher_opcao', 'marcar'],
        variantIds: ['zone_ax'],
        optionIndex: 0,
        serviceId: 'svc_dep',
      },
      {
        messageId: 'msg_nv',
        turnText: 'quero marcar amanhã',
        today: '2026-11-02',
        services: [depZ],
        professionals: [],
        pending: {
          slot: 'horario',
          messageId: 'p',
          options: [{ key: '10:00', label: '10:00' }],
        },
        base,
      },
    )
    expect(v.slots.variantIds).toBeUndefined()
    expect(v.slots.optionIndex).toBeUndefined()
  })

  it('com fallback desligado não aplica serviço', () => {
    const base: TurnInterpretation = {
      acts: ['marcar'],
      slots: {
        date: { value: '2026-11-03', messageId: 'msg_off', trecho: 'amanhã', fonte: 'regra' },
      },
      coverage: 0.4,
      needsExtractor: true,
    }
    const v = validateExtractorOutput(
      { acts: ['marcar'], serviceId: 'svc_dep' },
      {
        messageId: 'msg_off',
        turnText: 'quero marcar amanhã',
        today: '2026-11-02',
        services: [dep],
        professionals: [],
        pending: null,
        base,
        fallbackConfig: { service: false },
      },
    )
    expect(v.slots.serviceId?.fonte).not.toBe('llm')
    expect(v.fallbackApplied).toBe(false)
  })
})

describe('shouldRunFallbackExtractor', () => {
  it('não corre sem lacuna de serviço', () => {
    const base = interpretTurn({
      turnText: 'fazem pacote pra noivas?',
      messageId: 'msg_faq',
      today: '2026-11-02',
      services: [dep],
    })
    expect(interpreterFallbackGaps({ acts: base.acts, slots: base.slots, turnText: 'fazem pacote pra noivas?' })).toEqual(
      [],
    )
    expect(shouldRunFallbackExtractor(base, 'fazem pacote pra noivas?', DEFAULT_INTERPRETER_FALLBACK)).toBe(false)
  })
})

describe('logInterpreterFallbackApplied', () => {
  it('emite só serviceId', () => {
    const spy = vi.spyOn(console, 'info').mockImplementation(() => {})
    logInterpreterFallbackApplied({
      level: 'info',
      event: 'ai.interpreter_fallback_applied',
      tenantId: 'ten_a',
      conversationId: 'cnv_a',
      messageId: 'msg_a',
      fields: ['service'],
      serviceId: 'svc_dep',
    })
    const line = String(spy.mock.calls[0]?.[0])
    expect(line).toContain('ai.interpreter_fallback_applied')
    expect(line).toContain('svc_dep')
    expect(line).not.toContain('depila')
    expect(line).not.toContain('line')
    spy.mockRestore()
  })
})