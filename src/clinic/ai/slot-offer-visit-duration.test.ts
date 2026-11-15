/**
 * Dia pedido sem bloco para duração total (várias zonas), mas com vaga para uma zona.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { createControllableClock } from '../../db/clock'
import {
  replaceServiceZonesOp,
  setWeeklyWindowsOp,
  upsertResourceOp,
  upsertServiceOp,
} from '../config'
import { workerCaller } from '../index'
import { confirmAppointmentOp, zonedCivilToUtc } from '../scheduling'
import { bootClinicDb } from '../test-db'
import { offerNearestSlots } from './slot-offer'
import { setDialogueVariantForTests } from './dialogue-acts'

const TZ = 'America/Sao_Paulo'
/** Sábado 15/11/2026 10:00 SP — terça seguinte 17/11. */
const NOW = Date.UTC(2026, 10, 15, 13, 0)
const TERCA = '2026-11-17'

const MALE_ZONES = [
  'Axila',
  'Pernas',
  'Tórax e Abdômen',
  'Costas',
  'Braços',
  'Intima',
  'Orelha',
].map((name) => ({
  name,
  audience: 'masculino' as const,
  durationMinutes: 15,
  priceCents: 5000,
}))

afterEach(() => setDialogueVariantForTests(null))

function seedWithMorningBlock() {
  const clock = createControllableClock(NOW)
  const boot = bootClinicDb({ clock })
  const { db } = boot
  const tenantId = 'clinic-demo-slot-visit-duration'
  const caller = workerCaller(tenantId, 'user_synth_owner_a')
  const room = upsertResourceOp(db, caller, { kind: 'room', name: 'Sala', category: 'Sala' }, clock)
  const pro = upsertResourceOp(db, caller, { kind: 'professional', name: 'Gi', homeRoomId: room.id }, clock)
  const depil = upsertServiceOp(
    db,
    caller,
    {
      name: 'Depilação',
      durationMinutes: 30,
      bufferMinutes: 0,
      priceCents: null,
      variantKind: 'zona',
      variantKindPlural: 'zonas',
      variantSelection: 'varias',
      professionalIds: [pro.id],
      roomRequirement: { mode: 'none' },
    },
    clock,
  )
  const zones = replaceServiceZonesOp(db, caller, depil.id, MALE_ZONES, clock)
  const massagem = upsertServiceOp(
    db,
    caller,
    {
      name: 'Massagem',
      durationMinutes: 90,
      bufferMinutes: 0,
      priceCents: 12_000,
      variantKind: 'tipo',
      variantKindPlural: 'tipos',
      variantSelection: 'uma',
      professionalIds: [pro.id],
      roomRequirement: { mode: 'none' },
    },
    clock,
  )
  const week = [1, 2, 3, 4, 5].map((d) => ({
    dayOfWeek: d,
    startMinute: 9 * 60,
    endMinute: 12 * 60,
  }))
  setWeeklyWindowsOp(db, caller, { resourceId: pro.id, windows: week }, clock)
  setWeeklyWindowsOp(db, caller, { resourceId: room.id, windows: week }, clock)
  // Ocupa 9:00–10:30 na terça: sobra <105 min contínuos, mas 15 min (uma zona) cabe.
  confirmAppointmentOp(
    db,
    caller,
    {
      clientRequestId: 'block-terca-manha',
      serviceId: massagem.id,
      professionalId: pro.id,
      startsAt: zonedCivilToUtc(TZ, 2026, 11, 17, 9, 0),
      contactId: 'ct_block',
      conversationId: 'cnv_block',
      actorClerkUserId: caller.actorId!,
    },
    clock,
  )
  return { boot, db, tenantId, caller, depil, zones, pro }
}

describe('offerNearestSlots — visita longa no dia pedido', () => {
  it('7 zonas (105 min) na terça: avisa dividir ou outro dia; subset (1 zona) oferta na terça', async () => {
    setDialogueVariantForTests(0)
    const s = seedWithMorningBlock()
    try {
      const all = await offerNearestSlots({
        db: s.db,
        tenantId: s.tenantId,
        service: s.depil,
        zones: s.zones,
        tz: TZ,
        clock: s.boot.clock,
        professionalId: s.pro.id,
        date: TERCA,
        conversationId: 'cnv_visit_duration',
      })
      expect(all.replyText).toMatch(/não cabem as 7 zonas/i)
      expect(all.replyText).toMatch(/dividir em 2 visitas/i)
      expect(all.replyText).toMatch(/terça 17\/11/i)
      expect(all.replyText).toMatch(/\d{1,2}:\d{2}/)
      expect(all.clearDate).toBe(false)

      const one = await offerNearestSlots({
        db: s.db,
        tenantId: s.tenantId,
        service: s.depil,
        zones: [s.zones[0]!],
        tz: TZ,
        clock: s.boot.clock,
        professionalId: s.pro.id,
        date: TERCA,
        conversationId: 'cnv_one_zone',
      })
      expect(one.slots.some((slot) => slot.date === TERCA)).toBe(true)
      expect(one.replyText).toMatch(/disponíveis para terça 17\/11/i)
      expect(one.replyText).not.toMatch(/não cabem as/i)
    } finally {
      s.boot.close()
    }
  })
})