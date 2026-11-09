/**
 * Staging Paulo 09/11/2026: após oferta com dia travado (sexta 13/11), outro
 * serviço na mesma sessão deve oferecer os próximos horários — não «disponíveis
 * para sexta». Relógio = seg 09/11 (hoje tem vagas a partir das 14:00).
 */
import { describe, expect, it } from 'vitest'
import { SimulatedAiAdapter } from '../../ai'
import { createControllableClock } from '../../db/clock'
import { replaceServiceZonesOp, setWeeklyWindowsOp, upsertResourceOp, upsertServiceOp } from '../config'
import { setClinicAiAssistEnabled } from '../config/settings'
import { upsertContact } from '../contacts'
import { workerCaller } from '../index'
import { createConversation } from '../inbox/conversations'
import { insertMessage } from '../inbox/messages'
import { bootClinicDb } from '../test-db'
import { syncWhatsappChannel } from '../whatsapp/channel'
import { enqueueAutoDraft, runDueAutoDrafts } from './index'
import { getBookingFrame, saveBookingFrame } from './schedule-session'
import { createDeferredBookingFrame } from './deferred-booking-frame'

/** seg 09/11/2026 14:10 America/Sao_Paulo (UTC−3). */
const NOW = Date.UTC(2026, 10, 9, 17, 10)

function seed() {
  const clock = createControllableClock(NOW)
  const boot = bootClinicDb({ clock })
  const { db } = boot
  const tenantId = 'clinic-demo-sticky-day'
  const caller = workerCaller(tenantId, 'user_synth_owner_a')
  syncWhatsappChannel(
    db,
    tenantId,
    {
      status: 'connected',
      bindingId: 'b_sticky',
      phoneNumberId: 'p_sticky',
      wabaId: 'w_sticky',
      displayPhone: '+5511900000088',
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
    [
      {
        name: 'Liberação miofascial',
        audience: 'ambos',
        durationMinutes: 50,
        priceCents: 15_000,
      },
      {
        name: 'Massagem relaxante',
        audience: 'ambos',
        durationMinutes: 50,
        priceCents: 15_000,
      },
    ],
    clock,
  )
  const depilacao = upsertServiceOp(
    db,
    caller,
    {
      name: 'Depilação',
      durationMinutes: 30,
      bufferMinutes: 0,
      priceCents: 8000,
      variantKind: 'zona',
      variantKindPlural: 'zonas',
      professionalIds: [pro.id],
      roomRequirement: { mode: 'none' },
    },
    clock,
  )
  replaceServiceZonesOp(
    db,
    caller,
    depilacao.id,
    [
      { name: 'Intima', durationMinutes: 15, priceCents: 5000, audience: 'feminino' },
      { name: 'Pernas', durationMinutes: 30, priceCents: 9000, audience: 'feminino' },
      { name: 'Axila', durationMinutes: 15, priceCents: 4000, audience: 'feminino' },
    ],
    clock,
  )
  const week = [1, 2, 3, 4, 5].map((d) => ({ dayOfWeek: d, startMinute: 540, endMinute: 1020 }))
  setWeeklyWindowsOp(db, caller, { resourceId: pro.id, windows: week }, clock)
  setWeeklyWindowsOp(db, caller, { resourceId: room.id, windows: week }, clock)
  setClinicAiAssistEnabled(db, tenantId, true, clock)
  const contact = upsertContact(db, { tenantId, waId: '5511900000088', displayName: 'Demo' }, clock)
  const cnv = createConversation(db, { tenantId, contactId: contact.id, status: 'open' }, clock)
  return { ...boot, clock, tenantId, caller, cnv, massagem, depilacao, pro }
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
  const out = await runDueAutoDrafts(s.db, s.caller, s.clock, {
    mode: 'synthetic',
    adapter: new SimulatedAiAdapter(),
  })
  return out[0]!
}

describe('sticky day lock — outro serviço na mesma sessão', () => {
  it('troca de serviço limpa date/period no frame e no overlay diferido', () => {
    const s = seed()
    try {
      saveBookingFrame(
        s.db,
        s.tenantId,
        s.cnv.id,
        {
          serviceId: s.massagem.id,
          date: '2026-11-13',
          period: 'tarde',
          phase: 'ofertado',
        },
        s.clock,
      )
      const deferred = createDeferredBookingFrame()
      deferred.save({ serviceId: s.depilacao.id })
      const peeked = deferred.peekFrame(s.db, s.tenantId, s.cnv.id)
      expect(peeked?.serviceId).toBe(s.depilacao.id)
      expect(peeked?.date).toBeNull()
      expect(peeked?.period).toBeNull()

      deferred.flushNow(s.db, s.tenantId, s.cnv.id, s.clock)
      const frame = getBookingFrame(s.db, s.tenantId, s.cnv.id)
      expect(frame?.serviceId).toBe(s.depilacao.id)
      expect(frame?.date).toBeNull()
      expect(frame?.period).toBeNull()
    } finally {
      s.close()
    }
  })

  it('após dia travado em Massagem, Depilação Intima+Pernas → Sim oferece próximos (não sexta)', async () => {
    const s = seed()
    try {
      const liberacao = s.db.get<{ id: string }>(
        `SELECT id FROM service_zones WHERE tenant_id = ? AND service_id = ? AND name = ?`,
        s.tenantId,
        s.massagem.id,
        'Liberação miofascial',
      )
      expect(liberacao).toBeTruthy()
      saveBookingFrame(
        s.db,
        s.tenantId,
        s.cnv.id,
        {
          serviceId: s.massagem.id,
          variantIds: [liberacao!.id],
          date: '2026-11-13',
          period: 'tarde',
          phase: 'ofertado',
          lastOffer: {
            slots: [
              {
                startsAt: Date.UTC(2026, 10, 13, 17, 0),
                professionalId: s.pro.id,
              },
            ],
            messageId: 'm_prior_friday',
          },
          pending: {
            slot: 'horario',
            options: [{ key: '2026-11-13T14:00', label: 'sexta 13/11 14:00' }],
            messageId: 'm_prior_friday',
          },
        },
        s.clock,
      )

      const eco = await say(s, 'Quero depilação feminina de íntima e pernas')
      const ecoText = eco.autoBook?.replyText ?? ''
      expect(ecoText).toMatch(/Entendi:/i)
      expect(getBookingFrame(s.db, s.tenantId, s.cnv.id)?.date).toBeNull()

      const offer = await say(s, 'sim')
      const reply = offer.autoBook?.replyText ?? ''
      // Oferta aberta (próximos / «Tenho …»): dia civil = hoje → rótulo «hoje» (Paulo 09/11),
      // não weekday+DD/MM nem o dia sticky sexta 13/11.
      expect(reply).toMatch(/\bhoje\b/i)
      expect(reply).toMatch(/\d{1,2}:\d{2}/)
      expect(reply).not.toMatch(/09\/11/)
      expect(reply).not.toMatch(/horários disponíveis para sexta/i)
      expect(reply).not.toMatch(/13\/11/)
      const frame = getBookingFrame(s.db, s.tenantId, s.cnv.id)
      expect(frame?.serviceId).toBe(s.depilacao.id)
      expect(frame?.date).toBeNull()
    } finally {
      s.close()
    }
  })
})
