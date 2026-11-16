/**
 * Regressão laboratório 1c7fbfae (15–16/11/2026) — itens #813 parcial e residuais S02/S06/S09b.
 */
import { describe, expect, it } from 'vitest'
import { createControllableClock } from '../../db/clock'
import { setWeeklyWindowsOp, upsertResourceOp, upsertServiceOp } from '../config'
import { setClinicAiAssistEnabled } from '../config/settings'
import { upsertContact } from '../contacts'
import { workerCaller } from '../index'
import { createConversation } from '../inbox/conversations'
import { insertMessage } from '../inbox/messages'
import { confirmAppointmentOp, zonedCivilToUtc } from '../scheduling'
import { bootClinicDb } from '../test-db'
import { syncWhatsappChannel } from '../whatsapp/channel'
import { tryAiAutoBook } from './autobook'
import {
  listFutureContactAppointments,
  upcomingAppointmentsOfferPrefix,
} from './contact-appointment-hint'
import { offerNearestSlots, pickNearbySameDay } from './slot-offer'
import { saveBookingFrame, saveScheduleSession } from './schedule-session'
import { loadTurnContext } from './turn-context'
import { isMyAppointmentsQuery, hubMeusBody } from '../../whatsapp/flow/hub-opening'

const TZ = 'America/Sao_Paulo'

function seedBase(tenantId: string, waId: string, now: number) {
  const clock = createControllableClock(now)
  const boot = bootClinicDb({ clock })
  const { db } = boot
  const caller = workerCaller(tenantId, 'user_synth_owner_a')
  syncWhatsappChannel(
    db,
    tenantId,
    {
      status: 'connected',
      bindingId: `b_${tenantId}`,
      phoneNumberId: 'p1',
      wabaId: 'w1',
      displayPhone: '+5511999990001',
      displayName: 'Demo',
      action: 'channel_connected',
    },
    clock,
  )
  const room = upsertResourceOp(db, caller, { kind: 'room', name: 'Sala', category: 'Sala' }, clock)
  const pro = upsertResourceOp(
    db,
    caller,
    { kind: 'professional', name: 'Pro', homeRoomId: room.id },
    clock,
  )
  const week = [1, 2, 3, 4, 5, 6, 7].map((d) => ({
    dayOfWeek: d,
    startMinute: 9 * 60,
    endMinute: 19 * 60,
  }))
  setWeeklyWindowsOp(db, caller, { resourceId: pro.id, windows: week }, clock)
  setWeeklyWindowsOp(db, caller, { resourceId: room.id, windows: week }, clock)
  setClinicAiAssistEnabled(db, tenantId, true, clock)
  const contact = upsertContact(db, { tenantId, waId, displayName: 'Cliente' }, clock)
  const cnv = createConversation(db, { tenantId, contactId: contact.id, status: 'open' }, clock)
  return { ...boot, clock, db, tenantId, caller, pro, room, contact, cnv }
}

describe('marcação existente (#813)', () => {
  it('detecta «já tenho alguma marcação?»', () => {
    expect(isMyAppointmentsQuery('já tenho alguma marcação?')).toBe(true)
  })

  it('hub lista compromisso futuro', () => {
    const NOW = Date.UTC(2026, 10, 15, 15, 0)
    const s = seedBase('clinic-demo-lab-gislaine-list', '5511900001241', NOW)
    try {
      const avaliacao = upsertServiceOp(
        s.db,
        s.caller,
        {
          name: 'Avaliação estética',
          durationMinutes: 30,
          bufferMinutes: 0,
          priceCents: 0,
          variantKind: 'tipo',
          variantKindPlural: 'tipos',
          variantSelection: 'uma',
          professionalIds: [s.pro.id],
          roomRequirement: { mode: 'none' },
        },
        s.clock,
      )
      const starts = zonedCivilToUtc(TZ, 2026, 11, 19, 11, 45)
      confirmAppointmentOp(
        s.db,
        s.caller,
        {
          clientRequestId: 'apt-gislaine',
          serviceId: avaliacao.id,
          professionalId: s.pro.id,
          startsAt: starts,
          contactId: s.contact.id,
          conversationId: s.cnv.id,
          actorClerkUserId: s.caller.actorId!,
        },
        s.clock,
      )
      const body = hubMeusBody(s.db, s.tenantId, s.contact.id, s.clock)
      expect(body).toMatch(/Avaliação estética/i)
      expect(body).toMatch(/11:45/)
      expect(listFutureContactAppointments(s.db, s.tenantId, s.contact.id, s.clock)).toHaveLength(1)
      const prefix = upcomingAppointmentsOfferPrefix(
        s.db,
        s.tenantId,
        s.contact.id,
        TZ,
        s.clock,
      )
      expect(prefix).toMatch(/Avaliação estética/i)
      expect(prefix).toMatch(/11:45/)
    } finally {
      s.close()
    }
  })

  it('2.º serviço: lembrete upcoming antes da oferta', () => {
    const NOW = Date.UTC(2026, 10, 15, 15, 0)
    const s = seedBase('clinic-demo-lab-813b-prefix', '5511900001242', NOW)
    try {
      const limpeza = upsertServiceOp(
        s.db,
        s.caller,
        {
          name: 'Limpeza de pele profunda',
          durationMinutes: 60,
          bufferMinutes: 0,
          priceCents: 18_000,
          variantKind: null,
          variantKindPlural: null,
          variantSelection: 'uma',
          professionalIds: [s.pro.id],
          roomRequirement: { mode: 'none' },
        },
        s.clock,
      )
      const starts = zonedCivilToUtc(TZ, 2026, 11, 25, 10, 0)
      confirmAppointmentOp(
        s.db,
        s.caller,
        {
          clientRequestId: 'apt-lab-813b',
          serviceId: limpeza.id,
          professionalId: s.pro.id,
          startsAt: starts,
          contactId: s.contact.id,
          conversationId: s.cnv.id,
          actorClerkUserId: s.caller.actorId!,
        },
        s.clock,
      )
      const prefix = upcomingAppointmentsOfferPrefix(
        s.db,
        s.tenantId,
        s.contact.id,
        TZ,
        s.clock,
      )
      expect(prefix).toMatch(/você já tem/i)
      expect(prefix).toMatch(/limpeza/i)
      expect(prefix).toMatch(/10:00/)
    } finally {
      s.close()
    }
  })
})

describe('S06 — «amanhã 12:30» nomeia horário ocupado', () => {
  it('1.º turno cita 12:30 indisponível', async () => {
    const NOW = Date.UTC(2026, 10, 15, 15, 0)
    const s = seedBase('clinic-demo-lab-s06-name', '5511900000106', NOW)
    try {
      const limpeza = upsertServiceOp(
        s.db,
        s.caller,
        {
          name: 'Limpeza de pele profunda',
          durationMinutes: 60,
          bufferMinutes: 0,
          priceCents: 18_000,
          variantKind: null,
          variantKindPlural: null,
          variantSelection: 'uma',
          professionalIds: [s.pro.id],
          roomRequirement: { mode: 'none' },
        },
        s.clock,
      )
      const occupied = zonedCivilToUtc(TZ, 2026, 11, 16, 12, 30)
      confirmAppointmentOp(
        s.db,
        s.caller,
        {
          clientRequestId: 'block-1230',
          serviceId: limpeza.id,
          professionalId: s.pro.id,
          startsAt: occupied,
          contactId: s.contact.id,
          conversationId: s.cnv.id,
          actorClerkUserId: s.caller.actorId!,
        },
        s.clock,
      )
      const inbound = insertMessage(
        s.db,
        {
          tenantId: s.tenantId,
          conversationId: s.cnv.id,
          direction: 'inbound',
          body: 'amanha 12:30 limpeza de pele',
          deliveryState: 'received',
          createdAt: s.clock.nowMs(),
        },
        s.clock,
      )
      const turn = loadTurnContext(
        s.db,
        s.tenantId,
        {
          conversationId: s.cnv.id,
          contactId: s.contact.id,
          messageId: inbound.id,
          inboundBody: inbound.body,
        },
        s.clock,
      )
      const out = await tryAiAutoBook(s.db, s.caller, s.clock, {
        conversationId: s.cnv.id,
        enabled: true,
        capability: true,
        turn,
        confirmationMessageIdOverride: inbound.id,
      })
      expect(out.replyText ?? '').toMatch(/12:30/)
      expect(out.replyText ?? '').toMatch(
        /não tenho vaga|já não tenho vaga|já está ocupado|ocupado/i,
      )
    } finally {
      s.close()
    }
  })
})

describe('S09b — «meio dia e meia» mantém dia ofertado', () => {
  it('não pergunta «qual dia» com lastOffer no quadro', async () => {
    const NOW = Date.UTC(2026, 10, 15, 15, 0)
    const s = seedBase('clinic-demo-lab-s09b-day', '5511900001091', NOW)
    try {
      const limpeza = upsertServiceOp(
        s.db,
        s.caller,
        {
          name: 'Limpeza de pele profunda',
          durationMinutes: 60,
          bufferMinutes: 0,
          priceCents: 18_000,
          variantKind: null,
          variantKindPlural: null,
          variantSelection: 'uma',
          professionalIds: [s.pro.id],
          roomRequirement: { mode: 'none' },
        },
        s.clock,
      )
      const offerDay = '2026-11-23'
      const starts = zonedCivilToUtc(TZ, 2026, 11, 23, 9, 0)
      saveBookingFrame(
        s.db,
        s.tenantId,
        s.cnv.id,
        {
          serviceId: limpeza.id,
          date: offerDay,
          phase: 'ofertado',
          pending: {
            slot: 'horario',
            options: [{ key: `${offerDay}T09:00`, label: 'segunda 23/11 09:00' }],
            messageId: 'off',
          },
          lastOffer: {
            slots: [{ startsAt: starts, professionalId: s.pro.id }],
            messageId: 'off',
          },
        },
        s.clock,
      )
      saveScheduleSession(
        s.db,
        s.tenantId,
        s.cnv.id,
        { serviceId: limpeza.id, phase: 'ofertado' },
        s.clock,
      )
      insertMessage(
        s.db,
        {
          tenantId: s.tenantId,
          conversationId: s.cnv.id,
          direction: 'outbound',
          body: 'Os horários disponíveis para segunda 23/11 são 09:00, 09:30, 10:00. Algum serve?',
          deliveryState: 'delivered',
          createdAt: s.clock.nowMs() - 30_000,
        },
        s.clock,
      )
      const inbound = insertMessage(
        s.db,
        {
          tenantId: s.tenantId,
          conversationId: s.cnv.id,
          direction: 'inbound',
          body: 'meio dia e meia ta bom sim',
          deliveryState: 'received',
          createdAt: s.clock.nowMs(),
        },
        s.clock,
      )
      const turn = loadTurnContext(
        s.db,
        s.tenantId,
        {
          conversationId: s.cnv.id,
          contactId: s.contact.id,
          messageId: inbound.id,
          inboundBody: inbound.body,
        },
        s.clock,
      )
      const out = await tryAiAutoBook(s.db, s.caller, s.clock, {
        conversationId: s.cnv.id,
        enabled: true,
        capability: true,
        turn,
        confirmationMessageIdOverride: inbound.id,
      })
      expect(out.status, out.notes ?? String(out.status)).not.toBe('not_confirmed')
      expect(out.replyText ?? '').not.toMatch(/qual dia fica melhor/i)
      expect(
        (out.replyText ?? '').length > 0 ||
          Boolean(out.interactive) ||
          (out.outbox?.length ?? 0) > 0,
      ).toBe(true)
    } finally {
      s.close()
    }
  })
})

describe('S02 — alternativas «16h30»', () => {
  it('pickNearbySameDay não inclui 13:30 após pedido de tarde', () => {
    const tz = TZ
    const slots = ['13:30', '16:30', '17:30', '17:45'].map((t) => {
      const [h, m] = t.split(':').map(Number) as [number, number]
      return { startsAt: zonedCivilToUtc(tz, 2026, 11, 16, h, m) }
    })
    const nearby = pickNearbySameDay(slots, '16:30', tz, { period: 'tarde', limit: 3 })
    expect(nearby).toEqual(['17:30', '17:45'])
    expect(nearby).not.toContain('13:30')
  })

  it('offerNearestSlots com requestedHHMM responde sem_vaga', async () => {
    const NOW = Date.UTC(2026, 10, 15, 15, 0)
    const s = seedBase('clinic-demo-lab-s02-1630', '5511900000102', NOW)
    try {
      const avaliacao = upsertServiceOp(
        s.db,
        s.caller,
        {
          name: 'Avaliação estética',
          durationMinutes: 30,
          bufferMinutes: 0,
          priceCents: 0,
          variantKind: 'tipo',
          variantKindPlural: 'tipos',
          variantSelection: 'uma',
          professionalIds: [s.pro.id],
          roomRequirement: { mode: 'none' },
        },
        s.clock,
      )
      const tomorrow = '2026-11-16'
      const block = zonedCivilToUtc(TZ, 2026, 11, 16, 16, 30)
      confirmAppointmentOp(
        s.db,
        s.caller,
        {
          clientRequestId: 'block-1630',
          serviceId: avaliacao.id,
          professionalId: s.pro.id,
          startsAt: block,
          contactId: s.contact.id,
          conversationId: s.cnv.id,
          actorClerkUserId: s.caller.actorId!,
        },
        s.clock,
      )
      const offered = await offerNearestSlots({
        db: s.db,
        tenantId: s.tenantId,
        service: { ...avaliacao, zones: [], active: true },
        zones: [],
        tz: TZ,
        clock: s.clock,
        professionalId: s.pro.id,
        date: tomorrow,
        requestedHHMM: '16:30',
        limit: 3,
        conversationId: s.cnv.id,
      })
      expect(offered.replyText).toMatch(/16:30/)
      expect(offered.replyText).toMatch(/17:30/)
      expect(offered.replyText).not.toMatch(/13:30/)
    } finally {
      s.close()
    }
  })
})