import { describe, expect, it } from 'vitest'
import { createControllableClock } from '../db/clock'
import { workerCaller } from '../clinic'
import { bootClinicDb } from '../clinic/test-db'
import { setWeeklyWindowsOp, upsertResourceOp, upsertServiceOp } from '../clinic/config'
import { upsertContact } from '../clinic/contacts'
import { createConversation } from '../clinic/inbox/conversations'
import { ensureOpenOpportunity } from '../clinic/pipeline/operations'
import { confirmAppointmentOp, zonedCivilToUtc } from '../clinic/scheduling'
import { setAiProfileOp } from '../clinic/config'
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
  return { db, clock, close, marina, outra, cnvMarina, cnvOutra, book }
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
      expect(JSON.stringify(state)).not.toMatch(/5511900/)
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
