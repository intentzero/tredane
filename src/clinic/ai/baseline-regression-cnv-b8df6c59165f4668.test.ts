/**
 * Staging cnv_b8df6c59165f4668 / rsamp_f72ce5908371eff3a9757281 (16/11/2026).
 */
import { describe, expect, it } from 'vitest'
import { createControllableClock } from '../../db/clock'
import { setWeeklyWindowsOp, upsertResourceOp, upsertServiceOp } from '../config'
import { setClinicAiAssistEnabled } from '../config/settings'
import { upsertContact } from '../contacts'
import { workerCaller } from '../index'
import { createConversation } from '../inbox/conversations'
import { insertMessage } from '../inbox/messages'
import { bootClinicDb } from '../test-db'
import { syncWhatsappChannel } from '../whatsapp/channel'
import { saveBookingFrame } from './schedule-session'
import { loadTurnContext } from './turn-context'
import { tryAiAutoBook } from './autobook'
import { turnLooksLikeDayOrTimeAsk } from './turn-friction'
import { parseIdleTextReply } from '../followup/idle'
import { planIdleContinueResume } from '../followup/idle-continue-resume'
import { createProposal, markProposalSent } from '../proposals/proposals'
import { zonedCivilToUtc } from '../scheduling'

const NOW = Date.UTC(2026, 10, 16, 21, 30)

function seed() {
  const clock = createControllableClock(NOW)
  const boot = bootClinicDb({ clock })
  const { db } = boot
  const tenantId = 'clinic-demo-cnv-b8df6c59165f4668'
  const caller = workerCaller(tenantId, 'user_synth_owner_a')
  syncWhatsappChannel(
    db,
    tenantId,
    {
      status: 'connected',
      bindingId: 'b_cnv_b8df',
      phoneNumberId: 'p_cnv',
      wabaId: 'w_cnv',
      displayPhone: '+5511999005500',
      displayName: 'Clínica',
      action: 'channel_connected',
    },
    clock,
  )
  const pro = upsertResourceOp(db, caller, { kind: 'professional', name: 'Luiza' }, clock)
  const svc = upsertServiceOp(
    db,
    caller,
    {
      name: 'Depilação a laser',
      durationMinutes: 15,
      bufferMinutes: 0,
      priceCents: 8000,
      professionalIds: [pro.id],
      roomRequirement: { mode: 'none' },
    },
    clock,
  )
  setWeeklyWindowsOp(
    db,
    caller,
    {
      resourceId: pro.id,
      windows: [1, 2, 3, 4, 5, 6].map((d) => ({ dayOfWeek: d, startMinute: 9 * 60, endMinute: 18 * 60 })),
    },
    clock,
  )
  setClinicAiAssistEnabled(db, tenantId, true, clock)
  const contact = upsertContact(db, { tenantId, waId: '5511999005500', displayName: 'Cliente' }, clock)
  const cnv = createConversation(db, { tenantId, contactId: contact.id, status: 'open' }, clock)
  insertMessage(
    db,
    {
      tenantId,
      conversationId: cnv.id,
      direction: 'inbound',
      body: 'Oi',
      deliveryState: 'received',
      createdAt: NOW - 120_000,
    },
    clock,
  )
  return { ...boot, db, clock, tenantId, caller, svc, pro, contact, cnv }
}

async function autoBookTurn(s: ReturnType<typeof seed>, body: string) {
  const inbound = insertMessage(
    s.db,
    {
      tenantId: s.tenantId,
      conversationId: s.cnv.id,
      direction: 'inbound',
      body,
      deliveryState: 'received',
      createdAt: s.clock.nowMs() + 1,
    },
    s.clock,
  )
  const turn = loadTurnContext(
    s.db,
    s.tenantId,
    {
      conversationId: s.cnv.id,
      contactId: s.cnv.contactId,
      messageId: inbound.id,
      inboundBody: inbound.body,
    },
    s.clock,
  )
  return tryAiAutoBook(s.db, s.caller, s.clock, {
    conversationId: s.cnv.id,
    enabled: true,
    capability: true,
    turn,
    confirmationMessageIdOverride: inbound.id,
  })
}

describe('cnv_b8df6c59165f4668 regressões', () => {
  it('seq36-39: «Quais horas» com choose_slot pendente → lista (não esclarecer)', async () => {
    const s = seed()
    try {
      expect(turnLooksLikeDayOrTimeAsk('Quais horas')).toBe(true)
      saveBookingFrame(
        s.db,
        s.tenantId,
        s.cnv.id,
        {
          serviceId: s.svc.id,
          catalogVersion: 'cv_b8df',
          date: '2026-11-17',
          pending: {
            slot: 'horario',
            messageId: 'msg_slot_list',
            options: [
              { key: '2026-11-17T14:00', label: 'terça 17/11 14:00' },
              { key: '2026-11-17T14:30', label: 'terça 17/11 14:30' },
            ],
          },
          phase: 'ofertado',
        },
        s.clock,
      )
      s.db.run(
        `INSERT INTO messages (id, tenant_id, conversation_id, direction, body, delivery_state, created_at)
         VALUES ('msg_slot_list', ?, ?, 'outbound', ?, 'delivered', ?)`,
        s.tenantId,
        s.cnv.id,
        'Terça 17/11: 14:00 ou 14:30?',
        s.clock.nowMs() - 60_000,
      )
      const out = await autoBookTurn(s, 'Quais horas')
      expect(out.replyText).not.toMatch(/Não peguei bem|Pode me dizer de outro jeito/i)
      expect(out.interactive).toBeTruthy()
      expect(out.interactive?.mode).toBe('list')
    } finally {
      s.close()
    }
  })

  it('seq40-46: «Quero continuar o atendimento» é tomado como Prosseguir', () => {
    expect(parseIdleTextReply('Quero continuar o atendimento')).toBe('continue')
  })

  it('seq40-46: proposta enviada prevalece sobre lista fresca no plano Prosseguir', () => {
    const s = seed()
    try {
      saveBookingFrame(
        s.db,
        s.tenantId,
        s.cnv.id,
        {
          serviceId: s.svc.id,
          catalogVersion: 'cv_prop',
          pending: {
            slot: 'horario',
            messageId: 'msg_slots_fresh',
            options: [{ key: '2026-11-17T15:00', label: '15:00' }],
          },
        },
        s.clock,
      )
      s.db.run(
        `INSERT INTO messages (id, tenant_id, conversation_id, direction, body, delivery_state, created_at)
         VALUES ('msg_slots_fresh', ?, ?, 'outbound', ?, 'delivered', ?)`,
        s.tenantId,
        s.cnv.id,
        'Horários',
        s.clock.nowMs() - 30_000,
      )
      const startsAt = zonedCivilToUtc('America/Sao_Paulo', 2026, 11, 17, 14, 0)
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
      const plan = planIdleContinueResume(s.db, s.tenantId, s.cnv.id, s.clock)
      expect(plan.mode).toBe('reoffer_proposal')
    } finally {
      s.close()
    }
  })
})