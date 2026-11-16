/**
 * Regressão laboratório 1c7fbfae (15–16/11/2026) — #813 (marcação existente) e S09b (meio dia e meia).
 */
import { describe, expect, it } from 'vitest'
import { createControllableClock } from '../../db/clock'
import { replaceServiceZonesOp, setWeeklyWindowsOp, upsertResourceOp, upsertServiceOp } from '../config'
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

  it('2.º serviço: lembrete upcoming com postProcess (lista Horários e anti-repetição)', async () => {
    const NOW = Date.UTC(2026, 10, 16, 13, 0)
    const s = seedBase('clinic-demo-lab-813-postprocess', '5511900001243', NOW)
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
      const startsExisting = zonedCivilToUtc(TZ, 2026, 11, 25, 10, 0)
      confirmAppointmentOp(
        s.db,
        s.caller,
        {
          clientRequestId: 'apt-lab-813-pp',
          serviceId: limpeza.id,
          professionalId: s.pro.id,
          startsAt: startsExisting,
          contactId: s.contact.id,
          conversationId: s.cnv.id,
          actorClerkUserId: s.caller.actorId!,
        },
        s.clock,
      )
      const massagem = upsertServiceOp(
        s.db,
        s.caller,
        {
          name: 'Massagem',
          durationMinutes: 60,
          bufferMinutes: 0,
          priceCents: 12_000,
          variantKind: 'tipo',
          variantKindPlural: 'tipos',
          variantSelection: 'uma',
          professionalIds: [s.pro.id],
          roomRequirement: { mode: 'none' },
        },
        s.clock,
      )
      replaceServiceZonesOp(
        s.db,
        s.caller,
        massagem.id,
        [{ name: 'Relaxante', audience: 'ambos', durationMinutes: 60, priceCents: 12_000 }],
        s.clock,
      )
      const runTurn = async (body: string) => {
        const inbound = insertMessage(
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
        s.clock.advance(1_000)
        const turn = loadTurnContext(
          s.db,
          s.tenantId,
          {
            conversationId: s.cnv.id,
            contactId: s.contact.id,
            messageId: inbound.id,
            inboundBody: body,
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
      const first = await runTurn('Quero massagem relaxante à tarde')
      expect(first.replyText ?? '').toMatch(/você já tem/i)
      expect(first.replyText ?? '').toMatch(/limpeza/i)
      expect(first.replyText ?? '').toMatch(/\d{1,2}:\d{2}/)
      expect(first.interactive?.button).toBe('Horários')
      const offerBody = first.replyText ?? ''
      insertMessage(
        s.db,
        {
          tenantId: s.tenantId,
          conversationId: s.cnv.id,
          direction: 'outbound',
          body: offerBody,
          deliveryState: 'delivered',
          createdAt: s.clock.nowMs(),
        },
        s.clock,
      )
      s.clock.advance(30_000)
      const second = await runTurn('massagem relaxante à tarde por favor')
      expect(second.replyText ?? '').toMatch(/você já tem/i)
      expect(second.replyText ?? '').not.toBe(offerBody)
      expect(second.interactive?.mode).not.toBe('list')
      expect(second.replyText ?? '').toMatch(/horário/i)
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
