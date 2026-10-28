import { describe, expect, it } from 'vitest'
import type { AgendaAppointmentItem } from '../../api'
import { buildDayEntries, initialsOf, shortName } from './dayList'

const H = 3_600_000
const BASE = Date.UTC(2026, 9, 30, 12, 0, 0)

function apt(id: string, startH: number, durH: number, room: string | null, prof = 'p1'): AgendaAppointmentItem {
  return {
    id,
    serviceId: 's1',
    serviceName: 'Drenagem',
    professionalId: prof,
    professionalName: 'Bruna',
    roomResourceId: room,
    roomResourceName: room ? 'Sala Bem-estar' : null,
    startsAt: BASE + startH * H,
    endsAt: BASE + (startH + durH) * H,
    occupiesUntil: BASE + (startH + durH) * H,
    status: 'confirmed',
    contactLabel: id,
    contactId: null,
    conversationId: null,
    opportunityId: null,
    version: 1,
    changeReason: null,
  }
}

describe('lista do dia', () => {
  it('sala de 1 lugar fica como compromisso solto; sala compartilhada agrupa a faixa', () => {
    const items = [
      apt('a', 0, 1, 'sala1'),
      apt('b', 1, 1, 'sala3'),
      apt('c', 1.25, 1, 'sala3', 'p2'),
      apt('d', 4, 1, 'sala3'),
    ]
    const caps = new Map([['sala1', 1], ['sala3', 3]])
    const out = buildDayEntries(items, caps, null)
    expect(out.map((e) => e.kind)).toEqual(['apt', 'room', 'room'])
    const first = out[1]!
    if (first.kind !== 'room') throw new Error('esperava sala')
    expect(first.items.map((i) => i.id)).toEqual(['b', 'c'])
    expect(first.peak).toBe(2)
    expect(first.capacity).toBe(3)
  })

  it('marca «agora» antes do próximo horário e no fim quando já passou tudo', () => {
    const items = [apt('a', 0, 1, null), apt('b', 3, 1, null)]
    const mid = buildDayEntries(items, new Map(), BASE + 2 * H)
    expect(mid.map((e) => e.kind)).toEqual(['apt', 'now', 'apt'])
    const end = buildDayEntries(items, new Map(), BASE + 9 * H)
    expect(end.map((e) => e.kind)).toEqual(['apt', 'apt', 'now'])
  })

  it('iniciais e nome curto ignoram o título', () => {
    expect(initialsOf('Dra. Paula')).toBe('PA')
    expect(initialsOf('Lívia')).toBe('LÍ')
    expect(initialsOf('Maria Souza')).toBe('MS')
    expect(shortName('Dr. Tiago')).toBe('Tiago')
  })
})
