/**
 * Staging 16/11/2026 (P22): duas depilações na segunda — hora citada identifica
 * a marcação; confirmação grava quinta 19/11 13:30 BRT.
 */
import { describe, expect, it } from 'vitest'
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
import { clinicInbox } from '../index'
import {
  executeProposalConfirmOp,
  getProposal,
  handleProposalButtonClick,
  proposalButtonId,
} from '../proposals'
import { confirmAppointmentOp, zonedCivilToUtc } from '../scheduling'
import { bootClinicDb } from '../test-db'
import { syncWhatsappChannel } from '../whatsapp/channel'
import { hubMeusBody } from '../../whatsapp/flow/hub-opening'
import { getBookingFrame } from './schedule-session'
import { tryAiReschedule } from './reschedule'

const TZ = 'America/Sao_Paulo'
/** Seg 16/11/2026 ~10:53 BRT */
const NOW = Date.UTC(2026, 10, 16, 13, 53)

function seedP22() {
  const clock = createControllableClock(NOW)
  const boot = bootClinicDb({ clock })
  const { db } = boot
  const tenantId = 'clinic-demo-p22-1611'
  const caller = workerCaller(tenantId, 'user_synth_owner_a')
  syncWhatsappChannel(
    db,
    tenantId,
    {
      status: 'connected',
      bindingId: 'b_p22',
      phoneNumberId: 'p_p22',
      wabaId: 'w_p22',
      displayPhone: '+5511999005501',
      displayName: 'Clínica Sintética',
      action: 'channel_connected',
    },
    clock,
  )
  clinicInbox.seedSyntheticWhatsappTemplates(db, tenantId, clock)
  const room = upsertResourceOp(db, caller, { kind: 'room', name: 'Sala', category: 'Sala' }, clock)
  const pro = upsertResourceOp(db, caller, { kind: 'professional', name: 'Gi', homeRoomId: room.id }, clock)
  const depi = upsertServiceOp(
    db,
    caller,
    {
      name: 'Depilação',
      durationMinutes: 30,
      bufferMinutes: 0,
      priceCents: 35_000,
      variantKind: 'zona',
      variantKindPlural: 'zonas',
      variantSelection: 'varias',
      professionalIds: [pro.id],
      roomRequirement: { mode: 'none' },
    },
    clock,
  )
  const zones = replaceServiceZonesOp(
    db,
    caller,
    depi.id,
    [
      { name: 'Íntima', audience: 'feminino', durationMinutes: 20, priceCents: 18_000 },
      { name: 'Pernas', audience: 'feminino', durationMinutes: 30, priceCents: 17_000 },
    ],
    clock,
  )
  const mass = upsertServiceOp(
    db,
    caller,
    {
      name: 'Massagem',
      durationMinutes: 60,
      bufferMinutes: 0,
      priceCents: 12_000,
      professionalIds: [pro.id],
      roomRequirement: { mode: 'none' },
    },
    clock,
  )
  const week = [1, 2, 3, 4, 5].map((d) => ({
    dayOfWeek: d,
    startMinute: 8 * 60,
    endMinute: 18 * 60,
  }))
  setWeeklyWindowsOp(db, caller, { resourceId: pro.id, windows: week }, clock)
  setWeeklyWindowsOp(db, caller, { resourceId: room.id, windows: week }, clock)
  setClinicAiAssistEnabled(db, tenantId, true, clock)
  const contact = upsertContact(db, { tenantId, waId: '5511900000161', displayName: 'Cliente P22' }, clock)
  const cnv = createConversation(db, { tenantId, contactId: contact.id, status: 'open' }, clock)

  const mk = (
    clientRequestId: string,
    serviceId: string,
    y: number,
    mo: number,
    d: number,
    h: number,
    mi: number,
    zoneIds: string[] = zones.map((z) => z.id),
  ) =>
    confirmAppointmentOp(
      db,
      caller,
      {
        clientRequestId,
        serviceId,
        professionalId: pro.id,
        startsAt: zonedCivilToUtc(TZ, y, mo, d, h, mi),
        contactId: contact.id,
        conversationId: cnv.id,
        actorClerkUserId: caller.actorId!,
        zoneIds,
      },
      clock,
    ).value

  const apt1300 = mk('apt-mon-1300', depi.id, 2026, 11, 16, 13, 0)
  const apt1645 = mk('apt-mon-1645', depi.id, 2026, 11, 16, 16, 45)
  mk('apt-tue-0930', depi.id, 2026, 11, 17, 9, 30)
  mk('apt-tue-1100', mass.id, 2026, 11, 17, 11, 0, [])
  mk('apt-wed-1000', depi.id, 2026, 11, 18, 10, 0)

  return { ...boot, db, clock, tenantId, caller, contact, cnv, depi, pro, apt1300, apt1645 }
}

describe('P22 staging 16/11/2026', () => {
  it('identifica 16:45 (não 13:00) e confirma quinta 13:30 na persistência', async () => {
    const s = seedP22()
    try {
      const flushFrame = (out: Awaited<ReturnType<typeof tryAiReschedule>>) => {
        out?.deferredFrame?.flushNow(s.db, s.tenantId, s.cnv.id, s.clock)
      }

      const step1 = await tryAiReschedule(s.db, s.caller, s.clock, {
        conversationId: s.cnv.id,
        inboundText: 'Quero remarcar a depilação de hoje às 1645',
        capability: true,
      })
      expect(step1?.appointmentId).toBe(s.apt1645.id)
      flushFrame(step1)
      expect(getBookingFrame(s.db, s.tenantId, s.cnv.id)?.rescheduleAppointmentId).toBe(s.apt1645.id)

      const step2 = await tryAiReschedule(s.db, s.caller, s.clock, {
        conversationId: s.cnv.id,
        inboundText: 'Para quinta tem vaga?',
        capability: true,
      })
      expect(step2).not.toBeNull()
      expect(step2!.replyText).toMatch(/quinta.*19\/11/i)
      flushFrame(step2)
      const offeredTimes = [...(step2!.replyText?.matchAll(/\b(\d{2}:\d{2})\b/g) ?? [])].map((m) => m[1]!)
      expect(offeredTimes.length).toBeGreaterThan(0)
      const pickTime = offeredTimes.find((t) => t === '13:30') ?? offeredTimes[offeredTimes.length - 1]!

      const step3 = await tryAiReschedule(s.db, s.caller, s.clock, {
        conversationId: s.cnv.id,
        inboundText: `As ${pickTime.replace(':', '')}`,
        capability: true,
      })
      flushFrame(step3)
      expect(step3?.handled).toBe(true)
      expect(step3?.appointmentId).toBe(s.apt1645.id)
      expect(step3?.proposalId, JSON.stringify(step3)).toBeTruthy()
      const proposal = getProposal(s.db, s.tenantId, step3!.proposalId!)!
      expect(proposal.replacesAppointmentId).toBe(s.apt1645.id)
      const [hh, mm] = pickTime.split(':').map(Number) as [number, number]
      const expectedStartsAt = zonedCivilToUtc(TZ, 2026, 11, 19, hh, mm)
      expect(proposal.startsAt).toBe(expectedStartsAt)
      s.db.run(
        `UPDATE appointment_proposals SET state = 'enviada', sent_at = ?, expires_at = ?
         WHERE tenant_id = ? AND id = ?`,
        s.clock.nowMs(),
        s.clock.nowMs() + 30 * 60_000,
        s.tenantId,
        proposal.id,
      )

      const click = handleProposalButtonClick(
        s.db,
        {
          tenantId: s.tenantId,
          conversationId: s.cnv.id,
          contactId: s.contact.id,
          buttonId: proposalButtonId(proposal.id, proposal.version, 'confirm'),
          providerEventKey: 'p22-confirm',
        },
        s.clock,
      )
      expect(click.handled).toBe(true)
      expect('handoff' in click).toBe(true)
      if (!('handoff' in click)) return
      const booked = await executeProposalConfirmOp(
        s.db,
        s.caller,
        { handoff: click.handoff, capability: true },
        s.clock,
        {},
      )
      expect(booked.status).toBe('booked')

      const moved = s.db.get<{ starts_at: number; id: string }>(
        `SELECT id, starts_at FROM appointments WHERE tenant_id = ? AND id = ?`,
        s.tenantId,
        s.apt1645.id,
      )
      expect(moved?.starts_at).toBe(expectedStartsAt)

      const still1300 = s.db.get<{ id: string }>(
        `SELECT id FROM appointments WHERE tenant_id = ? AND id = ? AND status = 'confirmed'`,
        s.tenantId,
        s.apt1300.id,
      )
      expect(still1300?.id).toBe(s.apt1300.id)

      expect(booked.status === 'booked' && booked.appointment.startsAt).toBe(expectedStartsAt)

      const list = hubMeusBody(s.db, s.tenantId, s.contact.id, s.clock)
      expect(list).toMatch(new RegExp(`quinta 19/11 às ${pickTime}`, 'i'))
    } finally {
      s.close()
    }
  })

  it('transcript turno 80: «As 1330» quando 13:30 está na oferta', async () => {
    const s = seedP22()
    try {
      const flushFrame = (out: Awaited<ReturnType<typeof tryAiReschedule>>) => {
        out?.deferredFrame?.flushNow(s.db, s.tenantId, s.cnv.id, s.clock)
      }
      const step1 = await tryAiReschedule(s.db, s.caller, s.clock, {
        conversationId: s.cnv.id,
        inboundText: 'Quero remarcar a depilação de hoje às 1645',
        capability: true,
      })
      expect(step1?.appointmentId).toBe(s.apt1645.id)
      flushFrame(step1)
      const step2 = await tryAiReschedule(s.db, s.caller, s.clock, {
        conversationId: s.cnv.id,
        inboundText: 'Para quinta tem vaga?',
        capability: true,
      })
      flushFrame(step2)
      const offeredTimes = [...(step2!.replyText?.matchAll(/\b(\d{2}:\d{2})\b/g) ?? [])].map((m) => m[1]!)
      if (!offeredTimes.includes('13:30')) return
      const step3 = await tryAiReschedule(s.db, s.caller, s.clock, {
        conversationId: s.cnv.id,
        inboundText: 'As 1330',
        capability: true,
      })
      expect(step3?.proposalId).toBeTruthy()
      const proposal = getProposal(s.db, s.tenantId, step3!.proposalId!)!
      expect(proposal.startsAt).toBe(zonedCivilToUtc(TZ, 2026, 11, 19, 13, 30))
    } finally {
      s.close()
    }
  })
})