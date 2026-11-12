/**
 * Regressão rsamp_fa7f138 (staging Paulo 12/11/2026):
 * Proposta aberta (quinta 13:30) + «Para a próxima segunda tem horário?»
 * não deve reemitir proposta no dia corrente — remapeia o dia e reoferece slots.
 *
 * Relacionado a #688 (sexta+manhã após sticky amanhã), mas aqui o pedido
 * chega com proposta já enviada e sem período no turno.
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
import {
  createProposal,
  getActiveProposalForConversation,
  getProposal,
  markProposalSent,
} from '../proposals/proposals'
import { zonedCivilToUtc } from '../scheduling'
import { bootClinicDb } from '../test-db'
import { syncWhatsappChannel } from '../whatsapp/channel'
import { enqueueAutoDraft, runDueAutoDrafts } from './index'
import { getBookingFrame, saveBookingFrame } from './schedule-session'

const TZ = 'America/Sao_Paulo'
/** qui 12/11/2026 11:00 America/Sao_Paulo (UTC−3) — dia do sample live. */
const NOW = Date.UTC(2026, 10, 12, 14, 0)

function seed() {
  const clock = createControllableClock(NOW)
  const boot = bootClinicDb({ clock })
  const { db } = boot
  const tenantId = 'clinic-demo-proxima-segunda'
  const caller = workerCaller(tenantId, 'user_synth_owner_a')
  syncWhatsappChannel(
    db,
    tenantId,
    {
      status: 'connected',
      bindingId: 'b_seg',
      phoneNumberId: 'p_seg',
      wabaId: 'w_seg',
      displayPhone: '+5511900000093',
      displayName: 'C',
      action: 'channel_connected',
    },
    clock,
  )
  const room = upsertResourceOp(db, caller, { kind: 'room', name: 'Sala 1', category: 'Sala' }, clock)
  const pro = upsertResourceOp(db, caller, { kind: 'professional', name: 'Samua', homeRoomId: room.id }, clock)
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
      variantSelection: 'uma',
      professionalIds: [pro.id],
      roomRequirement: { mode: 'none' },
    },
    clock,
  )
  const zones = replaceServiceZonesOp(
    db,
    caller,
    massagem.id,
    [
      {
        name: 'Relaxante',
        audience: 'ambos',
        durationMinutes: 60,
        priceCents: 20000,
      },
      {
        name: 'Liberação miofascial',
        audience: 'ambos',
        durationMinutes: 60,
        priceCents: 22000,
      },
    ],
    clock,
  )
  const week = [1, 2, 3, 4, 5].map((d) => ({ dayOfWeek: d, startMinute: 540, endMinute: 1080 }))
  setWeeklyWindowsOp(db, caller, { resourceId: pro.id, windows: week }, clock)
  setWeeklyWindowsOp(db, caller, { resourceId: room.id, windows: week }, clock)
  setClinicAiAssistEnabled(db, tenantId, true, clock)
  const contact = upsertContact(db, { tenantId, waId: '5511900000093', displayName: 'Paulo' }, clock)
  const cnv = createConversation(db, { tenantId, contactId: contact.id, status: 'open' }, clock)
  const relaxante = zones.find((z) => z.name === 'Relaxante')!
  return { ...boot, clock, tenantId, caller, cnv, contact, massagem, pro, relaxante }
}

describe('proposal-open + «próxima segunda» (rsamp_fa7f138)', () => {
  it('A-08 spare: «a segunda opção» com pending não remapeia o dia', async () => {
    const s = seed()
    try {
      const offerMsg = insertMessage(
        s.db,
        {
          tenantId: s.tenantId,
          conversationId: s.cnv.id,
          direction: 'outbound',
          body: 'Para Massagem, tenho 13:00, 14:00 e 15:30. Qual fica melhor?',
          deliveryState: 'delivered',
          createdAt: s.clock.nowMs(),
        },
        s.clock,
      )
      const slot13 = zonedCivilToUtc(TZ, 2026, 11, 12, 13, 0)
      const slot14 = zonedCivilToUtc(TZ, 2026, 11, 12, 14, 0)
      const slot1530 = zonedCivilToUtc(TZ, 2026, 11, 12, 15, 30)
      saveBookingFrame(
        s.db,
        s.tenantId,
        s.cnv.id,
        {
          serviceId: s.massagem.id,
          variantIds: [s.relaxante.id],
          date: '2026-11-12',
          phase: 'ofertado',
          pending: {
            slot: 'horario',
            options: [
              { key: '13:00', label: '13:00' },
              { key: '14:00', label: '14:00' },
              { key: '15:30', label: '15:30' },
            ],
            messageId: offerMsg.id,
          },
          lastOffer: {
            slots: [
              { startsAt: slot13, professionalId: s.pro.id },
              { startsAt: slot14, professionalId: s.pro.id },
              { startsAt: slot1530, professionalId: s.pro.id },
            ],
            messageId: offerMsg.id,
          },
        },
        s.clock,
      )
      s.clock.advance(30_000)
      insertMessage(
        s.db,
        {
          tenantId: s.tenantId,
          conversationId: s.cnv.id,
          direction: 'inbound',
          body: 'a segunda opção',
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
      await runDueAutoDrafts(s.db, s.caller, s.clock, {
        mode: 'synthetic',
        adapter: new SimulatedAiAdapter(),
      })
      const active = getActiveProposalForConversation(s.db, s.tenantId, s.cnv.id, s.clock)
      expect(active).toBeTruthy()
      expect(new Date(active!.startsAt).toISOString()).toBe(
        new Date(slot14).toISOString(),
      )
      expect(getBookingFrame(s.db, s.tenantId, s.cnv.id)?.date).toBe('2026-11-12')
    } finally {
      s.close()
    }
  })

  it('remapeia para segunda e reoferece slots — não repropõe quinta', async () => {
    const s = seed()
    try {
      const startsAt = zonedCivilToUtc(TZ, 2026, 11, 12, 13, 30)
      // Histórico: escolha de hora (detectExplicitConfirmation resolve time daqui).
      insertMessage(
        s.db,
        {
          tenantId: s.tenantId,
          conversationId: s.cnv.id,
          direction: 'inbound',
          body: 'As 1330',
          deliveryState: 'received',
          createdAt: s.clock.nowMs() - 120_000,
        },
        s.clock,
      )
      saveBookingFrame(
        s.db,
        s.tenantId,
        s.cnv.id,
        {
          serviceId: s.massagem.id,
          variantIds: [s.relaxante.id],
          date: '2026-11-12',
          time: '13:30',
          phase: 'proposto',
          proposal: { id: 'prp_seed', version: 1 },
        },
        s.clock,
      )
      const proposal = createProposal(
        s.db,
        s.tenantId,
        {
          contactId: s.contact.id,
          conversationId: s.cnv.id,
          serviceId: s.massagem.id,
          professionalId: s.pro.id,
          startsAt,
          zoneIds: [s.relaxante.id],
        },
        s.clock,
      )
      markProposalSent(s.db, s.tenantId, proposal.id, s.clock)
      insertMessage(
        s.db,
        {
          tenantId: s.tenantId,
          conversationId: s.cnv.id,
          direction: 'outbound',
          body:
            'Proposta de horário\n\nServiço: Massagem · Relaxante\n' +
            'Quando: quinta-feira, 12 de novembro de 2026 às 13:30 – 14:30\n',
          deliveryState: 'delivered',
          createdAt: s.clock.nowMs() - 60_000,
        },
        s.clock,
      )

      s.clock.advance(30_000)
      insertMessage(
        s.db,
        {
          tenantId: s.tenantId,
          conversationId: s.cnv.id,
          direction: 'inbound',
          body: 'Para a próxima segunda tem horário?',
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
      const reply = out[0]?.autoBook?.replyText ?? ''
      const outbound = s.db
        .all<{ body: string }>(
          `SELECT body FROM messages WHERE conversation_id = ? AND direction = 'outbound' ORDER BY created_at DESC LIMIT 3`,
          s.cnv.id,
        )
        .map((m) => m.body)
        .join('\n')

      // Resposta nova: oferta na segunda — não proposta na quinta (histórico plantado ignora-se).
      expect(reply).toMatch(/\d{1,2}:\d{2}/)
      expect(reply).toMatch(/segunda|16\/11/i)
      expect(reply).not.toMatch(/quinta/i)
      expect(reply).not.toMatch(/Proposta de horário/i)
      // Outbound recente (sem a proposta plantada): mesma regra.
      expect(outbound.split('Proposta de horário')[0]).toMatch(/segunda|16\/11/i)

      const frame = getBookingFrame(s.db, s.tenantId, s.cnv.id)
      expect(frame?.date).toBe('2026-11-16') // segunda
      expect(frame?.time).toBeNull()

      // Proposta antiga retirada; sem nova proposta no dia corrente.
      expect(getProposal(s.db, s.tenantId, proposal.id)?.state).toBe('substituida')
      const active = getActiveProposalForConversation(s.db, s.tenantId, s.cnv.id, s.clock)
      expect(active).toBeNull()
    } finally {
      s.close()
    }
  })
})
