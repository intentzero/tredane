/**
 * Cenário S03a (baseline 15/11): depilação feminina axila+pernas, toque Sim no eco DEC-137.
 * Antes: Clinic DO excedia CPU na oferta de horários após confirmar o conjunto de zonas.
 */
import { describe, expect, it } from 'vitest'
import { SimulatedAiAdapter } from '../../ai'
import { createControllableClock } from '../../db/clock'
import {
  insertSyntheticAppointment,
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
import { bootClinicDb } from '../test-db'
import { syncWhatsappChannel } from '../whatsapp/channel'
import { handleChoiceOfferClick } from './choice-offer'
import { enqueueAutoDraft, runDueAutoDrafts } from './index'
import { SLOT_LIST_BUTTON_LABEL } from './choice-offer'

const NOW = Date.UTC(2026, 10, 16, 13, 0)

function seed() {
  const clock = createControllableClock(NOW)
  const boot = bootClinicDb({ clock })
  const { db } = boot
  const tenantId = 'clinic-demo-s03a-cpu'
  const caller = workerCaller(tenantId, 'user_synth_owner_s03a')
  syncWhatsappChannel(
    db,
    tenantId,
    {
      status: 'connected',
      bindingId: 'bind_s03a',
      phoneNumberId: 'pn_s03a',
      wabaId: 'waba_s03a',
      displayPhone: '+5511999990103',
      displayName: 'Clínica S03a',
      action: 'channel_connected',
    },
    clock,
  )
  const room = upsertResourceOp(db, caller, { kind: 'room', name: 'Sala 1', category: 'dep' }, clock)
  const pro = upsertResourceOp(
    db,
    caller,
    { kind: 'professional', name: 'Ana', homeRoomId: room.id },
    clock,
  )
  const svc = upsertServiceOp(
    db,
    caller,
    {
      name: 'Depilação',
      durationMinutes: 30,
      bufferMinutes: 0,
      priceCents: 8000,
      variantKind: 'zona',
      variantKindPlural: 'zonas',
      variantSelection: 'varias',
      professionalIds: [pro.id],
      roomRequirement: { mode: 'rooms', resourceIds: [room.id] },
      tempoCeu: 'tanto_faz',
      tempoTemperatura: 'tanto_faz',
    },
    clock,
  )
  replaceServiceZonesOp(
    db,
    caller,
    svc.id,
    [
      { name: 'Axila', durationMinutes: 15, priceCents: 4000, audience: 'feminino' },
      { name: 'Pernas', durationMinutes: 30, priceCents: 9000, audience: 'feminino' },
    ],
    clock,
  )
  const week = [1, 2, 3, 4, 5, 6].map((d) => ({ dayOfWeek: d, startMinute: 540, endMinute: 1140 }))
  setWeeklyWindowsOp(db, caller, { resourceId: pro.id, windows: week }, clock)
  setWeeklyWindowsOp(db, caller, { resourceId: room.id, windows: week }, clock)
  setClinicAiAssistEnabled(db, tenantId, true, clock)

  const dayMs = 86_400_000
  const spOffset = 3 * 3_600_000
  const dayIndex = Math.floor((NOW - spOffset) / dayMs)
  let n = 0
  for (let d = dayIndex; d < dayIndex + 14; d++) {
    for (let minute = 540; minute < 1080; minute += 30) {
      if ((d + minute) % 4 === 0) continue
      const startsAt = d * dayMs + minute * 60_000 + spOffset
      insertSyntheticAppointment(
        db,
        tenantId,
        {
          id: `apt_s03a_${d}_${minute}`,
          serviceId: svc.id,
          professionalId: pro.id,
          roomResourceId: room.id,
          startsAt,
          endsAt: startsAt + 25 * 60_000,
          contactLabel: `P ${n++}`,
          status: 'confirmed',
        },
        clock,
      )
    }
  }

  const contact = upsertContact(db, { tenantId, waId: '550000000103', displayName: 'Camila' }, clock)
  const cnv = createConversation(db, { tenantId, contactId: contact.id, status: 'open' }, clock)
  return { ...boot, clock, tenantId, caller, cnv, db }
}

async function say(s: ReturnType<typeof seed>, body: string) {
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
  return runDueAutoDrafts(s.db, s.caller, s.clock, {
    mode: 'synthetic',
    adapter: new SimulatedAiAdapter(),
  })
}

function outboundInteractive(s: ReturnType<typeof seed>) {
  return s.db.all<{ body: string; interactive_json: string | null }>(
    `SELECT m.body AS body, o.interactive_json AS interactive_json
     FROM outbound_messages o
     JOIN messages m ON m.id = o.message_id
     WHERE o.tenant_id = ?
     ORDER BY o.created_at, o.rowid`,
    s.tenantId,
  )
}

describe('S03a eco Sim com 2 zonas (CPU / horários)', () => {
  it('axila e perna → eco → Sim devolve lista Horários', async () => {
    const s = seed()
    try {
      await say(s, 'boa tarde quero fazer depilação')
      await say(s, 'feminina')
      await say(s, 'ah ta bom entao.. axila e perna')
      const echo = outboundInteractive(s).filter((row) => (row.body ?? '').includes('Entendi:')).at(-1)
      expect(echo).toBeTruthy()
      const id = JSON.parse(echo!.interactive_json ?? '{}') as {
        buttons?: Array<{ id: string; title: string }>
      }
      const simId = id.buttons?.find((b) => b.title === 'Sim')?.id
      expect(simId).toBeTruthy()

      const before = outboundInteractive(s).length
      const clicked = await handleChoiceOfferClick(
        s.db,
        s.caller,
        {
          tenantId: s.tenantId,
          conversationId: s.cnv.id,
          buttonId: simId!,
          providerEventKey: 's03a-eco-sim',
        },
        s.clock,
      )
      expect(clicked.handled).toBe(true)
      const offers = outboundInteractive(s)
        .slice(before)
        .filter((row) => (row.interactive_json ?? '').includes(SLOT_LIST_BUTTON_LABEL))
      expect(offers.length).toBe(1)
      expect(offers[0]!.body).toMatch(/\d{1,2}:\d{2}/)
    } finally {
      s.close()
    }
  })
})