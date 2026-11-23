import { describe, expect, it } from 'vitest'
import { createControllableClock } from '../../db/clock'
import { setWeeklyWindowsOp, upsertResourceOp } from '../config'
import { createResourceBlock } from '../config/blocks'
import { CLINIC_SCOPE_ID } from '../config/types'
import { workerCaller } from '../index'
import { clinicDayBounds } from '../scheduling/timezone'
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
/** Qui 19/11/2026 20:46 America/Sao_Paulo — reprodução «abrem amanhã?» com feriado 20/11. */
const BUG_NOW = Date.UTC(2026, 10, 19, 23, 46)

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
  it('detecta variantes sem acento, abreviações, feriado e «abre amanhã»', () => {
    expect(isOpeningHoursFaqAsk('atende domingo?')).toBe(true)
    expect(isOpeningHoursFaqAsk('vocês abrem sab?')).toBe(true)
    expect(isOpeningHoursFaqAsk('ate que horas fecham')).toBe(true)
    expect(isOpeningHoursFaqAsk('atendem em feriado?')).toBe(true)
    expect(isOpeningHoursFaqAsk('Vocês abrem amanhã?')).toBe(true)
    expect(isOpeningHoursFaqAsk('quero agendar depilação segunda às 15h')).toBe(false)
  })

  it('marca misto com pedido de marcação no mesmo turno', () => {
    expect(openingHoursMixedWithBooking('quero marcar depilação amanhã, atendem domingo?')).toBe(
      true,
    )
    expect(openingHoursMixedWithBooking('gostaria de saber se atendem domingo')).toBe(false)
    // TRE-77: disponibilidade sem verbo de marcar não é misto — responde expediente + Abrir agenda.
    expect(openingHoursMixedWithBooking('Você pode me atender esta tarde?')).toBe(false)
    expect(openingHoursMixedWithBooking('Você pode-me atender amanhã?')).toBe(false)
    expect(openingHoursMixedWithBooking('tem horário hoje à tarde?')).toBe(false)
    expect(openingHoursMixedWithBooking('Vocês abrem amanhã?')).toBe(false)
    // TRE-60: cumprimento ≠ período — «Boa tarde, tem horário?» não mistura com marcação.
    expect(openingHoursMixedWithBooking('Boa tarde, tem horário?')).toBe(false)
    expect(openingHoursMixedWithBooking('Boa noite, tem vaga?')).toBe(false)
  })

  it('TRE-77: «pode me atender amanhã?» é FAQ de dia (infinitivo) e responde o sábado', () => {
    expect(isOpeningHoursFaqAsk('Você pode-me atender amanhã?')).toBe(true)
    expect(isOpeningHoursFaqAsk('Você pode me atender amanhã?')).toBe(true)
    /** Sex 20/11/2026 16:20 America/Sao_Paulo. */
    const clock = createControllableClock(Date.UTC(2026, 10, 20, 19, 20))
    const boot = bootClinicDb({ clock })
    const tenantId = 'clinic-demo-hours-pode-amanha'
    seedWindows(boot.db, tenantId, clock)
    const reply = buildOpeningHoursReply(
      boot.db,
      tenantId,
      clock,
      'Você pode-me atender amanhã?',
      'cnv_pode',
    )
    expect(reply).toMatch(/amanh[aã]/i)
    expect(reply).toMatch(/s[aá]bado/i)
    expect(reply).toMatch(/09:00/)
    expect(reply).not.toMatch(/serviço|procedimento|equipe confirma/i)
    boot.close()
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

  it('«Vocês abrem amanhã?» com feriado da clínica inteira → fechada (não o expediente semanal)', () => {
    const clock = createControllableClock(BUG_NOW)
    const boot = bootClinicDb({ clock })
    const tenantId = 'clinic-demo-hours-amanha-fer'
    seedWindows(boot.db, tenantId, clock)
    const { dayStartsAt, dayEndsAt } = clinicDayBounds('America/Sao_Paulo', '2026-11-20')
    createResourceBlock(
      boot.db,
      tenantId,
      {
        resourceId: CLINIC_SCOPE_ID,
        startsAt: dayStartsAt,
        endsAt: dayEndsAt,
        reason: 'feriado',
        note: 'Feriado',
      },
      clock,
    )
    const reply = buildOpeningHoursReply(
      boot.db,
      tenantId,
      clock,
      'Vocês abrem amanhã?',
      'cnv_amanha_fer',
    )
    expect(reply).toMatch(/amanh[aã] \(sexta-feira\): fechado/i)
    expect(reply).not.toMatch(/sexta-feira\): 09:00/i)
    expect(reply).toMatch(/s[aá]bado: 09:00/)
    expect(reply).not.toMatch(/est[aá] aberta/i)
    const viaCatalog = catalogReply(boot.db, tenantId, 'Vocês abrem amanhã?', clock, {
      conversationId: 'cnv_amanha_fer',
    })
    expect(viaCatalog).toMatch(/sexta-feira\): fechado/i)
    expect(viaCatalog).not.toMatch(/sexta-feira\): 09:00/i)
    expect(viaCatalog).toMatch(/s[aá]bado: 09:00/)
    boot.close()
  })

  it('«abrem amanhã?» sem bloqueio → expediente da sexta', () => {
    const clock = createControllableClock(BUG_NOW)
    const boot = bootClinicDb({ clock })
    const tenantId = 'clinic-demo-hours-amanha-ok'
    seedWindows(boot.db, tenantId, clock)
    const reply = buildOpeningHoursReply(boot.db, tenantId, clock, 'abrem amanhã?', 'cnv_ok')
    expect(reply).toMatch(/amanh[aã]/i)
    expect(reply).toMatch(/09:00/)
    expect(reply).not.toMatch(/fechad/i)
    boot.close()
  })

  it('«está atendendo hoje?» com feriado no próprio dia → fechada (não o expediente)', () => {
    /** Sex 20/11/2026 09:23 America/Sao_Paulo — evidência feriado-contradicao. */
    const clock = createControllableClock(Date.UTC(2026, 10, 20, 12, 23))
    const boot = bootClinicDb({ clock })
    const tenantId = 'clinic-demo-hours-hoje-fer'
    seedWindows(boot.db, tenantId, clock)
    const { dayStartsAt, dayEndsAt } = clinicDayBounds('America/Sao_Paulo', '2026-11-20')
    createResourceBlock(
      boot.db,
      tenantId,
      {
        resourceId: CLINIC_SCOPE_ID,
        startsAt: dayStartsAt,
        endsAt: dayEndsAt,
        reason: 'feriado',
        note: 'Feriado',
      },
      clock,
    )
    const text = 'Bom dia. Gostaria de saber se está atendendo hoje?'
    expect(isOpeningHoursFaqAsk(text)).toBe(true)
    const reply = buildOpeningHoursReply(boot.db, tenantId, clock, text, 'cnv_hoje_fer')
    expect(reply).toMatch(/hoje \(sexta-feira\): fechado/i)
    expect(reply).not.toMatch(/sexta-feira\): 09:00/i)
    expect(reply).toMatch(/amanh[aã] \(s[aá]bado\): 09:00/)
    expect(reply).not.toMatch(/estamos atendendo/i)
    const viaCatalog = catalogReply(boot.db, tenantId, text, clock, {
      conversationId: 'cnv_hoje_fer',
    })
    expect(viaCatalog).toMatch(/hoje \(sexta-feira\): fechado/i)
    expect(viaCatalog).not.toMatch(/sexta-feira\): 09:00/i)
    expect(viaCatalog).toMatch(/s[aá]bado\): 09:00/)
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