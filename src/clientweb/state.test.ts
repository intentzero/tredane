import { describe, expect, it } from 'vitest'
import { createControllableClock } from '../db/clock'
import { workerCaller } from '../clinic'
import { bootClinicDb } from '../clinic/test-db'
import {
  replaceServiceCombosOp,
  replaceServiceZonesOp,
  setAiProfileOp,
  setWeeklyWindowsOp,
  upsertResourceOp,
  upsertServiceOp,
} from '../clinic/config'
import { upsertContact } from '../clinic/contacts'
import { createConversation } from '../clinic/inbox/conversations'
import { ensureOpenOpportunity } from '../clinic/pipeline/operations'
import { confirmAppointmentOp, zonedCivilToUtc } from '../clinic/scheduling'
import { readClientWebState } from './state'

const TZ = 'America/Sao_Paulo'
const TENANT = 'clinic-demo-a'

function seed() {
  const clock = createControllableClock(Date.UTC(2024, 0, 1))
  const { db, close } = bootClinicDb({ clock })
  const caller = workerCaller(TENANT, 'user_synth_owner_a')
  const room = upsertResourceOp(db, caller, { kind: 'room', name: 'Sala 2', category: 'Sala com laser' }, clock)
  const pro = upsertResourceOp(db, caller, { kind: 'professional', name: 'Dra. Paula Reis', homeRoomId: room.id }, clock)
  const svc = upsertServiceOp(
    db,
    caller,
    {
      name: 'Limpeza de pele',
      durationMinutes: 60,
      bufferMinutes: 0,
      priceCents: 12_000,
      professionalIds: [pro.id],
      roomRequirement: { mode: 'rooms', resourceIds: [room.id] },
    },
    clock,
  )
  for (const resourceId of [pro.id, room.id]) {
    setWeeklyWindowsOp(db, caller, { resourceId, windows: [{ dayOfWeek: 1, startMinute: 9 * 60, endMinute: 18 * 60 }] }, clock)
  }
  const marina = upsertContact(db, { tenantId: TENANT, waId: '5511900001111', displayName: 'Marina Souza' }, clock)
  const outra = upsertContact(db, { tenantId: TENANT, waId: '5511900002222', displayName: 'Outra Pessoa' }, clock)
  const cnvMarina = createConversation(db, { tenantId: TENANT, contactId: marina.id, status: 'open' }, clock)
  const cnvOutra = createConversation(db, { tenantId: TENANT, contactId: outra.id, status: 'open' }, clock)
  const book = (contactId: string, conversationId: string, hour: number, key: string) => {
    const opp = ensureOpenOpportunity(db, { tenantId: TENANT, contactId, conversationId }, clock).opportunity
    return confirmAppointmentOp(
      db,
      caller,
      {
        clientRequestId: key,
        serviceId: svc.id,
        professionalId: pro.id,
        roomResourceId: room.id,
        startsAt: zonedCivilToUtc(TZ, 2024, 1, 8, hour, 0),
        contactId,
        conversationId,
        opportunityId: opp.id,
        actorClerkUserId: 'user_synth_owner_a',
      },
      clock,
    ).value
  }
  return { db, clock, close, marina, outra, cnvMarina, cnvOutra, book, pro, svc, room, caller }
}

describe('readClientWebState (ADR-0018)', () => {
  it('devolve o primeiro nome e só as marcações futuras do próprio contacto', () => {
    const { db, clock, close, marina, outra, cnvMarina, cnvOutra, book } = seed()
    try {
      const minha = book(marina.id, cnvMarina.id, 10, 'req-marina')
      book(outra.id, cnvOutra.id, 14, 'req-outra')
      const state = readClientWebState(db, clock, {
        tenantId: TENANT,
        contactId: marina.id,
        conversationId: cnvMarina.id,
      })
      expect(state?.firstName).toBe('Marina')
      expect(state?.timezone).toBe(TZ)
      expect(state?.appointments.map((a) => a.id)).toEqual([minha.id])
      expect(state?.appointments[0]?.serviceName).toBe('Limpeza de pele')
      expect(state?.appointments[0]).toMatchObject({
        zoneNames: [],
        comboName: null,
        priceCents: 12_000,
      })
      expect(JSON.stringify(state)).not.toMatch(/5511900/)
    } finally {
      close()
    }
  })

  it('expõe zonas e preço (ou combo) a partir dos snapshots da visita (TRE-92)', () => {
    const { db, clock, close, marina, cnvMarina, pro, room, caller } = seed()
    try {
      const laser = upsertServiceOp(
        db,
        caller,
        {
          name: 'Depilação a laser',
          durationMinutes: 60,
          bufferMinutes: 0,
          priceCents: null,
          variantKind: 'Zona',
          variantKindPlural: 'Zonas',
          professionalIds: [pro.id],
          roomRequirement: { mode: 'rooms', resourceIds: [room.id] },
        },
        clock,
      )
      const zones = replaceServiceZonesOp(
        db,
        caller,
        laser.id,
        [
          { name: 'Axilas', durationMinutes: 15, priceCents: 9_000, audience: 'ambos' },
          { name: 'Virilha', durationMinutes: 30, priceCents: 14_000, audience: 'ambos' },
          { name: 'Buço', durationMinutes: 10, priceCents: 5_000, audience: 'ambos' },
        ],
        clock,
      )
      const opp = ensureOpenOpportunity(
        db,
        { tenantId: TENANT, contactId: marina.id, conversationId: cnvMarina.id },
        clock,
      ).opportunity
      const zoned = confirmAppointmentOp(
        db,
        caller,
        {
          clientRequestId: 'req-zonas',
          serviceId: laser.id,
          professionalId: pro.id,
          roomResourceId: room.id,
          startsAt: zonedCivilToUtc(TZ, 2024, 1, 8, 11, 0),
          contactId: marina.id,
          conversationId: cnvMarina.id,
          opportunityId: opp.id,
          actorClerkUserId: 'user_synth_owner_a',
          zoneIds: [zones[0]!.id, zones[1]!.id],
        },
        clock,
      ).value

      const withZones = readClientWebState(db, clock, {
        tenantId: TENANT,
        contactId: marina.id,
        conversationId: cnvMarina.id,
      })
      expect(withZones?.appointments.find((a) => a.id === zoned.id)).toMatchObject({
        zoneNames: ['Axilas', 'Virilha'],
        comboName: null,
        priceCents: 23_000,
      })

      replaceServiceCombosOp(
        db,
        caller,
        laser.id,
        [{ name: 'Combo axilas + virilha', priceCents: 18_000, zoneIds: [zones[0]!.id, zones[1]!.id] }],
        clock,
      )
      const comboApt = confirmAppointmentOp(
        db,
        caller,
        {
          clientRequestId: 'req-combo',
          serviceId: laser.id,
          professionalId: pro.id,
          roomResourceId: room.id,
          startsAt: zonedCivilToUtc(TZ, 2024, 1, 8, 15, 0),
          contactId: marina.id,
          conversationId: cnvMarina.id,
          opportunityId: opp.id,
          actorClerkUserId: 'user_synth_owner_a',
          zoneIds: [zones[0]!.id, zones[1]!.id],
        },
        clock,
      ).value
      const withCombo = readClientWebState(db, clock, {
        tenantId: TENANT,
        contactId: marina.id,
        conversationId: cnvMarina.id,
      })
      expect(withCombo?.appointments.find((a) => a.id === comboApt.id)).toMatchObject({
        zoneNames: ['Axilas', 'Virilha'],
        comboName: 'Combo axilas + virilha',
        priceCents: 18_000,
      })
    } finally {
      close()
    }
  })

  it('devolve o link do Google Business para «Como chegar» (DEC-211) e null sem link', () => {
    const { db, clock, close, marina, cnvMarina } = seed()
    try {
      const input = { tenantId: TENANT, contactId: marina.id, conversationId: cnvMarina.id }
      expect(readClientWebState(db, clock, input)?.locationUrl).toBeNull()
      setAiProfileOp(
        db,
        workerCaller(TENANT, 'user_synth_owner_a'),
        { googleBusinessUrl: 'https://maps.app.goo.gl/clinica-teste' },
        clock,
      )
      expect(readClientWebState(db, clock, input)?.locationUrl).toBe('https://maps.app.goo.gl/clinica-teste')
    } finally {
      close()
    }
  })

  it('não mostra marcações já passadas', () => {
    const { db, clock, close, marina, cnvMarina, book } = seed()
    try {
      book(marina.id, cnvMarina.id, 10, 'req-passada')
      clock.advance(60 * 24 * 60 * 60 * 1000)
      const state = readClientWebState(db, clock, {
        tenantId: TENANT,
        contactId: marina.id,
        conversationId: cnvMarina.id,
      })
      expect(state?.appointments).toEqual([])
    } finally {
      close()
    }
  })

  it('recusa um contacto que não é o da conversa da sessão', () => {
    const { db, clock, close, marina, outra, cnvMarina } = seed()
    try {
      expect(
        readClientWebState(db, clock, { tenantId: TENANT, contactId: outra.id, conversationId: cnvMarina.id }),
      ).toBeNull()
      expect(
        readClientWebState(db, clock, { tenantId: TENANT, contactId: marina.id, conversationId: 'cnv-inexistente' }),
      ).toBeNull()
      expect(
        readClientWebState(db, clock, { tenantId: 'clinic-outra', contactId: marina.id, conversationId: cnvMarina.id }),
      ).toBeNull()
    } finally {
      close()
    }
  })
})
