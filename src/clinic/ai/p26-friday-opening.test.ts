/**
 * P26 — próxima abertura e FAQ de expediente no mesmo expediente (profissionais +
 * fechamento da clínica). Sem bloqueio, sexta conta: qui 21:42 → sex 09:00;
 * sex 08:55 → hoje 09:00. Com feriado da clínica inteira na sexta, os dois
 * caminhos dizem fechado e a próxima abertura é sábado.
 */
import { describe, expect, it } from 'vitest'
import { createControllableClock } from '../../db/clock'
import { setWeeklyWindowsOp, upsertResourceOp } from '../config'
import { createResourceBlock } from '../config/blocks'
import { CLINIC_SCOPE_ID } from '../config/types'
import { workerCaller } from '../index'
import { clinicDayBounds } from '../scheduling/timezone'
import { bootClinicDb } from '../test-db'
import { isClinicOpenForHandoff, nextClinicOpening } from './human-handoff'
import { buildOpeningHoursReply } from './opening-hours-reply'
import { buildClinicAiContext } from './schedule-context'

/** Qui 19/11/2026 21:42 America/Sao_Paulo. */
const THU_2142 = Date.UTC(2026, 10, 20, 0, 42)
/** Sex 20/11/2026 08:55 America/Sao_Paulo. */
const FRI_0855 = Date.UTC(2026, 10, 20, 11, 55)
/** Sex 20/11/2026 10:00 America/Sao_Paulo. */
const FRI_1000 = Date.UTC(2026, 10, 20, 13, 0)

function seed(nowMs: number, opts?: { fridayHoliday?: boolean }) {
  const clock = createControllableClock(nowMs)
  const boot = bootClinicDb({ clock })
  const tenantId = 'clinic-demo-p26'
  const caller = workerCaller(tenantId)
  const pro = upsertResourceOp(boot.db, caller, { kind: 'professional', name: 'Ana' }, clock)
  setWeeklyWindowsOp(
    boot.db,
    caller,
    {
      resourceId: pro.id,
      windows: [1, 2, 3, 4, 5].flatMap((d) => [
        { dayOfWeek: d, startMinute: 9 * 60, endMinute: 12 * 60 },
        { dayOfWeek: d, startMinute: 13 * 60, endMinute: 18 * 60 },
      ]).concat([{ dayOfWeek: 6, startMinute: 9 * 60, endMinute: 12 * 60 }]),
    },
    clock,
  )
  if (opts?.fridayHoliday) {
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
  }
  return { db: boot.db, tenantId, clock, close: boot.close }
}

describe('P26 — sexta no expediente e no handoff', () => {
  it('qui 21:42 com sexta aberta → próxima abertura sexta 09:00', async () => {
    const s = seed(THU_2142)
    try {
      expect(nextClinicOpening(s.db, s.tenantId, s.clock)).toEqual({
        dayLabel: 'amanhã',
        time: '09:00',
      })
      const reply = buildOpeningHoursReply(s.db, s.tenantId, s.clock, 'Vocês abrem amanhã?', 'cnv_p26')
      expect(reply).toMatch(/amanh[aã] \(sexta-feira\)/i)
      expect(reply).toMatch(/09:00/)
      expect(reply).not.toMatch(/fechad/i)
      const { clinic } = await buildClinicAiContext(s.db, s.tenantId, s.clock, {
        contactId: 'c-p26',
        recentTexts: [],
        agendaMode: 'hours',
      })
      const hours = clinic.openingHours.join('\n')
      expect(hours).toMatch(/sexta: 09:00–12:00 e 13:00–18:00/)
      expect(hours).not.toMatch(/Fechamento/)
    } finally {
      s.close()
    }
  })

  it('sex 08:55 antes de abrir → a equipe responde hoje às 09:00', async () => {
    const s = seed(FRI_0855)
    try {
      expect(isClinicOpenForHandoff(s.db, s.tenantId, s.clock)).toBe(false)
      expect(nextClinicOpening(s.db, s.tenantId, s.clock)).toEqual({
        dayLabel: 'hoje',
        time: '09:00',
      })
      const reply = buildOpeningHoursReply(
        s.db,
        s.tenantId,
        s.clock,
        'Gostaria de saber se está atendendo hoje?',
        'cnv_p26_hoje',
      )
      expect(reply).toMatch(/hoje \(sexta-feira\)/i)
      expect(reply).toMatch(/09:00/)
      expect(reply).not.toMatch(/fechad|vaga|horário livre/i)
    } finally {
      s.close()
    }
  })

  it('feriado da clínica na sexta: handoff, FAQ e contexto da IA concordam', async () => {
    const thu = seed(THU_2142, { fridayHoliday: true })
    try {
      expect(nextClinicOpening(thu.db, thu.tenantId, thu.clock)).toEqual({
        dayLabel: 'sábado 21/11',
        time: '09:00',
      })
      const reply = buildOpeningHoursReply(thu.db, thu.tenantId, thu.clock, 'abrem amanhã?', 'cnv_fer')
      expect(reply).toMatch(/amanh[aã] \(sexta-feira\): fechado/i)
      const { clinic } = await buildClinicAiContext(thu.db, thu.tenantId, thu.clock, {
        contactId: 'c-p26',
        recentTexts: [],
        agendaMode: 'hours',
      })
      expect(clinic.openingHours.join('\n')).toMatch(/Fechamento amanhã 20\/11: fechado \(Feriado\)/)
    } finally {
      thu.close()
    }

    const fri = seed(FRI_0855, { fridayHoliday: true })
    try {
      expect(nextClinicOpening(fri.db, fri.tenantId, fri.clock)).toEqual({
        dayLabel: 'amanhã',
        time: '09:00',
      })
      const open = seed(FRI_1000)
      expect(isClinicOpenForHandoff(open.db, open.tenantId, open.clock)).toBe(true)
      open.close()
      const closed = seed(FRI_1000, { fridayHoliday: true })
      expect(isClinicOpenForHandoff(closed.db, closed.tenantId, closed.clock)).toBe(false)
      closed.close()
    } finally {
      fri.close()
    }
  })
})
