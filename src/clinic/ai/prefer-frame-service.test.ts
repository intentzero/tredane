/**
 * Audit H1: com oferta de horário viva, time-pick usa frame.serviceId —
 * não o serviço que detectExplicitConfirmation achar no histórico.
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
import { getProposal } from '../proposals/proposals'
import { zonedCivilToUtc } from '../scheduling'
import { bootClinicDb } from '../test-db'
import { syncWhatsappChannel } from '../whatsapp/channel'
import { detectExplicitConfirmation } from './autobook'
import { enqueueAutoDraft, runDueAutoDrafts } from './index'
import { getBookingFrame, saveBookingFrame } from './schedule-session'

const NOW = Date.UTC(2026, 10, 7, 14, 51) // sáb 07/11 11:51 local

function seed() {
  const clock = createControllableClock(NOW)
  const boot = bootClinicDb({ clock })
  const { db } = boot
  const tenantId = 'clinic-demo-a'
  const caller = workerCaller(tenantId, 'user_synth_owner_a')
  syncWhatsappChannel(
    db,
    tenantId,
    {
      status: 'connected',
      bindingId: 'b',
      phoneNumberId: 'p',
      wabaId: 'w',
      displayPhone: '+5511900000099',
      displayName: 'C',
      action: 'channel_connected',
    },
    clock,
  )
  const room = upsertResourceOp(db, caller, { kind: 'room', name: 'Sala 1', category: 'Sala' }, clock)
  const pro = upsertResourceOp(
    db,
    caller,
    { kind: 'professional', name: 'Gi', homeRoomId: room.id },
    clock,
  )
  const depil = upsertServiceOp(
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
  const zones = replaceServiceZonesOp(
    db,
    caller,
    depil.id,
    [
      { name: 'Axila', durationMinutes: 15, priceCents: 4000, audience: 'feminino' },
      { name: 'Pernas', durationMinutes: 30, priceCents: 9000, audience: 'feminino' },
    ],
    clock,
  )
  const massagem = upsertServiceOp(
    db,
    caller,
    {
      name: 'Massagem',
      durationMinutes: 60,
      bufferMinutes: 0,
      priceCents: 20000,
      variantKind: 'tipo',
      variantKindPlural: 'tipos',
      professionalIds: [pro.id],
      roomRequirement: { mode: 'none' },
    },
    clock,
  )
  replaceServiceZonesOp(
    db,
    caller,
    massagem.id,
    [{ name: 'Ventosaterapia', durationMinutes: 60, priceCents: 20000, audience: 'ambos' }],
    clock,
  )
  const week = [1, 2, 3, 4, 5].map((d) => ({ dayOfWeek: d, startMinute: 540, endMinute: 1020 }))
  setWeeklyWindowsOp(db, caller, { resourceId: pro.id, windows: week }, clock)
  setWeeklyWindowsOp(db, caller, { resourceId: room.id, windows: week }, clock)
  setClinicAiAssistEnabled(db, tenantId, true, clock)
  const contact = upsertContact(db, { tenantId, waId: '5511900000099', displayName: 'Demo' }, clock)
  const cnv = createConversation(db, { tenantId, contactId: contact.id, status: 'open' }, clock)
  return { ...boot, clock, tenantId, caller, cnv, depil, massagem, zones, pro }
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

describe('prefer frame.serviceId on live horário offer (audit H1)', () => {
  it('detectExplicitConfirmation can pick Massagem from history when clinic copy omits service', () => {
    const services = [
      { id: 'dep', name: 'Depilação', active: true, zones: [] },
      { id: 'mas', name: 'Massagem', active: true, zones: [] },
    ] as never
    const r = detectExplicitConfirmation({
      clientToday: '2026-11-07',
      clinicToday: '2026-11-07',
      services,
      clientTexts: ['As 15'],
      previousClinicText: 'Os próximos horários são sexta 13/11 às 15:00. Algum serve?',
      historyTexts: ['Quero Massagem amanhã'],
    })
    expect(r.service?.id).toBe('mas')
  })

  it('time pick with Massagem in history keeps Depilação from frame', async () => {
    const s = seed()
    try {
      // Histórico antigo cita Massagem (o que o resolver de confirmação reaproveitaria).
      insertMessage(
        s.db,
        {
          tenantId: s.tenantId,
          conversationId: s.cnv.id,
          direction: 'inbound',
          body: 'Quero Massagem amanhã',
          deliveryState: 'received',
          createdAt: s.clock.nowMs() - 120_000,
        },
        s.clock,
      )
      const offerMsg = insertMessage(
        s.db,
        {
          tenantId: s.tenantId,
          conversationId: s.cnv.id,
          direction: 'outbound',
          body: 'Os próximos horários para Depilação são sexta 13/11 às 13:00, 15:00. Algum serve?',
          deliveryState: 'delivered',
          createdAt: s.clock.nowMs() - 60_000,
        },
        s.clock,
      )
      const fri13 = zonedCivilToUtc('America/Sao_Paulo', 2026, 11, 13, 13, 0)
      const fri15 = zonedCivilToUtc('America/Sao_Paulo', 2026, 11, 13, 15, 0)
      saveBookingFrame(
        s.db,
        s.tenantId,
        s.cnv.id,
        {
          serviceId: s.depil.id,
          line: 'feminino',
          variantIds: s.zones.map((z) => z.id),
          date: '2026-11-13',
          phase: 'ofertado',
          pending: {
            slot: 'horario',
            options: [
              { key: '2026-11-13T13:00', label: 'sexta 13/11 às 13:00' },
              { key: '2026-11-13T15:00', label: 'sexta 13/11 às 15:00' },
            ],
            messageId: offerMsg.id,
          },
          lastOffer: {
            slots: [
              { startsAt: fri13, professionalId: s.pro.id },
              { startsAt: fri15, professionalId: s.pro.id },
            ],
            messageId: offerMsg.id,
          },
        },
        s.clock,
      )

      await say(s, 'As 15')
      expect(getBookingFrame(s.db, s.tenantId, s.cnv.id)?.serviceId).toBe(s.depil.id)
      expect(getBookingFrame(s.db, s.tenantId, s.cnv.id)?.serviceId).not.toBe(s.massagem.id)

      const proposalRow = s.db.get<{ id: string }>(
        `SELECT id FROM appointment_proposals WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 1`,
        s.tenantId,
      )
      expect(proposalRow).toBeTruthy()
      const proposal = getProposal(s.db, s.tenantId, proposalRow!.id)!
      expect(proposal.serviceId).toBe(s.depil.id)
      expect(proposal.serviceId).not.toBe(s.massagem.id)
      expect(proposal.serviceName).toMatch(/Depilação/i)
    } finally {
      s.close()
    }
  })
})
