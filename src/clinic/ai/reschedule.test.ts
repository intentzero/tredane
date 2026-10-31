/**
 * DEC-091 / REQ-101: «Posso reagendar para quarta?» não reinicia o funil de zonas.
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
import { handleProposalButtonClick } from '../proposals/buttons'
import { executeProposalConfirmOp } from '../proposals/execute-confirm'
import { getProposal } from '../proposals/proposals'
import { proposalButtonId } from '../proposals/render'
import { confirmAppointmentOp, zonedCivilToUtc } from '../scheduling'
import { bootClinicDb } from '../test-db'
import { syncWhatsappChannel } from '../whatsapp/channel'
import { enqueueAutoDraft, runDueAutoDrafts } from './index'
import { HUMAN_HANDOFF_TEXT } from './human-handoff'
import { RESCHEDULE_OFFER_MARKER, isRescheduleIntent } from './reschedule'

const TZ = 'America/Sao_Paulo'
// Sexta 31/10/2026 14:40 em São Paulo (turno do screenshot).
const NOW = Date.UTC(2026, 9, 31, 17, 40)

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
      bindingId: 'bind_reschedule',
      phoneNumberId: 'pn_reschedule',
      wabaId: 'waba_reschedule',
      displayPhone: '+5511900000088',
      displayName: 'Clínica Reschedule',
      action: 'channel_connected',
    },
    clock,
  )
  const room = upsertResourceOp(db, caller, { kind: 'room', name: 'Sala Depilação', category: 'Sala' }, clock)
  const gi = upsertResourceOp(
    db,
    caller,
    { kind: 'professional', name: 'Gi', homeRoomId: room.id },
    clock,
  )
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
  const contact = upsertContact(db, { tenantId, waId: '5511900000088', displayName: 'Paulo' }, clock)
  const cnv = createConversation(db, { tenantId, contactId: contact.id, status: 'open' }, clock)

  const tue10 = zonedCivilToUtc(TZ, 2026, 11, 3, 10, 0)
  const booked = confirmAppointmentOp(
    db,
    caller,
    {
      clientRequestId: 'seed-apt-tue',
      serviceId: svc.id,
      professionalId: gi.id,
      startsAt: tue10,
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
    const m = insertMessage(
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
    return m
  }
  const run = async () => {
    const last = db.get<{ id: string }>(
      `SELECT id FROM messages WHERE conversation_id = ? AND direction = 'inbound' ORDER BY created_at DESC LIMIT 1`,
      cnv.id,
    )!
    enqueueAutoDraft(db, tenantId, { conversationId: cnv.id, messageId: last.id }, clock)
    clock.advance(7_000)
    const out = await runDueAutoDrafts(db, caller, clock, {
      mode: 'synthetic',
      adapter: new SimulatedAiAdapter(),
    })
    expect(out).toHaveLength(1)
    return out[0]!
  }
  const lastOutbound = () =>
    db.get<{ body: string }>(
      `SELECT body FROM messages WHERE conversation_id = ? AND direction = 'outbound' ORDER BY created_at DESC LIMIT 1`,
      cnv.id,
    )?.body ?? ''

  return {
    ...boot,
    clock,
    caller,
    tenantId,
    gi,
    svc,
    cnv,
    contact,
    aptId: booked.value.id,
    say,
    run,
    lastOutbound,
  }
}

describe('isRescheduleIntent', () => {
  it('reconhece reagendar e soft «posso … para quarta»', () => {
    expect(isRescheduleIntent('Posso reagendar para quarta?', { hasUpcoming: true, priorOffer: false })).toBe(
      true,
    )
    expect(isRescheduleIntent('Posso para quarta?', { hasUpcoming: true, priorOffer: false })).toBe(true)
    expect(isRescheduleIntent('Quero marcar para quarta', { hasUpcoming: true, priorOffer: false })).toBe(false)
    expect(isRescheduleIntent('Quero cancelar', { hasUpcoming: true, priorOffer: false })).toBe(false)
    expect(isRescheduleIntent('14h', { hasUpcoming: true, priorOffer: true })).toBe(true)
  })
})

describe('DEC-091 reagendamento conversacional', () => {
  it('screenshot: «Posso reagendar para quarta?» oferece slots e não pergunta zonas', async () => {
    const s = seed()
    try {
      s.say(
        'outbound',
        'Pode falar, Paulo! Seu horário de depilação segue marcado para terça (03/11), às 10:00. Em que posso ajudar?',
      )
      s.say('inbound', 'Posso reagendar para quarta?')
      const out = await s.run()
      expect(out.reason).toBe('reschedule_flow')
      const body = s.lastOutbound()
      expect(body).toContain(RESCHEDULE_OFFER_MARKER)
      expect(body.toLowerCase()).not.toMatch(/qual zona/)
      expect(body.toLowerCase()).not.toMatch(/temos axila/)
      expect(body).toMatch(/quarta/i)
      expect(body).toMatch(/\d{2}:\d{2}/)
    } finally {
      s.close()
    }
  })

  it('sem vagas: pede outro dia sem perguntar zonas', async () => {
    const s = seed()
    try {
      // Domingo: sem expediente da Gi (só seg–sex).
      s.say('inbound', 'Posso reagendar para domingo?')
      const out = await s.run()
      expect(out.reason).toBe('reschedule_flow')
      const body = s.lastOutbound()
      expect(body).toMatch(/não tenho horário livre|outro dia/i)
      expect(body.toLowerCase()).not.toMatch(/qual zona/)
    } finally {
      s.close()
    }
  })

  it('escolhe horário → proposta replace → Confirmar actualiza o mesmo compromisso', async () => {
    const s = seed()
    try {
      s.say('inbound', 'Posso reagendar para quarta?')
      await s.run()
      const offer = s.lastOutbound()
      expect(offer).toContain(RESCHEDULE_OFFER_MARKER)
      const times = [...offer.matchAll(/\b(\d{2}:\d{2})\b/g)].map((m) => m[1]!)
      expect(times.length).toBeGreaterThan(0)
      const pick = times[0]!
      s.say('inbound', pick)
      const second = await s.run()
      expect(second.reason).toBe('reschedule_flow')
      const proposalRow = s.db.get<{ id: string }>(
        `SELECT id FROM appointment_proposals WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 1`,
        s.tenantId,
      )
      expect(proposalRow).toBeTruthy()
      const proposal = getProposal(s.db, s.tenantId, proposalRow!.id)!
      expect(proposal.replacesAppointmentId).toBe(s.aptId)
      expect(proposal.serviceId).toBe(s.svc.id)

      s.db.run(
        `UPDATE appointment_proposals SET state = 'enviada', sent_at = ?, expires_at = ? WHERE id = ?`,
        s.clock.nowMs(),
        s.clock.nowMs() + 30 * 60_000,
        proposal.id,
      )
      const click = handleProposalButtonClick(
        s.db,
        {
          tenantId: s.tenantId,
          contactId: s.contact.id,
          conversationId: s.cnv.id,
          buttonId: proposalButtonId(proposal.id, proposal.version, 'confirm'),
        },
        s.clock,
      )
      expect(click.handled).toBe(true)
      expect('handoff' in click).toBe(true)
      if (!('handoff' in click)) return
      const result = await executeProposalConfirmOp(
        s.db,
        s.caller,
        { handoff: click.handoff, capability: true },
        s.clock,
        {},
      )
      expect(result.status).toBe('booked')
      if (result.status !== 'booked') return
      expect(result.appointment.id).toBe(s.aptId)
      expect(result.appointment.startsAt).toBe(proposal.startsAt)
      const count = s.db.get<{ n: number }>(
        `SELECT COUNT(*) AS n FROM appointments WHERE tenant_id = ? AND contact_id = ? AND status = 'confirmed'`,
        s.tenantId,
        s.contact.id,
      )!.n
      expect(count).toBe(1)
    } finally {
      s.close()
    }
  })

  it('cancelar continua handoff humano', async () => {
    const s = seed()
    try {
      s.say('inbound', 'Quero cancelar o horário')
      const out = await s.run()
      expect(out.reason).toBe('human_handoff')
      expect(s.lastOutbound()).toBe(HUMAN_HANDOFF_TEXT)
    } finally {
      s.close()
    }
  })
})
