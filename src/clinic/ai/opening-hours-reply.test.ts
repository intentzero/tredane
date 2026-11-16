import { describe, expect, it } from 'vitest'
import { createControllableClock } from '../../db/clock'
import { setWeeklyWindowsOp, upsertResourceOp } from '../config'
import { createResourceBlock } from '../config/blocks'
import { CLINIC_SCOPE_ID } from '../config/types'
import { workerCaller } from '../index'
import { bootClinicDb } from '../test-db'
import { catalogReply } from './catalog-reply'
import {
  buildOpeningHoursReply,
  isOpeningHoursFaqAsk,
  openingHoursMixedWithBooking,
} from './opening-hours-reply'
import { interpretTurn } from './nlu/interpret'
import { COVERAGE_THRESHOLD } from './nlu/interpret'

const NOW = Date.UTC(2026, 10, 16, 14, 0)

function seedWindows(db: ReturnType<typeof bootClinicDb>['db'], tenantId: string, clock: ReturnType<typeof createControllableClock>) {
  const caller = workerCaller(tenantId)
  const pro = upsertResourceOp(db, caller, { kind: 'professional', name: 'Ana' }, clock)
  setWeeklyWindowsOp(
    db,
    caller,
    {
      resourceId: pro.id,
      windows: [1, 2, 3, 4, 5, 6].flatMap((d) => [
        { dayOfWeek: d, startMinute: 9 * 60, endMinute: 18 * 60 },
      ]),
    },
    clock,
  )
  return pro
}

describe('opening-hours-reply (deterministic FAQ)', () => {
  it('detecta variantes sem acento, abreviações e feriado', () => {
    expect(isOpeningHoursFaqAsk('atende domingo?')).toBe(true)
    expect(isOpeningHoursFaqAsk('vocês abrem sab?')).toBe(true)
    expect(isOpeningHoursFaqAsk('ate que horas fecham')).toBe(true)
    expect(isOpeningHoursFaqAsk('atendem em feriado?')).toBe(true)
    expect(isOpeningHoursFaqAsk('quero agendar depilação segunda às 15h')).toBe(false)
  })

  it('marca misto com pedido de marcação no mesmo turno', () => {
    expect(openingHoursMixedWithBooking('quero marcar depilação amanhã, atendem domingo?')).toBe(
      true,
    )
    expect(openingHoursMixedWithBooking('gostaria de saber se atendem domingo')).toBe(false)
  })

  it('responde dia específico e expediente completo', () => {
    const clock = createControllableClock(NOW)
    const boot = bootClinicDb({ clock })
    const tenantId = 'clinic-demo-hours-det'
    seedWindows(boot.db, tenantId, clock)
    const dom = buildOpeningHoursReply(
      boot.db,
      tenantId,
      clock,
      'vocês atendem no domingo?',
      'cnv_h',
    )
    expect(dom).toMatch(/domingo:\s*fechado|fechamos/i)
    const sab = buildOpeningHoursReply(boot.db, tenantId, clock, 'abrem sabado?', 'cnv_h')
    expect(sab).toMatch(/s[aá]bado:\s*09:00/i)
    const full = buildOpeningHoursReply(
      boot.db,
      tenantId,
      clock,
      'qual o horário de funcionamento?',
      'cnv_h',
    )
    expect(full).toContain('segunda:')
    expect(full).toContain('domingo:')
    boot.close()
  })

  it('inclui bloqueios de clínica em pergunta de feriado', () => {
    const clock = createControllableClock(NOW)
    const boot = bootClinicDb({ clock })
    const tenantId = 'clinic-demo-hours-fer'
    seedWindows(boot.db, tenantId, clock)
    createResourceBlock(
      boot.db,
      tenantId,
      {
        resourceId: CLINIC_SCOPE_ID,
        startsAt: NOW + 2 * 24 * 60 * 60 * 1000,
        endsAt: NOW + 2 * 24 * 60 * 60 * 1000 + 8 * 60 * 60 * 1000,
        reason: 'folga',
        note: 'Recesso',
      },
      clock,
    )
    const reply = buildOpeningHoursReply(boot.db, tenantId, clock, 'atendem em feriado?', 'cnv_f')
    expect(reply).toMatch(/Fechamentos programados|Recesso/)
    boot.close()
  })

  it('interpretador não pede extrator em FAQ de expediente', () => {
    const interp = interpretTurn({
      turnText: 'você atende no domingo?',
      messageId: 'm1',
      today: '2026-11-16',
      services: [],
    })
    expect(interp.acts).toContain('informar_horario_funcionamento')
    expect(interp.needsExtractor).toBe(false)
    expect(interp.coverage).toBeGreaterThanOrEqual(COVERAGE_THRESHOLD)
  })

  it('catalogReply cobre typos sem chamar modelo', () => {
    const clock = createControllableClock(NOW)
    const boot = bootClinicDb({ clock })
    const tenantId = 'clinic-demo-catalog-hours'
    seedWindows(boot.db, tenantId, clock)
    const r = catalogReply(boot.db, tenantId, 'Gostaria saber se voce atende j no o domingo?', clock)
    expect(r).toMatch(/domingo/i)
    expect(r).not.toMatch(/n[aã]o entendi/i)
    boot.close()
  })
})

describe('opening-hours latency (FACT vs main+LLM)', () => {
  const LLM_FACT_MS = [
    { label: 'atende domingo (rsamp_1241995755 turno 81→82)', ms: 6106 },
    { label: 'Sim pós domingo com LLM (turno 83→84)', ms: 17338 },
  ]

  it('mede ms do caminho determinístico (FACT) e documenta baseline LLM', () => {
    const clock = createControllableClock(NOW)
    const boot = bootClinicDb({ clock })
    const tenantId = 'clinic-demo-lat'
    seedWindows(boot.db, tenantId, clock)
    const samples: number[] = []
    for (const text of [
      'atende domingo?',
      'que horas fecham?',
      'abrem sabado?',
      'horario de funcionamento',
    ]) {
      const t0 = performance.now()
      const reply = catalogReply(boot.db, tenantId, text, clock)
      samples.push(performance.now() - t0)
      expect(reply).not.toBeNull()
    }
    const avg = samples.reduce((a, b) => a + b, 0) / samples.length
    // FACT: medido neste teste (sem rede, sem LLM)
    expect(avg).toBeLessThan(120)
    // ESTIMATE: após o merge, estes turnos não entram no extrator (needsExtractor false).
    // Baseline com LLM veio do PR #813 (staging), não re-medido aqui.
    expect(LLM_FACT_MS[0]!.ms).toBeGreaterThan(1000)
    boot.close()
  })
})