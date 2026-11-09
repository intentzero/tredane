/**
 * Regressão — sticky date após oferta vazia (sibling do loop de período #655).
 *
 * F1 remarcação: domingo cheio → «à tarde» não deve repetir o mesmo dia.
 * F2 marcação nova: «Sim» após «Quer ver outro dia?» limpa date sticky.
 */
import { describe, expect, it } from 'vitest'
import { SimulatedAiAdapter } from '../../ai'
import { createControllableClock } from '../../db/clock'
import {
  replaceServiceZonesOp,
  setWeeklyWindowsOp,
  upsertResourceOp,
  upsertServiceOp,
} from '../config'
import { setClinicAiAssistEnabled } from '../config/settings'
import { upsertContact } from '../contacts'
import { workerCaller } from '../index'
import { createConversation } from '../inbox/conversations'
import { insertMessage } from '../inbox/messages'
import { confirmAppointmentOp, zonedCivilToUtc } from '../scheduling'
import { bootClinicDb } from '../test-db'
import { syncWhatsappChannel } from '../whatsapp/channel'
import { enqueueAutoDraft, runDueAutoDrafts } from './index'
import { getBookingFrame, saveBookingFrame } from './schedule-session'
import { phraseAskDay } from './reschedule'

const TZ = 'America/Sao_Paulo'

describe('sticky date — remarcação dia cheio (F1)', () => {
  const NOW = Date.UTC(2026, 9, 30, 17, 40) // sex 30/10 14:40 SP

  function seed() {
    const clock = createControllableClock(NOW)
    const boot = bootClinicDb({ clock })
    const { db } = boot
    const tenantId = 'clinic-demo-sticky-date-rs'
    const caller = workerCaller(tenantId, 'user_synth_owner_a')
    syncWhatsappChannel(
      db,
      tenantId,
      {
        status: 'connected',
        bindingId: 'b_rs',
        phoneNumberId: 'p_rs',
        wabaId: 'w_rs',
        displayPhone: '+5511900000110',
        displayName: 'C',
        action: 'channel_connected',
      },
      clock,
    )
    const room = upsertResourceOp(db, caller, { kind: 'room', name: 'Sala', category: 'Sala' }, clock)
    const gi = upsertResourceOp(db, caller, { kind: 'professional', name: 'Gi', homeRoomId: room.id }, clock)
    const svc = upsertServiceOp(
      db,
      caller,
      {
        name: 'Depilação',
        durationMinutes: 30,
        bufferMinutes: 15,
        priceCents: 8000,
        variantKind: 'zona',
        variantKindPlural: 'zonas',
        professionalIds: [gi.id],
        roomRequirement: { mode: 'none' },
      },
      clock,
    )
    const zones = replaceServiceZonesOp(
      db,
      caller,
      svc.id,
      [
        { name: 'Axila', durationMinutes: 15, priceCents: 4000, audience: 'feminino' },
        { name: 'Pernas', durationMinutes: 30, priceCents: 9000, audience: 'feminino' },
      ],
      clock,
    )
    const week = [1, 2, 3, 4, 5].map((d) => ({ dayOfWeek: d, startMinute: 540, endMinute: 1080 }))
    setWeeklyWindowsOp(db, caller, { resourceId: gi.id, windows: week }, clock)
    setClinicAiAssistEnabled(db, tenantId, true, clock)
    const contact = upsertContact(db, { tenantId, waId: '5511900000110', displayName: 'Demo' }, clock)
    const cnv = createConversation(db, { tenantId, contactId: contact.id, status: 'open' }, clock)
    confirmAppointmentOp(
      db,
      caller,
      {
        clientRequestId: 'seed-apt-sticky-date',
        serviceId: svc.id,
        professionalId: gi.id,
        startsAt: zonedCivilToUtc(TZ, 2026, 11, 3, 10, 0),
        contactId: contact.id,
        conversationId: cnv.id,
        actorClerkUserId: caller.actorId!,
        zoneIds: zones.map((z) => z.id),
      },
      clock,
    )
    let t = NOW - 120_000
    const say = (direction: 'inbound' | 'outbound', body: string) => {
      t = Math.max(t, clock.nowMs() + 1)
      insertMessage(
        db,
        {
          tenantId,
          conversationId: cnv.id,
          direction,
          body,
          deliveryState: direction === 'inbound' ? 'received' : 'delivered',
          createdAt: t,
        },
        clock,
      )
      t += 60_000
    }
    const run = async () => {
      const last = db.get<{ id: string }>(
        `SELECT id FROM messages WHERE conversation_id = ? AND direction = 'inbound' ORDER BY created_at DESC LIMIT 1`,
        cnv.id,
      )!
      enqueueAutoDraft(db, tenantId, { conversationId: cnv.id, messageId: last.id }, clock)
      clock.advance(7_000)
      return (
        await runDueAutoDrafts(db, caller, clock, {
          mode: 'synthetic',
          adapter: new SimulatedAiAdapter(),
        })
      )[0]!
    }
    const lastOutbound = () =>
      db.get<{ body: string }>(
        `SELECT body FROM messages WHERE conversation_id = ? AND direction = 'outbound' ORDER BY created_at DESC LIMIT 1`,
        cnv.id,
      )?.body ?? ''
    return { ...boot, clock, tenantId, cnv, say, run, lastOutbound }
  }

  it('domingo vazio limpa date; «à tarde» pede outro dia em vez de loopar', async () => {
    const s = seed()
    try {
      s.say('inbound', 'Posso reagendar para domingo?')
      await s.run()
      expect(s.lastOutbound()).toMatch(/outro dia\?/i)
      expect(getBookingFrame(s.db, s.tenantId, s.cnv.id)?.date).toBeNull()
      expect(getBookingFrame(s.db, s.tenantId, s.cnv.id)?.phase).toBe('remarcando')

      s.say('inbound', 'à tarde')
      await s.run()
      expect(s.lastOutbound()).toBe(phraseAskDay())
      expect(s.lastOutbound()).not.toMatch(/domingo 01\/11/)
      expect(getBookingFrame(s.db, s.tenantId, s.cnv.id)?.period).toBe('tarde')
    } finally {
      s.close()
    }
  })
})

describe('sticky date — marcação nova Sim / outro dia (F2)', () => {
  const NOW = Date.UTC(2026, 10, 9, 17, 10) // seg 09/11 14:10 SP
  const EMPTY_DIA =
    'Para Massagem, no domingo (15/11) não tenho horário livre. Quer ver outro dia?'

  function seed() {
    const clock = createControllableClock(NOW)
    const boot = bootClinicDb({ clock })
    const { db } = boot
    const tenantId = 'clinic-demo-sticky-date-nb'
    const caller = workerCaller(tenantId, 'user_synth_owner_a')
    syncWhatsappChannel(
      db,
      tenantId,
      {
        status: 'connected',
        bindingId: 'b_nb',
        phoneNumberId: 'p_nb',
        wabaId: 'w_nb',
        displayPhone: '+5511900000111',
        displayName: 'C',
        action: 'channel_connected',
      },
      clock,
    )
    const room = upsertResourceOp(db, caller, { kind: 'room', name: 'Sala 1', category: 'Sala' }, clock)
    const pro = upsertResourceOp(db, caller, { kind: 'professional', name: 'Gi', homeRoomId: room.id }, clock)
    const massagem = upsertServiceOp(
      db,
      caller,
      {
        name: 'Massagem',
        durationMinutes: 50,
        bufferMinutes: 0,
        priceCents: 15_000,
        variantKind: 'tipo',
        variantKindPlural: 'tipos',
        variantSelection: 'uma',
        professionalIds: [pro.id],
        roomRequirement: { mode: 'none' },
      },
      clock,
    )
    replaceServiceZonesOp(
      db,
      caller,
      massagem.id,
      [{ name: 'Liberação miofascial', audience: 'ambos', durationMinutes: 50, priceCents: 15_000 }],
      clock,
    )
    const week = [1, 2, 3, 4, 5].map((d) => ({ dayOfWeek: d, startMinute: 540, endMinute: 1020 }))
    setWeeklyWindowsOp(db, caller, { resourceId: pro.id, windows: week }, clock)
    setWeeklyWindowsOp(db, caller, { resourceId: room.id, windows: week }, clock)
    setClinicAiAssistEnabled(db, tenantId, true, clock)
    const contact = upsertContact(db, { tenantId, waId: '5511900000111', displayName: 'Demo' }, clock)
    const cnv = createConversation(db, { tenantId, contactId: contact.id, status: 'open' }, clock)
    const zona = db.get<{ id: string }>(
      `SELECT id FROM service_zones WHERE tenant_id = ? AND service_id = ? LIMIT 1`,
      tenantId,
      massagem.id,
    )!
    return { ...boot, clock, tenantId, caller, cnv, massagem, zona }
  }

  async function say(s: ReturnType<typeof seed>, body: string) {
    s.clock.advance(30_000)
    insertMessage(
      s.db,
      {
        tenantId: s.tenantId,
        conversationId: s.cnv.id,
        direction: 'inbound',
        body,
        deliveryState: 'received',
        createdAt: s.clock.nowMs(),
      },
      s.clock,
    )
    const last = s.db.get<{ id: string }>(
      `SELECT id FROM messages WHERE conversation_id = ? AND direction = 'inbound' ORDER BY created_at DESC LIMIT 1`,
      s.cnv.id,
    )!
    enqueueAutoDraft(s.db, s.tenantId, { conversationId: s.cnv.id, messageId: last.id }, s.clock)
    s.clock.advance(7_000)
    return (
      await runDueAutoDrafts(s.db, s.caller, s.clock, {
        mode: 'synthetic',
        adapter: new SimulatedAiAdapter(),
      })
    )[0]!
  }

  it('«Sim» após «Quer ver outro dia?» limpa date e oferece próximos', async () => {
    const s = seed()
    try {
      saveBookingFrame(
        s.db,
        s.tenantId,
        s.cnv.id,
        {
          serviceId: s.massagem.id,
          variantIds: [s.zona.id],
          date: '2026-11-15',
          phase: 'coletando',
        },
        s.clock,
      )
      insertMessage(
        s.db,
        {
          tenantId: s.tenantId,
          conversationId: s.cnv.id,
          direction: 'outbound',
          body: EMPTY_DIA,
          deliveryState: 'delivered',
          createdAt: s.clock.nowMs(),
        },
        s.clock,
      )
      const out = await say(s, 'Sim')
      const reply = out.autoBook?.replyText ?? ''
      expect(reply).not.toMatch(/outro dia\?/i)
      expect(reply).toMatch(/\d{1,2}:\d{2}/)
      const frame = getBookingFrame(s.db, s.tenantId, s.cnv.id)
      expect(frame?.date).toBeNull()
      expect(frame?.serviceId).toBe(s.massagem.id)
    } finally {
      s.close()
    }
  })
})
