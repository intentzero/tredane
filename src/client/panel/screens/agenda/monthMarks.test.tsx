import { describe, expect, it } from 'vitest'
import type { AgendaAppointmentItem, ScheduleHold } from '../../api'
import { agendaDayMarkLabel, agendaMonthMarks } from './monthMarks'

const TZ = 'America/Sao_Paulo'

function apt(partial: Partial<AgendaAppointmentItem> & Pick<AgendaAppointmentItem, 'id' | 'startsAt'>): AgendaAppointmentItem {
  return {
    serviceId: 'svc',
    serviceName: 'Massagem',
    professionalId: 'p1',
    professionalName: 'Gi',
    roomResourceId: 'r1',
    roomResourceName: 'Sala',
    endsAt: partial.startsAt + 60 * 60_000,
    occupiesUntil: partial.startsAt + 60 * 60_000,
    status: 'confirmed',
    contactLabel: 'Ana',
    contactId: null,
    conversationId: null,
    opportunityId: null,
    version: 1,
    changeReason: null,
    ...partial,
  }
}

function hold(partial: Partial<ScheduleHold> & Pick<ScheduleHold, 'id' | 'windowStartsAt'>): ScheduleHold {
  return {
    status: 'active',
    opportunityId: null,
    conversationId: 'c1',
    contactId: 'ct1',
    contactName: 'Ana',
    serviceId: 'svc',
    serviceName: 'Massagem',
    professionalId: 'p1',
    professionalName: 'Gi',
    durationMinutes: 60,
    windowEndsAt: partial.windowStartsAt + 3 * 60 * 60_000,
    confirmBy: null,
    appointmentId: null,
    responsibleClerkUserId: null,
    responsibleDisplayName: null,
    createdAt: partial.windowStartsAt,
    updatedAt: partial.windowStartsAt,
    resolvedAt: null,
    expiredAt: null,
    cancelledAt: null,
    alertDismissedAt: null,
    ...partial,
  }
}

const day4 = Date.UTC(2026, 10, 4, 13, 0, 0)
const day11 = Date.UTC(2026, 10, 11, 13, 0, 0)
const day20 = Date.UTC(2026, 10, 20, 13, 0, 0)

describe('agendaMonthMarks', () => {
  it('uma marcação e várias contam no mesmo dia, sem distinguir a quantidade na chave', () => {
    const counts = agendaMonthMarks(
      [
        apt({ id: 'a', startsAt: day4 }),
        apt({ id: 'b', startsAt: day11, professionalId: 'p2', roomResourceId: 'r2' }),
        apt({ id: 'c', startsAt: day11 + 60 * 60_000, professionalId: 'p2', roomResourceId: 'r2' }),
        apt({ id: 'd', startsAt: day11 + 2 * 60 * 60_000, professionalId: 'p1', roomResourceId: 'r1' }),
      ],
      [],
      TZ,
      [],
      [],
    )
    expect(counts.get('2026-11-04')).toBe(1)
    expect(counts.get('2026-11-11')).toBe(3)
    expect(counts.has('2026-11-18')).toBe(false)
  })

  it('ignora canceladas e reservas que não estão activas', () => {
    const counts = agendaMonthMarks(
      [apt({ id: 'x', startsAt: day4, status: 'cancelled' })],
      [
        hold({ id: 'h1', windowStartsAt: day20, status: 'cancelled' }),
        hold({ id: 'h2', windowStartsAt: day20, status: 'resolved' }),
      ],
      TZ,
      [],
      [],
    )
    expect(counts.size).toBe(0)
  })

  it('reserva por período conta; filtro de sala tira a reserva e o compromisso de outra sala', () => {
    const appointments = [apt({ id: 'a', startsAt: day4, roomResourceId: 'r1' })]
    const holds = [hold({ id: 'h', windowStartsAt: day20, professionalId: 'p1' })]
    const all = agendaMonthMarks(appointments, holds, TZ, [], [])
    expect(all.get('2026-11-04')).toBe(1)
    expect(all.get('2026-11-20')).toBe(1)

    const room = agendaMonthMarks(appointments, holds, TZ, [], ['r2'])
    expect(room.size).toBe(0)

    const pro = agendaMonthMarks(appointments, holds, TZ, ['p2'], [])
    expect(pro.size).toBe(0)
  })
})

describe('agendaDayMarkLabel', () => {
  it('diz sem marcações, 1 marcação ou N marcações', () => {
    expect(agendaDayMarkLabel(0)).toBe('sem marcações')
    expect(agendaDayMarkLabel(1)).toBe('1 marcação')
    expect(agendaDayMarkLabel(3)).toBe('3 marcações')
  })
})
