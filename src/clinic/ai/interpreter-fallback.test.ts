/**
 * Fallback do interpretador LLM (Paulo, 17/11/2026 — sombra 72h).
 */
import { describe, expect, it, vi } from 'vitest'
import type { ServiceRow } from '../config/types'
import { interpretTurn, type TurnInterpretation } from './nlu/interpret'
import { validateExtractorOutput } from './llm-extractor'
import {
  DEFAULT_INTERPRETER_FALLBACK_FLAGS,
  interpreterFallbackFlagsFromEnv,
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
const flagsAll: typeof DEFAULT_INTERPRETER_FALLBACK_FLAGS = {
  service: true,
  line: true,
  period: true,
}

describe('interpreterFallbackFlagsFromEnv', () => {
  it('defaults: service on, line/period off', () => {
    expect(interpreterFallbackFlagsFromEnv({})).toEqual(DEFAULT_INTERPRETER_FALLBACK_FLAGS)
  })
})

describe('periodModelEvidence', () => {
  it('rejeita «boa tarde» como período', () => {
    expect(periodModelEvidence('boa tarde, quero depilação amanhã', 'tarde')).toBe(false)
  })
  it('aceita «de manhã»', () => {
    expect(periodModelEvidence('depilação amanhã de manhã', 'manha')).toBe(true)
  })
  it('rejeita «depois das 11» como período', () => {
    expect(periodModelEvidence('depois das 11 tem horário?', 'manha')).toBe(false)
  })
})

describe('validateExtractorOutput — fallback', () => {
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
        fallbackFlags: DEFAULT_INTERPRETER_FALLBACK_FLAGS,
      },
    )
    expect(v.slots.serviceId?.value).toBe('svc_dep')
    expect(v.fallbackApplied).toContain('service')
  })

  it('não sobrescreve serviço já lido pelo léxico', () => {
    const base = interpretTurn({
      turnText: 'quero depilação amanhã',
      messageId: 'msg_keep',
      today: '2026-11-02',
      services: [dep],
    })
    expect(base.slots.serviceId?.value).toBe('svc_dep')
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
        fallbackFlags: DEFAULT_INTERPRETER_FALLBACK_FLAGS,
      },
    )
    expect(v.slots.serviceId?.value).toBe('svc_dep')
    expect(v.slots.serviceId?.fonte).not.toBe('llm')
    expect(v.discarded).toContain('serviceId')
  })

  it('rejeita id inactivo / inválido', () => {
    const base = interpretTurn({
      turnText: 'quero marcar amanhã',
      messageId: 'msg_bad',
      today: '2026-11-02',
      services: [dep],
    })
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
    expect(v.slots.serviceId).toBeUndefined()
    expect(v.discarded).toContain('serviceId')
  })

  it('line sem palavra de género não aplica mesmo com flag on', () => {
    const base = interpretTurn({
      turnText: 'depilação amanhã',
      messageId: 'msg_line',
      today: '2026-11-02',
      services: [dep],
    })
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
        fallbackFlags: flagsAll,
      },
    )
    expect(v.slots.line?.fonte).not.toBe('llm')
    expect(v.discarded).toContain('line')
  })

  it('período «boa tarde» rejeitado', () => {
    const base = interpretTurn({
      turnText: 'boa tarde quero depilação',
      messageId: 'msg_bt',
      today: '2026-11-02',
      services: [dep],
    })
    const v = validateExtractorOutput(
      { acts: ['marcar'], period: 'tarde' },
      {
        messageId: 'msg_bt',
        turnText: 'boa tarde quero depilação',
        today: '2026-11-02',
        services: [dep],
        professionals: [],
        pending: null,
        base,
        fallbackFlags: flagsAll,
      },
    )
    expect(v.slots.period).toBeUndefined()
    expect(v.discarded).toContain('period')
  })

  it('«de manhã» com flag period on aplica quando léxico não leu período', () => {
    const massagem = service({ id: 'svc_m', name: 'Massagem', zones: [] })
    const base: TurnInterpretation = {
      acts: ['marcar'],
      slots: {
        serviceId: { value: 'svc_m', messageId: 'msg_manha', trecho: 'Massagem', fonte: 'llm' },
        date: { value: '2026-11-03', messageId: 'msg_manha', trecho: 'amanhã', fonte: 'regra' },
      },
      coverage: 0.6,
      needsExtractor: true,
    }
    const v = validateExtractorOutput(
      { acts: ['marcar'], period: 'manha' },
      {
        messageId: 'msg_manha',
        turnText: 'queria relaxar as costas amanhã de manhã',
        today: '2026-11-02',
        services: [massagem],
        professionals: [],
        pending: null,
        base,
        fallbackFlags: flagsAll,
      },
    )
    expect(v.slots.period?.value).toBe('manha')
    expect(v.fallbackApplied).toContain('period')
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
    const base = interpretTurn({
      turnText: 'quero marcar amanhã',
      messageId: 'msg_nv',
      today: '2026-11-02',
      services: [depZ],
    })
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
        fallbackFlags: flagsAll,
      },
    )
    expect(v.slots.variantIds).toBeUndefined()
    expect(v.slots.optionIndex).toBeUndefined()
    expect(v.fallbackApplied).not.toContain('line')
  })

  it('flags line/period off não aplicam esses campos', () => {
    const base = interpretTurn({
      turnText: 'queria relaxar as costas amanhã de manhã',
      messageId: 'msg_flags',
      today: '2026-11-02',
      services: [service({ id: 'svc_mass', name: 'Massagem relaxante', zones: [] })],
    })
    expect(base.slots.serviceId).toBeUndefined()
    const v = validateExtractorOutput(
      { acts: ['marcar'], serviceId: 'svc_mass', period: 'manha', line: 'feminino' },
      {
        messageId: 'msg_flags',
        turnText: 'queria relaxar as costas amanhã de manhã',
        today: '2026-11-02',
        services: [service({ id: 'svc_mass', name: 'Massagem relaxante', zones: [] })],
        professionals: [],
        pending: null,
        base,
        fallbackFlags: DEFAULT_INTERPRETER_FALLBACK_FLAGS,
      },
    )
    expect(v.slots.line).toBeUndefined()
    expect(v.fallbackApplied).toContain('service')
    expect(v.fallbackApplied).not.toContain('period')
    expect(v.fallbackApplied).not.toContain('line')
  })
})

describe('shouldRunFallbackExtractor', () => {
  it('não corre sem lacuna nem com flags desligados', () => {
    const base = interpretTurn({
      turnText: 'fazem pacote pra noivas?',
      messageId: 'msg_faq',
      today: '2026-11-02',
      services: [dep],
    })
    expect(interpreterFallbackGaps({ acts: base.acts, slots: base.slots, turnText: 'fazem pacote pra noivas?' })).toEqual(
      [],
    )
    expect(shouldRunFallbackExtractor(base, 'fazem pacote pra noivas?', DEFAULT_INTERPRETER_FALLBACK_FLAGS)).toBe(
      false,
    )
  })
})

describe('logInterpreterFallbackApplied', () => {
  it('emite ids sem texto', () => {
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
    spy.mockRestore()
  })
})