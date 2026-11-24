import { describe, expect, it } from 'vitest'
import { createControllableClock } from '../db/clock'
import { workerCaller } from '../clinic'
import { bootClinicDb } from '../clinic/test-db'
import { setWeeklyWindowsOp, upsertResourceOp, upsertServiceOp } from '../clinic/config'
import { confirmAppointmentOp, zonedCivilToUtc } from '../clinic/scheduling'
import { pickClientWebSlots, resolveWhen, type PickRequest } from './pick'

const TENANT = 'clinic-demo-a'
const TZ = 'America/Sao_Paulo'
/** Segunda 08/01/2024, hora de Brasília. */
const at = (h: number, m = 0, plusDays = 0) => zonedCivilToUtc(TZ, 2024, 1, 8 + plusDays, h, m)

/** Segunda 08/01/2024 `h:m` (Brasília); expediente 09–18, duas profissionais, serviço de 30 min. */
function seed(nowH: number, nowM = 0, leadMinutes = 0) {
  const clock = createControllableClock(at(nowH, nowM))
  const { db, close } = bootClinicDb({ clock })
  const caller = workerCaller(TENANT, 'user_synth_owner_a')
  const room = upsertResourceOp(db, caller, { kind: 'room', name: 'Sala 1', capacity: 2 }, clock)
  const week = [1, 2].map((d) => ({ dayOfWeek: d, startMinute: 9 * 60, endMinute: 18 * 60 }))
  setWeeklyWindowsOp(db, caller, { resourceId: room.id, windows: week }, clock)
  const gi = upsertResourceOp(db, caller, { kind: 'professional', name: 'Gi', homeRoomId: room.id }, clock)
  const paula = upsertResourceOp(db, caller, { kind: 'professional', name: 'Paula', homeRoomId: room.id }, clock)
  for (const p of [gi, paula]) setWeeklyWindowsOp(db, caller, { resourceId: p.id, windows: week }, clock)
  const svc = upsertServiceOp(
    db,
    caller,
    { name: 'Limpeza', durationMinutes: 30, bufferMinutes: 0, professionalIds: [gi.id, paula.id], roomRequirement: { mode: 'none' } },
    clock,
  )
  db.run(`UPDATE clinic_settings SET booking_lead_minutes = ? WHERE id = 1`, leadMinutes)
  let n = 0
  const book = (proId: string, startsAt: number) =>
    confirmAppointmentOp(
      db,
      caller,
      {
        clientRequestId: `req-${(n += 1)}`,
        serviceId: svc.id,
        professionalId: proId,
        startsAt,
        durationMinutesOverride: null,
        actorClerkUserId: 'user_synth_owner_a',
        applyBookingLead: false,
      },
      clock,
    )
  return { db, close, clock, gi, paula, svc, book }
}

const pick = (s: ReturnType<typeof seed>, req: PickRequest & { professionalId?: string | null }) =>
  pickClientWebSlots(s.db, TENANT, s.clock, { serviceId: s.svc.id, variantIds: [], ...req })

describe('resolveWhen (DEC-227)', () => {
  const ctx = { timezone: TZ, today: '2024-01-08' }
  it('mapeia cada conveniência para um dia e uma janela', () => {
    const now = at(10, 7)
    expect(resolveWhen('agora', ctx, now)).toEqual({ date: '2024-01-08', fromMs: now, toMs: now + 120 * 60_000 })
    expect(resolveWhen('hoje_manha', ctx, now)).toMatchObject({ date: '2024-01-08', fromMs: at(0), toMs: at(12) })
    expect(resolveWhen('hoje_tarde', ctx, now)).toMatchObject({ fromMs: at(12), toMs: at(18) })
    expect(resolveWhen('amanha', ctx, now).date).toBe('2024-01-09')
    expect(resolveWhen('amanha_manha', ctx, now)).toMatchObject({ date: '2024-01-09', fromMs: at(0, 0, 1), toMs: at(12, 0, 1) })
    expect(resolveWhen({ date: '2024-01-10', dayPart: 'tarde' }, ctx, now)).toMatchObject({ date: '2024-01-10' })
  })
})

describe('pickClientWebSlots', () => {
  it('dia sem marcações: 3 horas a 30 min ou mais umas das outras, nunca a grade inteira', () => {
    const s = seed(8)
    try {
      const r = pick(s, { when: 'hoje_tarde' })
      expect(r.ok && r.slots.map((x) => x.time)).toEqual(['12:00', '12:30', '13:00'])
      // Há vagas de manhã no mesmo dia: «Mais cedo» aparece.
      expect(r.ok && r.hasEarlier).toBe(true)
      expect(r.ok && r.hasLater).toBe(true)
    } finally {
      s.close()
    }
  })

  it('marcação confirmada às 14:00 atrai 13:30 e 14:30 (mesma profissional)', () => {
    const s = seed(8)
    try {
      s.book(s.gi.id, at(14))
      const r = pick(s, { when: 'hoje_tarde', professionalId: s.gi.id })
      expect(r.ok && r.slots.map((x) => x.time)).toEqual(expect.arrayContaining(['13:30', '14:30']))
    } finally {
      s.close()
    }
  })

  it('«Sem preferência»: a gravidade escolhe a profissional com marcação colada, não o rodízio', () => {
    const s = seed(8)
    try {
      s.book(s.paula.id, at(14))
      const r = pick(s, { when: 'hoje_tarde' })
      expect(r.ok && r.slots.map((x) => x.time)).toEqual(expect.arrayContaining(['13:30', '14:30']))
    } finally {
      s.close()
    }
  })

  it('hora pedida e livre sai primeiro, mesmo longe de qualquer marcação', () => {
    const s = seed(8)
    try {
      s.book(s.gi.id, at(14))
      const r = pick(s, { when: { date: '2024-01-08' }, requestedTime: '10:15' })
      expect(r.ok && r.slots.map((x) => x.time)).toContain('10:15')
    } finally {
      s.close()
    }
  })

  it('«Mais cedo» / «Mais tarde»: as 3 vagas seguintes do mesmo dia, sem repetir', () => {
    const s = seed(8)
    try {
      const a = pick(s, { when: 'hoje_tarde' })
      expect(a.ok && a.slots.map((x) => x.time)).toEqual(['12:00', '12:30', '13:00'])
      const later = pick(s, { when: 'hoje_tarde', direction: 'later', pivot: '13:00' })
      expect(later.ok && later.slots.map((x) => x.time)).toEqual(['13:30', '14:00', '14:30'])
      expect(later.ok && later.hasEarlier).toBe(true)
      const earlier = pick(s, { when: 'hoje_tarde', direction: 'earlier', pivot: '12:00' })
      // Mais cedo atravessa o período: vem da manhã do mesmo dia.
      expect(earlier.ok && earlier.slots.map((x) => x.time)).toEqual(['10:30', '11:00', '11:30'])
      expect(earlier.ok && earlier.hasLater).toBe(true)
    } finally {
      s.close()
    }
  })

  it('«Agora» com antecedência de 60 min explica o corte: o mais cedo possível', () => {
    const s = seed(10, 7, 60)
    try {
      const r = pick(s, { when: 'agora' })
      expect(r.ok && r.slots[0]?.time).toBe('11:15')
      expect(r.ok && r.earliestPossible).toBe('11:15')
    } finally {
      s.close()
    }
  })

  it('sem antecedência não há aviso', () => {
    const s = seed(10, 7, 0)
    try {
      const r = pick(s, { when: 'agora' })
      expect(r.ok && r.slots[0]?.time).toBe('10:15')
      expect(r.ok && r.earliestPossible).toBeNull()
    } finally {
      s.close()
    }
  })

  it('período sem vaga: motivo e próximo livre', () => {
    const s = seed(13)
    try {
      const r = pick(s, { when: 'hoje_manha' })
      expect(r.ok && r.slots).toEqual([])
      expect(r.ok && r.emptyReason).toBe('past')
      expect(r.ok && r.nextAvailable?.date).toBe('2024-01-08')
    } finally {
      s.close()
    }
  })

  it('chips de hoje só com vaga', () => {
    const s = seed(16, 50)
    try {
      const r = pick(s, { when: 'amanha', wantChips: true })
      // 16:00: «Hoje à tarde» repetiria «Agora» e some; amanhã tem os dois períodos.
      expect(r.ok && r.chips).toEqual({ agora: true, hojeManha: false, hojeTarde: false, amanhaManha: true, amanhaTarde: true })
    } finally {
      s.close()
    }
  })

  it('fora do horizonte → range_invalid; profissional fora do serviço → professional_invalid', () => {
    const s = seed(8)
    try {
      expect(pick(s, { when: { date: '2024-03-30' } })).toEqual({ ok: false, error: 'range_invalid' })
      expect(pick(s, { when: 'amanha', professionalId: 'nao-existe' })).toEqual({ ok: false, error: 'professional_invalid' })
    } finally {
      s.close()
    }
  })
})
