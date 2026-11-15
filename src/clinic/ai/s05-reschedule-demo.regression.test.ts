/**
 * Lab S05a/S05b (15/11/2026): remarcação na demo cheia não pode recusar sexta com vagas.
 */
import { describe, expect, it } from 'vitest'
import { createControllableClock } from '../../db/clock'
import { DEMO_CLINIC_TENANT_ID } from '../demo/ids'
import { seedDemoClinicOp } from '../demo/seed'
import { workerCaller } from '../index'
import { bootClinicDb } from '../test-db'
import { upsertContact } from '../contacts'
import { createConversation } from '../inbox/conversations'
import { listServices } from '../config/services'
import { confirmAppointmentOp, queryAvailability, zonedCivilToUtc } from '../scheduling'
import { saveBookingFrame, saveScheduleSession } from './schedule-session'
import { tryAiReschedule } from './reschedule'

const TZ = 'America/Sao_Paulo'
/** Domingo 15/11/2026 ~20h BRT — mesma janela da regressão f908ba1b. */
const NOW = Date.UTC(2026, 10, 15, 23, 0)

describe('S05 remarcação na clínica demo', () => {
  function seedFridayDrenagem() {
    const clock = createControllableClock(NOW)
    const boot = bootClinicDb({ clock })
    const { db } = boot
    const tenantId = DEMO_CLINIC_TENANT_ID
    const caller = workerCaller(tenantId, 'user_demo_owner_s05')
    seedDemoClinicOp(db, caller, clock, { ownerClerkUserId: 'user_demo_owner_s05' })
    const drenagem = listServices(db, tenantId, clock).find((s) => s.name === 'Drenagem linfática')!
    const contact = upsertContact(db, { tenantId, waId: '5500000001049', displayName: 'Aline' }, clock)
    const cnv = createConversation(db, { tenantId, contactId: contact.id, status: 'open' }, clock)
    const tue1230 = zonedCivilToUtc(TZ, 2026, 11, 17, 12, 30)
    const apt = confirmAppointmentOp(
      db,
      caller,
      {
        clientRequestId: 's05a-seed',
        serviceId: drenagem.id,
        professionalId: drenagem.professionalIds[0]!,
        startsAt: tue1230,
        contactId: contact.id,
        conversationId: cnv.id,
        actorClerkUserId: caller.actorId!,
        zoneIds: [],
      },
      clock,
    )
    return { ...boot, clock, tenantId, caller, cnv, db, drenagem, aptId: apt.id }
  }

  it('controlo: sexta 20/11 tem vagas de drenagem (marcação nova)', () => {
    const s = seedFridayDrenagem()
    try {
      const slots = queryAvailability(s.db, s.tenantId, { serviceId: s.drenagem.id, date: '2026-11-20' }, s.clock)
      expect(slots.slots.length).toBeGreaterThan(0)
    } finally {
      s.close()
    }
  })

  function seedMondayMicro() {
    const clock = createControllableClock(NOW)
    const boot = bootClinicDb({ clock })
    const { db } = boot
    const tenantId = DEMO_CLINIC_TENANT_ID
    const caller = workerCaller(tenantId, 'user_demo_owner_s05b')
    seedDemoClinicOp(db, caller, clock, { ownerClerkUserId: 'user_demo_owner_s05b' })
    const micro = listServices(db, tenantId, clock).find((s) => s.name === 'Microagulhamento')!
    const contact = upsertContact(db, { tenantId, waId: '5500000001059', displayName: 'Priscila' }, clock)
    const cnv = createConversation(db, { tenantId, contactId: contact.id, status: 'open' }, clock)
    const mon1245 = zonedCivilToUtc(TZ, 2026, 11, 16, 12, 45)
    confirmAppointmentOp(
      db,
      caller,
      {
        clientRequestId: 's05b-seed',
        serviceId: micro.id,
        professionalId: micro.professionalIds[0]!,
        startsAt: mon1245,
        contactId: contact.id,
        conversationId: cnv.id,
        actorClerkUserId: caller.actorId!,
        zoneIds: [],
      },
      clock,
    )
    return { ...boot, clock, tenantId, caller, cnv, db, micro }
  }

  it('S05b: remarcar para sexta oferece horários (drenagem)', async () => {
    const s = seedFridayDrenagem()
    try {
      const out = await tryAiReschedule(s.db, s.caller, s.clock, {
        conversationId: s.cnv.id,
        inboundText: 'opa, na vdd vou precisar remarcar pra sexta, pode ser?',
      })
      expect(out).not.toBeNull()
      expect(out!.replyText).toMatch(/sexta 20\/11/i)
      expect(out!.replyText).not.toMatch(/não tenho horário livre/i)
      expect(out!.replyText).toMatch(/\d{2}:\d{2}/)
    } finally {
      s.close()
    }
  })

  it('S05b: microagulhamento remarcar para sexta oferece horários', async () => {
    const s = seedMondayMicro()
    try {
      const plain = queryAvailability(s.db, s.tenantId, { serviceId: s.micro.id, date: '2026-11-20' }, s.clock)
      const out = await tryAiReschedule(s.db, s.caller, s.clock, {
        conversationId: s.cnv.id,
        inboundText: 'opa, na vdd vou precisar remarcar pra sexta, pode ser?',
      })
      expect(plain.slots.length, 'controlo micro sexta').toBeGreaterThan(0)
      expect(out).not.toBeNull()
      expect(out!.replyText).not.toMatch(/não tenho horário livre/i)
      expect(out!.replyText).toMatch(/\d{2}:\d{2}/)
    } finally {
      s.close()
    }
  })

  it('S05a: sexta de manhã oferece vagas (não recusa o dia)', async () => {
    const s = seedFridayDrenagem()
    try {
      saveBookingFrame(
        s.db,
        s.tenantId,
        s.cnv.id,
        { serviceId: s.drenagem.id, date: '2026-11-17', phase: 'remarcando' },
        s.clock,
      )
      const out = await tryAiReschedule(s.db, s.caller, s.clock, {
        conversationId: s.cnv.id,
        inboundText: 'nao, terca nao vou poder. sexta de manha tem?',
      })
      expect(out).not.toBeNull()
      expect(out!.date).toBe('2026-11-20')
      expect(out!.replyText).not.toMatch(/não tenho horário livre/i)
      expect(out!.replyText).toMatch(/\d{2}:\d{2}/)
    } finally {
      s.close()
    }
  })

  it('S05a: «sexta 13h» com período manhã sticky honra a hora pedida', async () => {
    const s = seedFridayDrenagem()
    try {
      saveBookingFrame(
        s.db,
        s.tenantId,
        s.cnv.id,
        { serviceId: s.drenagem.id, date: '2026-11-20', phase: 'remarcando' },
        s.clock,
      )
      saveScheduleSession(
        s.db,
        s.tenantId,
        s.cnv.id,
        { serviceId: s.drenagem.id, date: '2026-11-20', period: 'manha', phase: 'remarcando' },
        s.clock,
      )
      const at13 = await tryAiReschedule(s.db, s.caller, s.clock, {
        conversationId: s.cnv.id,
        inboundText: 'e sexta 13h?',
      })
      expect(at13?.time).toBe('13:00')
      expect(at13?.replyText).not.toMatch(/não tenho horário livre/i)
    } finally {
      s.close()
    }
  })
})