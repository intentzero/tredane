/** Respostas de catálogo sem modelo: almoço, duração, sala, zona e intervalo. */
import { describe, expect, it } from 'vitest'
import { createControllableClock } from '../../db/clock'
import { replaceServiceZonesOp, setWeeklyWindowsOp, upsertResourceOp, upsertServiceOp } from '../config'
import { workerCaller } from '../index'
import { bootClinicDb } from '../test-db'
import { catalogReply } from './catalog-reply'
import { formatOpeningHours } from './schedule-context'
import { handoffReason } from './human-handoff'

const NOW = Date.UTC(2026, 9, 30, 21, 0)

describe('catalogReply', () => {
  it('mantém o vão do almoço e responde preço, sala, zona e intervalo', () => {
    const clock = createControllableClock(NOW)
    const boot = bootClinicDb({ clock })
    const tenantId = 'clinic-demo-a'
    const caller = workerCaller(tenantId)
    const room = upsertResourceOp(boot.db, caller, { kind: 'room', name: 'Sala Depilação', category: 'Sala' }, clock)
    const gi = upsertResourceOp(boot.db, caller, { kind: 'professional', name: 'Gi' }, clock)
    const sandra = upsertResourceOp(boot.db, caller, { kind: 'professional', name: 'Sandra' }, clock)
    const svc = upsertServiceOp(
      boot.db,
      caller,
      {
        name: 'Depilação',
        durationMinutes: 15,
        bufferMinutes: 15,
        priceCents: 5000,
        variantKind: 'Zona',
        variantKindPlural: 'Zonas',
        professionalIds: [gi.id],
        roomRequirement: { mode: 'rooms', resourceIds: [room.id] },
      },
      clock,
    )
    replaceServiceZonesOp(
      boot.db,
      caller,
      svc.id,
      [
        { name: 'Axila masculina', durationMinutes: 15, priceCents: 5000, audience: 'masculino' },
        { name: 'Pernas masculinas', durationMinutes: 30, priceCents: 14000, audience: 'masculino' },
      ],
      clock,
    )
    setWeeklyWindowsOp(
      boot.db,
      caller,
      {
        resourceId: gi.id,
        windows: [1, 2, 3, 4, 5].flatMap((d) => [
          { dayOfWeek: d, startMinute: 9 * 60, endMinute: 12 * 60 },
          { dayOfWeek: d, startMinute: 13 * 60, endMinute: 18 * 60 },
        ]),
      },
      clock,
    )
    const hours = formatOpeningHours([
      { dayOfWeek: 1, startMinute: 9 * 60, endMinute: 12 * 60 },
      { dayOfWeek: 1, startMinute: 13 * 60, endMinute: 18 * 60 },
    ])
    expect(hours[0]).toBe('segunda: 09:00–12:00 e 13:00–18:00')
    const open = catalogReply(boot.db, tenantId, 'Qual o horário de funcionamento da clínica?', clock)
    expect(open).toContain('09:00–12:00 e 13:00–18:00')
    expect(open).not.toContain('09:00–18:00')

    expect(catalogReply(boot.db, tenantId, 'Quanto custa a axila masculina e quanto tempo dura?', clock)).toBe(
      'Axila masculina custa R$ 50,00 e dura 15 min.',
    )
    expect(catalogReply(boot.db, tenantId, 'Quem faz a depilação e em qual sala?', clock)).toContain('Gi')
    expect(catalogReply(boot.db, tenantId, 'Quem faz a depilação e em qual sala?', clock)).toContain('Sala Depilação')
    expect(catalogReply(boot.db, tenantId, 'Quero depilação amanhã à tarde.', clock)).toMatch(/qual/i)
    expect(catalogReply(boot.db, tenantId, 'Quero depilação amanhã à tarde.', clock)).not.toMatch(/13:00/)
    const both = catalogReply(
      boot.db,
      tenantId,
      'Se eu fizer axila masculina e pernas masculinas juntas, qual o preço e a duração?',
      clock,
    )
    expect(both).toContain('R$ 190,00')
    expect(both).toContain('45 min')
    expect(both).toContain('15 min')
    expect(handoffReason(boot.db, tenantId, 'Quero marcar com a Sandra.', clock)).toBe('human_only')
    expect(handoffReason(boot.db, tenantId, 'Quero com a Gi.', clock)).toBeNull()
    void sandra
    boot.close()
  })
})
