/**
 * Staging Paulo 09/11/2026: após Confirmar → Agendado → «Posso ajudar…»,
 * saía «Não peguei bem…» sem turno novo. Race: ingest enfileira autodraft do
 * `[Botão] Confirmar` com pending choose_slot; S5 tem de cancelar o job e o
 * autodraft não pode reinterpretar o clique.
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
import { createConversation } from '../inbox/conversations'
import { insertMessage } from '../inbox/messages'
import { clinicInbox, clinicWhatsapp, workerCaller } from '../index'
import { bootClinicDb } from '../test-db'
import { enqueueAutoDraft, getAutoDraftJob, runDueAutoDrafts } from '../ai/autodraft'
import { getBookingFrame, saveBookingFrame } from '../ai/schedule-session'
import {
  createProposal,
  executeProposalConfirmOp,
  handleProposalButtonClick,
  markProposalSent,
  proposalButtonId,
} from './index'
import { POST_BOOKING_BODY } from '../followup/post-booking'

// Qui 29/10/2026 15:00 UTC — mesmo padrão de execute-confirm.test (slot +24h = sexta).
const T0 = Date.UTC(2026, 9, 29, 15, 0)
const ESCLARECER = /Não peguei bem|outro jeito|reformular/i

async function seed() {
  const clock = createControllableClock(T0)
  const boot = bootClinicDb({ clock })
  const { db } = boot
  const tenantId = 'clinic-demo-postbook-confused'
  const caller = workerCaller(tenantId, 'user_synth_owner_a')
  clinicWhatsapp.syncWhatsappChannel(
    db,
    tenantId,
    {
      status: 'connected',
      bindingId: 'b_postbook',
      phoneNumberId: 'pn_postbook',
      wabaId: 'w_postbook',
      displayPhone: '+15550001111',
      displayName: 'Teste Tredane Whatsapp',
      action: 'channel_connected',
    },
    clock,
  )
  clinicInbox.seedSyntheticWhatsappTemplates(db, tenantId, clock)
  setClinicAiAssistEnabled(db, tenantId, true, clock)
  const room = upsertResourceOp(
    db,
    caller,
    { kind: 'room', name: 'Sala 1', category: 'Padrão' },
    clock,
  )
  const pro = upsertResourceOp(
    db,
    caller,
    { kind: 'professional', name: 'Samua', homeRoomId: room.id },
    clock,
  )
  const svc = upsertServiceOp(
    db,
    caller,
    {
      name: 'Massagem',
      durationMinutes: 60,
      bufferMinutes: 0,
      priceCents: 20_000,
      professionalIds: [pro.id],
      roomRequirement: { mode: 'rooms', resourceIds: [room.id] },
      variantKind: 'tipo',
      variantKindPlural: 'tipos',
      variantSelection: 'uma',
    },
    clock,
  )
  replaceServiceZonesOp(
    db,
    caller,
    svc.id,
    [
      {
        name: 'Massagem relaxante',
        audience: 'ambos',
        durationMinutes: 60,
        priceCents: 20_000,
      },
    ],
    clock,
  )
  const zone = db.get<{ id: string }>(
    `SELECT id FROM service_zones WHERE tenant_id = ? AND service_id = ? AND name = ?`,
    tenantId,
    svc.id,
    'Massagem relaxante',
  )!
  // T0=qui; startsAt=T0+24h → sexta (dayOfWeek 5, Mon=1).
  const startsAt = T0 + 24 * 60 * 60 * 1000
  setWeeklyWindowsOp(
    db,
    caller,
    {
      resourceId: pro.id,
      windows: [{ dayOfWeek: 5, startMinute: 9 * 60, endMinute: 18 * 60 }],
    },
    clock,
  )
  setWeeklyWindowsOp(
    db,
    caller,
    {
      resourceId: room.id,
      windows: [{ dayOfWeek: 5, startMinute: 9 * 60, endMinute: 18 * 60 }],
    },
    clock,
  )
  const contact = upsertContact(
    db,
    { tenantId, waId: '5511999000777', displayName: 'Cliente Staging' },
    clock,
  )
  const conversation = createConversation(
    db,
    { tenantId, contactId: contact.id, status: 'open' },
    clock,
  )
  insertMessage(
    db,
    {
      tenantId,
      conversationId: conversation.id,
      direction: 'inbound',
      body: 'quero massagem',
      externalMessageId: 'wamid.in_confused_1',
      deliveryState: 'received',
      createdAt: clock.nowMs(),
    },
    clock,
  )
  const proposal = createProposal(
    db,
    tenantId,
    {
      contactId: contact.id,
      conversationId: conversation.id,
      serviceId: svc.id,
      professionalId: pro.id,
      startsAt,
      zoneIds: [zone.id],
    },
    clock,
  )
  const marked = markProposalSent(db, tenantId, proposal.id, clock)
  db.run(
    `UPDATE appointment_proposals SET send_provider_message_id = ? WHERE tenant_id = ? AND id = ?`,
    'wamid.proposal_confused',
    tenantId,
    proposal.id,
  )
  saveBookingFrame(
    db,
    tenantId,
    conversation.id,
    {
      serviceId: svc.id,
      variantIds: [zone.id],
      date: '2026-10-30',
      time: '15:00',
      phase: 'ofertado',
      pending: {
        slot: 'horario',
        options: [
          { key: '2026-10-30T15:00', label: '15:00' },
          { key: '2026-10-30T15:30', label: '15:30' },
        ],
        messageId: 'm_slots_confused',
      },
      lastOffer: {
        slots: [{ startsAt, professionalId: pro.id }],
        messageId: 'm_slots_confused',
      },
    },
    clock,
  )
  return {
    ...boot,
    clock,
    caller,
    tenantId,
    contact,
    conversation,
    proposal: marked,
  }
}

describe('pós-Agendado sem esclarecer spurioso', () => {
  it('autodraft de [Botão] Confirmar não emite esclarecer com pending choose_slot', async () => {
    const s = await seed()
    try {
      const confirmInbound = insertMessage(
        s.db,
        {
          tenantId: s.tenantId,
          conversationId: s.conversation.id,
          direction: 'inbound',
          body: '[Botão] Confirmar',
          deliveryState: 'received',
          createdAt: s.clock.nowMs(),
        },
        s.clock,
      )
      const job = enqueueAutoDraft(
        s.db,
        s.tenantId,
        { conversationId: s.conversation.id, messageId: confirmInbound.id },
        s.clock,
      )
      expect(job).not.toBeNull()
      expect(getBookingFrame(s.db, s.tenantId, s.conversation.id)?.pending?.slot).toBe(
        'horario',
      )

      s.clock.advance(7_000)
      const outcomes = await runDueAutoDrafts(s.db, s.caller, s.clock, {
        mode: 'synthetic',
        adapter: new SimulatedAiAdapter(),
      })
      expect(outcomes.some((o) => o.reason === 'proposal_confirm_button')).toBe(true)
      const bodies = s.db
        .all<{ body: string }>(
          `SELECT body FROM messages WHERE tenant_id = ? AND conversation_id = ? AND direction = 'outbound'`,
          s.tenantId,
          s.conversation.id,
        )
        .map((r) => r.body)
      expect(bodies.some((b) => ESCLARECER.test(b))).toBe(false)
    } finally {
      s.close()
    }
  })

  it('Confirmar S5 cancela autodraft, limpa pending e não deixa esclarecer após Agendado', async () => {
    const s = await seed()
    try {
      const confirmInbound = insertMessage(
        s.db,
        {
          tenantId: s.tenantId,
          conversationId: s.conversation.id,
          direction: 'inbound',
          body: '[Botão] Confirmar',
          deliveryState: 'received',
          createdAt: s.clock.nowMs(),
        },
        s.clock,
      )
      enqueueAutoDraft(
        s.db,
        s.tenantId,
        { conversationId: s.conversation.id, messageId: confirmInbound.id },
        s.clock,
      )
      expect(getAutoDraftJob(s.db, s.tenantId, s.conversation.id)).not.toBeNull()

      const click = handleProposalButtonClick(
        s.db,
        {
          tenantId: s.tenantId,
          contactId: s.contact.id,
          conversationId: s.conversation.id,
          buttonId: proposalButtonId(s.proposal.id, s.proposal.version, 'confirm'),
          contextMessageId: 'wamid.proposal_confused',
          providerEventKey: 'evt_confused_1',
        },
        s.clock,
      )
      expect(getAutoDraftJob(s.db, s.tenantId, s.conversation.id)).toBeNull()
      expect(click.handled).toBe(true)
      if (!('handoff' in click)) throw new Error('expected handoff')

      const result = await executeProposalConfirmOp(
        s.db,
        s.caller,
        {
          handoff: click.handoff,
          capability: true,
          providerEventKey: 'evt_confused_1',
          contextMessageId: 'wamid.proposal_confused',
          senderContactId: s.contact.id,
        },
        s.clock,
      )
      expect(result.status).toBe('booked')

      expect(getBookingFrame(s.db, s.tenantId, s.conversation.id)).toBeNull()

      enqueueAutoDraft(
        s.db,
        s.tenantId,
        { conversationId: s.conversation.id, messageId: confirmInbound.id },
        s.clock,
      )
      s.clock.advance(7_000)
      await runDueAutoDrafts(s.db, s.caller, s.clock, {
        mode: 'synthetic',
        adapter: new SimulatedAiAdapter(),
      })

      const bodies = s.db
        .all<{ body: string }>(
          `SELECT body FROM messages
           WHERE tenant_id = ? AND conversation_id = ? AND direction = 'outbound'
           ORDER BY created_at ASC, id ASC`,
          s.tenantId,
          s.conversation.id,
        )
        .map((r) => r.body)
      expect(bodies.some((b) => /^Agendado:/i.test(b))).toBe(true)
      expect(bodies.some((b) => b === POST_BOOKING_BODY)).toBe(true)
      expect(bodies.some((b) => ESCLARECER.test(b))).toBe(false)
    } finally {
      s.close()
    }
  })
})
