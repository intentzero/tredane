/**
 * Triagem staging 16/11/2026 — P19 (cancel dia errado) e P2/P13 (remarcação «de terça»).
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
import { queryAvailability } from '../scheduling/query'
import { confirmAppointmentOp, rescheduleAppointmentOp, zonedCivilToUtc } from '../scheduling'
import { bootClinicDb } from '../test-db'
import { syncWhatsappChannel } from '../whatsapp/channel'
import {
  handleCancelIntentAutodraft,
  resolveCancelTargetAppointment,
  tryCancelAutodraftContinuation,
} from './cancel-flow'
import { tryAiReschedule } from './reschedule'

const TZ = 'America/Sao_Paulo'
/** Seg 16/11/2026 ~12:00 SP — alinhado ao rsamp P19 */
const NOW_P19 = Date.UTC(2026, 10, 16, 15, 4)

function seedMicro(tenantSuffix: string, now: number) {
  const clock = createControllableClock(now)
  const boot = bootClinicDb({ clock })
  const { db } = boot
  const tenantId = `clinic-demo-p19-${tenantSuffix}`
  const caller = workerCaller(tenantId, 'user_synth_owner_a')
  syncWhatsappChannel(
    db,
    tenantId,
    {
      status: 'connected',
      bindingId: 'b',
      phoneNumberId: 'p',
      wabaId: 'w',
      displayPhone: '+5511999000000',
      displayName: 'Lab',
      action: 'channel_connected',
    },
    clock,
  )
  const room = upsertResourceOp(db, caller, { kind: 'room', name: 'Sala', category: 'Sala' }, clock)
  const pro = upsertResourceOp(db, caller, { kind: 'professional', name: 'Thaís', homeRoomId: room.id }, clock)
  const micro = upsertServiceOp(
    db,
    caller,
    {
      name: 'Microagulhamento',
      durationMinutes: 60,
      bufferMinutes: 0,
      priceCents: 45_000,
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
    micro.id,
    [{ name: 'Sessão', audience: 'ambos', durationMinutes: 60, priceCents: 45_000 }],
    clock,
  )
  const week = [1, 2, 3, 4, 5].map((d) => ({ dayOfWeek: d, startMinute: 480, endMinute: 1080 }))
  setWeeklyWindowsOp(db, caller, { resourceId: pro.id, windows: week }, clock)
  setWeeklyWindowsOp(db, caller, { resourceId: room.id, windows: week }, clock)
  setClinicAiAssistEnabled(db, tenantId, true, clock)
  const contact = upsertContact(db, { tenantId, waId: '5500000001055', displayName: 'Priscila' }, clock)
  const cnv = createConversation(db, { tenantId, contactId: contact.id, status: 'open' }, clock)
  return { ...boot, db, clock, tenantId, caller, contact, cnv, micro, pro, zones }
}

describe('P19 — cancelar «de quinta» com marcação na sexta', () => {
  it('rsamp: desvio de dia, sem imprevisto, remarcar só após confirmação', async () => {
    const s = seedMicro('p19', NOW_P19)
    try {
      const mon = zonedCivilToUtc(TZ, 2026, 11, 16, 12, 15)
      const fri = zonedCivilToUtc(TZ, 2026, 11, 20, 12, 0)
      const aptMon = confirmAppointmentOp(
        s.db,
        s.caller,
        {
          clientRequestId: 'apt-mon',
          serviceId: s.micro.id,
          professionalId: s.pro.id,
          startsAt: mon,
          contactId: s.contact.id,
          conversationId: s.cnv.id,
          actorClerkUserId: s.caller.actorId!,
          zoneIds: s.zones.map((z) => z.id),
        },
        s.clock,
      )
      rescheduleAppointmentOp(
        s.db,
        s.caller,
        {
          clientRequestId: 'reschedule-p19',
          appointmentId: aptMon.value.id,
          reason: 'contato_remarcou',
          serviceId: s.micro.id,
          professionalId: s.pro.id,
          startsAt: fri,
          actorClerkUserId: s.caller.actorId!,
          zoneIds: s.zones.map((z) => z.id),
        },
        s.clock,
      )

      const res = resolveCancelTargetAppointment(
        s.db,
        s.tenantId,
        s.contact.id,
        'oi, vou ter q cancelar o microagulhamento de quinta',
        s.clock,
      )
      expect(res.kind).toBe('day_mismatch')
      if (res.kind !== 'day_mismatch') return
      expect(res.replyText).toMatch(/quinta/i)
      expect(res.replyText).toMatch(/20\/11|sexta/i)
      expect(res.replyText).toMatch(/é essa/i)
      expect(res.replyText).not.toMatch(/imprevisto/i)
      expect(res.replyText).not.toMatch(/remarcar/i)

      const start = handleCancelIntentAutodraft(
        s.db,
        s.tenantId,
        s.cnv.id,
        s.contact.id,
        'oi, vou ter q cancelar o microagulhamento de quinta',
        s.clock,
      )
      expect(start.handled).toBe(true)
      if (!start.handled) return
      expect(start.reason).toBe('cancel_day_mismatch')
      expect(start.replyText).not.toMatch(/remarcar/i)

      const ack = tryCancelAutodraftContinuation(
        s.db,
        s.tenantId,
        s.cnv.id,
        'sim, essa mesma',
        s.clock,
      )
      expect(ack.handled).toBe(true)
      if (!ack.handled) return
      expect(ack.reason).toBe('cancel_offer_reschedule')
      expect(ack.replyText).toMatch(/remarcar/i)
      expect(ack.replyText).not.toMatch(/imprevisto/i)
      expect(ack.interactive?.buttons?.[0]?.title).not.toBe('Cancelar marcação')
    } finally {
      s.close()
    }
  })

  it('remarcação libera o horário antigo na agenda', async () => {
    const s = seedMicro('slot-free', NOW_P19)
    try {
      const mon = zonedCivilToUtc(TZ, 2026, 11, 16, 12, 15)
      const fri = zonedCivilToUtc(TZ, 2026, 11, 20, 12, 0)
      const aptMon = confirmAppointmentOp(
        s.db,
        s.caller,
        {
          clientRequestId: 'apt-mon2',
          serviceId: s.micro.id,
          professionalId: s.pro.id,
          startsAt: mon,
          contactId: s.contact.id,
          conversationId: s.cnv.id,
          actorClerkUserId: s.caller.actorId!,
          zoneIds: s.zones.map((z) => z.id),
        },
        s.clock,
      )
      const before = queryAvailability(
        s.db,
        s.tenantId,
        { serviceId: s.micro.id, date: '2026-11-16' },
        s.clock,
      )
      expect(before.slots.some((slot) => slot.startsAt === mon)).toBe(false)

      rescheduleAppointmentOp(
        s.db,
        s.caller,
        {
          clientRequestId: 'reschedule-slot',
          appointmentId: aptMon.value.id,
          reason: 'contato_remarcou',
          serviceId: s.micro.id,
          professionalId: s.pro.id,
          startsAt: fri,
          actorClerkUserId: s.caller.actorId!,
          zoneIds: s.zones.map((z) => z.id),
        },
        s.clock,
      )

      const after = queryAvailability(
        s.db,
        s.tenantId,
        { serviceId: s.micro.id, date: '2026-11-16' },
        s.clock,
      )
      expect(after.slots.some((slot) => slot.startsAt === mon)).toBe(true)
      const moved = s.db.get<{ starts_at: number }>(
        `SELECT starts_at FROM appointments WHERE tenant_id = ? AND id = ?`,
        s.tenantId,
        aptMon.value.id,
      )
      expect(moved?.starts_at).toBe(fri)
    } finally {
      s.close()
    }
  })
})

describe('P2/P13 — remarcar «minha drenagem de terça»', () => {
  it('rsamp: terça identifica o compromisso, não oferece o horário actual', async () => {
    const s = seedMicro('p2', NOW_P19)
    try {
      const drenagem = upsertServiceOp(
        s.db,
        s.caller,
        {
          name: 'Drenagem linfática',
          durationMinutes: 45,
          bufferMinutes: 0,
          priceCents: 16_000,
          variantKind: 'tipo',
          variantKindPlural: 'tipos',
          variantSelection: 'uma',
          professionalIds: [s.pro.id],
          roomRequirement: { mode: 'none' },
        },
        s.clock,
      )
      const tue = zonedCivilToUtc(TZ, 2026, 11, 17, 9, 0)
      confirmAppointmentOp(
        s.db,
        s.caller,
        {
          clientRequestId: 'apt-dren',
          serviceId: drenagem.id,
          professionalId: s.pro.id,
          startsAt: tue,
          contactId: s.contact.id,
          conversationId: s.cnv.id,
          actorClerkUserId: s.caller.actorId!,
          zoneIds: [],
        },
        s.clock,
      )
      const out = await tryAiReschedule(s.db, s.caller, s.clock, {
        conversationId: s.cnv.id,
        inboundText: 'oi, preciso remarcar minha drenagem de terca',
        capability: true,
      })
      expect(out?.replyText).toMatch(/qual dia|prefere/i)
      expect(out?.replyText ?? '').not.toMatch(/Na ter[cç]a 17\/11 tenho 09:00/)
      expect(out?.replyText ?? '').not.toMatch(/09:15/)
    } finally {
      s.close()
    }
  })

  it('oferta noutro dia não repete 09:15 nem o slot marcado', async () => {
    const s = seedMicro('p2b', NOW_P19)
    try {
      const drenagem = upsertServiceOp(
        s.db,
        s.caller,
        {
          name: 'Drenagem linfática',
          durationMinutes: 45,
          bufferMinutes: 0,
          priceCents: 16_000,
          variantKind: 'tipo',
          variantKindPlural: 'tipos',
          variantSelection: 'uma',
          professionalIds: [s.pro.id],
          roomRequirement: { mode: 'none' },
        },
        s.clock,
      )
      const tue = zonedCivilToUtc(TZ, 2026, 11, 17, 9, 0)
      confirmAppointmentOp(
        s.db,
        s.caller,
        {
          clientRequestId: 'apt-dren2',
          serviceId: drenagem.id,
          professionalId: s.pro.id,
          startsAt: tue,
          contactId: s.contact.id,
          conversationId: s.cnv.id,
          actorClerkUserId: s.caller.actorId!,
          zoneIds: [],
        },
        s.clock,
      )
      const out = await tryAiReschedule(s.db, s.caller, s.clock, {
        conversationId: s.cnv.id,
        inboundText: 'quero remarcar para sexta de manha',
        capability: true,
      })
      expect(out?.replyText).toMatch(/sexta|20\/11/i)
      expect(out?.replyText ?? '').not.toMatch(/ter[cç]a\s+17\/11/i)
      expect(out?.replyText ?? '').not.toMatch(/09:15/)
    } finally {
      s.close()
    }
  })
})