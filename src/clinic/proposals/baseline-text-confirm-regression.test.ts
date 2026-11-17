/**
 * Regressão laboratório — confirmação por texto com proposta aberta (S02, S07b, S09b; DEC-061).
 */
import { describe, expect, it } from 'vitest'
import { SimulatedAiAdapter } from '../../ai'
import { createControllableClock } from '../../db/clock'
import { setWeeklyWindowsOp, upsertResourceOp, upsertServiceOp } from '../config'
import { setClinicAiAssistEnabled } from '../config/settings'
import { upsertContact } from '../contacts'
import { workerCaller } from '../index'
import { createConversation } from '../inbox/conversations'
import { insertMessage } from '../inbox/messages'
import { bootClinicDb } from '../test-db'
import { syncWhatsappChannel } from '../whatsapp/channel'
import { enqueueAutoDraft, runDueAutoDrafts } from '../ai/autodraft'
import { createProposal, markProposalSent, renderProposalInteractive } from './index'
import { PROPOSAL_CONFIRM_NUDGE_LEAD } from './text-confirm-nudge'

const T0 = Date.UTC(2026, 10, 15, 15, 0)

function seed() {
  const clock = createControllableClock(T0)
  const boot = bootClinicDb({ clock })
  const { db } = boot
  const tenantId = 'clinic-demo-baseline-text-confirm'
  const caller = workerCaller(tenantId, 'user_synth_owner_a')
  syncWhatsappChannel(
    db,
    tenantId,
    {
      status: 'connected',
      bindingId: 'bind_base',
      phoneNumberId: 'pn_base',
      wabaId: 'waba_base',
      displayPhone: '+5511900000099',
      displayName: 'Clínica Demo',
      action: 'channel_connected',
    },
    clock,
  )
  const room = upsertResourceOp(db, caller, { kind: 'room', name: 'Sala 1', category: 'Sala' }, clock)
  const pro = upsertResourceOp(db, caller, { kind: 'professional', name: 'Conceição', homeRoomId: room.id }, clock)
  const svc = upsertServiceOp(
    db,
    caller,
    {
      name: 'Drenagem linfática',
      durationMinutes: 45,
      bufferMinutes: 0,
      priceCents: 16_000,
      professionalIds: [pro.id],
      roomRequirement: { mode: 'rooms', resourceIds: [room.id] },
      variantSelection: 'uma',
    },
    clock,
  )
  const week = [1, 2, 3, 4, 5].map((d) => ({ dayOfWeek: d, startMinute: 9 * 60, endMinute: 19 * 60 }))
  setWeeklyWindowsOp(db, caller, { resourceId: pro.id, windows: week }, clock)
  setWeeklyWindowsOp(db, caller, { resourceId: room.id, windows: week }, clock)
  setClinicAiAssistEnabled(db, tenantId, true, clock)
  const contact = upsertContact(db, { tenantId, waId: '5511999000111', displayName: 'Bia' }, clock)
  const cnv = createConversation(db, { tenantId, contactId: contact.id, status: 'open' }, clock)
  return { ...boot, clock, tenantId, caller, cnv, svc, pro, room, contact }
}

async function say(s: ReturnType<typeof seed>, body: string) {
  s.clock.advance(60_000)
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

function appointmentCount(s: ReturnType<typeof seed>): number {
  return s.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM appointments WHERE tenant_id = ?`, s.tenantId)!.n
}

describe('baseline 15/11 — confirmação por texto (S07b)', () => {
  it('«sim» com proposta enviada reoferece Confirmar sem marcar nem prometer equipe', async () => {
    const s = seed()
    try {
      const startsAt = Date.UTC(2026, 10, 18, 16, 0)
      const proposal = createProposal(
        s.db,
        s.tenantId,
        {
          contactId: s.contact.id,
          conversationId: s.cnv.id,
          serviceId: s.svc.id,
          professionalId: s.pro.id,
          startsAt,
        },
        s.clock,
      )
      markProposalSent(s.db, s.tenantId, proposal.id, s.clock)
      const out = await say(s, 'sim')
      expect(appointmentCount(s)).toBe(0)
      expect(out[0]?.autoBook?.status).toBe('requires_button')
      const bodies = s.db
        .all<{ body: string }>(
          `SELECT body FROM messages WHERE tenant_id = ? AND conversation_id = ? AND direction = 'outbound' ORDER BY created_at ASC`,
          s.tenantId,
          s.cnv.id,
        )
        .map((r) => r.body)
      expect(bodies.some((b) => b.includes(PROPOSAL_CONFIRM_NUDGE_LEAD))).toBe(true)
      expect(bodies.some((b) => /Show!|equipe validar|Não consigo confirmar|deixar sua solicitação/i.test(b))).toBe(
        false,
      )
      const buttons =
        out[0]?.autoBook?.interactive?.mode === 'buttons'
          ? (out[0].autoBook.interactive.buttons ?? [])
          : []
      expect(buttons).toHaveLength(1)
      expect(buttons[0]?.title).toBe('Confirmar')
    } finally {
      s.close()
    }
  }, 30_000)

  it.each([
    ['isso pode confirmar', 'S02'],
    ['ok aguardo entao obg', 'S02'],
    ['ok 👍', 'S07b'],
  ])('lab %s — afirmativa %j reoferta 1× Confirmar sem marcar', async (text, lab) => {
    expect(lab).toMatch(/^S/)
    const s = seed()
    try {
      const startsAt = Date.UTC(2026, 10, 18, 16, 0)
      const proposal = createProposal(
        s.db,
        s.tenantId,
        {
          contactId: s.contact.id,
          conversationId: s.cnv.id,
          serviceId: s.svc.id,
          professionalId: s.pro.id,
          startsAt,
        },
        s.clock,
      )
      markProposalSent(s.db, s.tenantId, proposal.id, s.clock)
      const out = await say(s, text)
      expect(appointmentCount(s)).toBe(0)
      expect(out[0]?.autoBook?.status).toBe('requires_button')
      expect(out[0]?.autoBook?.replyText).toContain(PROPOSAL_CONFIRM_NUDGE_LEAD)
      expect(out[0]?.autoBook?.replyText).toMatch(/Drenagem|13:00/i)
      expect(
        out[0]?.autoBook?.interactive?.mode === 'buttons' ? out[0].autoBook.interactive.buttons : [],
      ).toHaveLength(1)
    } finally {
      s.close()
    }
  }, 30_000)

  it('sem proposta aberta — «sim» não dispara nudge', async () => {
    const s = seed()
    try {
      const out = await say(s, 'sim')
      expect(appointmentCount(s)).toBe(0)
      expect(out[0]?.autoBook?.replyText ?? '').not.toBe(PROPOSAL_CONFIRM_NUDGE_LEAD)
    } finally {
      s.close()
    }
  }, 30_000)

  it('cartão da proposta usa copy natural (item 9)', () => {
    const s = seed()
    try {
      const free = upsertServiceOp(
        s.db,
        s.caller,
        {
          name: 'Avaliação estética',
          durationMinutes: 30,
          bufferMinutes: 0,
          priceCents: 0,
          professionalIds: [s.pro.id],
          roomRequirement: { mode: 'rooms', resourceIds: [s.room.id] },
        },
        s.clock,
      )
      const proposal = createProposal(
        s.db,
        s.tenantId,
        {
          contactId: s.contact.id,
          conversationId: s.cnv.id,
          serviceId: free.id,
          professionalId: s.pro.id,
          startsAt: Date.UTC(2026, 10, 19, 15, 0),
        },
        s.clock,
      )
      const body = renderProposalInteractive(proposal, s.db).body
      expect(body).toMatch(/^Fica assim:/)
      expect(body).toContain('gratuita')
      expect(body).not.toMatch(/Válida até|Proposta de horário/i)
    } finally {
      s.close()
    }
  })

})