/**
 * Regressão laboratório 78db4fa6 — cenários S02, S04, S06, S09b, S11 (15/11/2026).
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
import { insertMessage } from '../inbox/messages'
import { confirmAppointmentOp, zonedCivilToUtc } from '../scheduling'
import { bootClinicDb } from '../test-db'
import { syncWhatsappChannel } from '../whatsapp/channel'
import { tryAiAutoBook } from './autobook'
import { matchOfferedSlotFromText } from './booking-frame-choice'
import { handoffReason } from './human-handoff'
import { notBeforeTimeFromText } from './nlu/temporal'
import {
  createProposal,
  getActiveProposalForConversation,
  sendProposalToWhatsAppOp,
} from '../proposals'
import { clinicCivilDateFromUtc } from '../scheduling/timezone'
import { localHHMM } from './slot-offer'
import { offerNearestSlots } from './slot-offer'
import { getBookingFrame, saveBookingFrame } from './schedule-session'
import { loadTurnContext } from './turn-context'
import {
  detectTurnMisunderstanding,
  bumpMisunderstandingStreak,
  maybeEscalateMisunderstanding,
} from './turn-misunderstanding'

const TZ = 'America/Sao_Paulo'

function seedClinic(opts: { tenantId: string; waId: string; now: number }) {
  const clock = createControllableClock(opts.now)
  const boot = bootClinicDb({ clock })
  const { db } = boot
  const tenantId = opts.tenantId
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
  const contact = upsertContact(db, { tenantId, waId: opts.waId, displayName: 'Cliente' }, clock)
  const cnv = createConversation(db, { tenantId, contactId: contact.id, status: 'open' }, clock)
  return { ...boot, clock, db, tenantId, caller, pro, room, contact, cnv }
}

describe('S02 — «tem mais tarde? tipo dps das 4»', () => {
  it('notBefore 16:00 e oferta só depois de 16:00 no mesmo dia', async () => {
    expect(notBeforeTimeFromText('tem mais tarde? tipo dps das 4')).toBe('16:00')

    const s = seedClinic({
      tenantId: 'clinic-demo-lab-s02',
      waId: '5511900000102',
      now: Date.UTC(2026, 10, 15, 15, 0),
    })
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
      replaceServiceZonesOp(
        s.db,
        s.caller,
        avaliacao.id,
        [{ name: 'Sessão', audience: 'ambos', durationMinutes: 30, priceCents: 0 }],
        s.clock,
      )
      const tomorrow = '2026-11-16'
      const offered = await offerNearestSlots({
        db: s.db,
        tenantId: s.tenantId,
        service: { ...avaliacao, zones: [{ name: 'Sessão', active: true } as never], active: true },
        zones: [{ name: 'Sessão', active: true } as never],
        tz: TZ,
        clock: s.clock,
        professionalId: s.pro.id,
        date: tomorrow,
        notBeforeHHMM: '16:00',
        limit: 5,
        conversationId: s.cnv.id,
      })
      expect(offered.slots.length).toBeGreaterThan(0)
      expect(offered.slots.some((x) => x.time === '16:00')).toBe(false)
      expect(offered.slots.every((x) => x.time > '16:00')).toBe(true)
      const latest = offered.slots.reduce((a, b) => (a.time > b.time ? a : b)).time
      expect(latest > '16:00').toBe(true)
      expect(offered.replyText).toContain(latest)
      expect(offered.replyText).not.toMatch(/11:45/)
    } finally {
      s.close()
    }
  })
})

describe('S04 — preço respondido não dispara regra dos 2 desentendimentos', () => {
  it('reoferta com preço após «mas qual o valor…» não conta como duplicate_outbound', () => {
    const list =
      'Para Drenagem linfática, o valor é R$ 160,00 e a duração, 45 min. Os horários disponíveis para terça 17/11 são 12:30, 13:00, 15:15.'
  expect(
    detectTurnMisunderstanding({
      inboundBody: 'mas qual o valor da drenagem? antes de marcar',
      outboundBody: list,
      priorOutboundBody: list,
    }),
  ).toBeNull()
  })

})

describe('S06 — «amanha 12:30» com oferta aberta', () => {
  it('casa slot ofertado e autobook não fica em «qual horário você prefere?»', async () => {
    const NOW = Date.UTC(2026, 10, 15, 15, 0)
    const s = seedClinic({
      tenantId: 'clinic-demo-lab-s06',
      waId: '5511900000106',
      now: NOW,
    })
    try {
      const limpeza = upsertServiceOp(
        s.db,
        s.caller,
        {
          name: 'Limpeza de pele profunda',
          durationMinutes: 60,
          bufferMinutes: 0,
          priceCents: 18_000,
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
        limpeza.id,
        [{ name: 'Sessão', audience: 'ambos', durationMinutes: 60, priceCents: 18_000 }],
        s.clock,
      )
      const startsA = zonedCivilToUtc(TZ, 2026, 11, 16, 12, 30)
      const startsB = zonedCivilToUtc(TZ, 2026, 11, 17, 12, 30)
      saveBookingFrame(
        s.db,
        s.tenantId,
        s.cnv.id,
        {
          serviceId: limpeza.id,
          date: '2026-11-16',
          phase: 'ofertado',
          pending: {
            slot: 'horario',
            options: [
              { key: '2026-11-16T12:30', label: 'segunda 16/11 12:30' },
              { key: '2026-11-17T12:30', label: 'terça 17/11 12:30' },
            ],
            messageId: 'offer-s06',
          },
          lastOffer: {
            slots: [
              { startsAt: startsA, professionalId: s.pro.id },
              { startsAt: startsB, professionalId: s.pro.id },
            ],
            messageId: 'offer-s06',
          },
        },
        s.clock,
      )
      const matched = matchOfferedSlotFromText(
        'amanha 12:30',
        getBookingFrame(s.db, s.tenantId, s.cnv.id)?.pending ?? null,
        getBookingFrame(s.db, s.tenantId, s.cnv.id)?.lastOffer ?? null,
        TZ,
        '2026-11-15',
      )
      expect(matched.kind).toBe('match')

      const inbound = insertMessage(
        s.db,
        {
          tenantId: s.tenantId,
          conversationId: s.cnv.id,
          direction: 'inbound',
          body: 'amanha 12:30',
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
      expect(out.replyText ?? '').not.toMatch(/qual horário você prefere\?$/i)
    } finally {
      s.close()
    }
  })

  it('2.ª «qual horário prefere» seguida com hora no texto escala atendente', () => {
    const s = seedClinic({
      tenantId: 'clinic-demo-lab-s06-esc',
      waId: '5511900000106b',
      now: Date.UTC(2026, 10, 15, 15, 0),
    })
    try {
      const loop =
        'Para Limpeza de pele profunda, qual horário você prefere?'
      expect(
        detectTurnMisunderstanding({
          inboundBody: '12h30 de amanha ue, vc q falou',
          outboundBody: loop,
          priorOutboundBody: loop,
        }),
      ).toBe('ask_time_loop')
      const s1 = bumpMisunderstandingStreak(s.db, s.tenantId, s.cnv.id, s.clock)
      const s2 = bumpMisunderstandingStreak(s.db, s.tenantId, s.cnv.id, s.clock)
      const esc = maybeEscalateMisunderstanding(
        s.db,
        s.tenantId,
        { conversationId: s.cnv.id, messageId: 's06-2', streak: s2 },
        s.clock,
      )
      expect(s1).toBe(1)
      expect(esc.escalate).toBe(true)
    } finally {
      s.close()
    }
  })
})

describe('S09b — silêncio após «12 e 30 ue»', () => {
  it('proposta already_sent devolve reoferta Confirmar (não reply vazio)', async () => {
    const NOW = Date.UTC(2026, 10, 15, 15, 0)
    const s = seedClinic({
      tenantId: 'clinic-demo-lab-s09b',
      waId: '5511900001091',
      now: NOW,
    })
    try {
      const limpeza = upsertServiceOp(
        s.db,
        s.caller,
        {
          name: 'Limpeza de pele profunda',
          durationMinutes: 60,
          bufferMinutes: 0,
          priceCents: 18_000,
          variantKind: 'tipo',
          variantKindPlural: 'tipos',
          variantSelection: 'uma',
          professionalIds: [s.pro.id],
          roomRequirement: { mode: 'none' },
        },
        s.clock,
      )
      insertMessage(
        s.db,
        {
          tenantId: s.tenantId,
          conversationId: s.cnv.id,
          direction: 'inbound',
          body: 'limpeza de pele amanhã',
          deliveryState: 'received',
          createdAt: s.clock.nowMs() - 60_000,
        },
        s.clock,
      )
      const starts = zonedCivilToUtc(TZ, 2026, 11, 17, 12, 30)
      const proposal = createProposal(
        s.db,
        s.tenantId,
        {
          contactId: s.contact.id,
          conversationId: s.cnv.id,
          serviceId: limpeza.id,
          professionalId: s.pro.id,
          startsAt: starts,
          endsAt: starts + 60 * 60_000,
          durationMinutes: 60,
          zoneIds: [],
        },
        s.clock,
      )
      const sendResult = sendProposalToWhatsAppOp(
        s.db,
        s.caller,
        { proposalId: proposal.id },
        s.clock,
      )
      expect(sendResult.status).toBe('queued')
      const inbound = insertMessage(
        s.db,
        {
          tenantId: s.tenantId,
          conversationId: s.cnv.id,
          direction: 'inbound',
          body: '12 e 30 ue',
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
      saveBookingFrame(
        s.db,
        s.tenantId,
        s.cnv.id,
        {
          serviceId: limpeza.id,
          date: '2026-11-17',
          time: '12:30',
          phase: 'proposto',
        },
        s.clock,
      )
      const openBefore = getActiveProposalForConversation(
        s.db,
        s.tenantId,
        s.cnv.id,
        s.clock,
      )
      expect(openBefore?.state === 'enviada' || openBefore?.state === 'envio_pendente').toBe(true)
      expect(localHHMM(TZ, openBefore!.startsAt)).toBe('12:30')
      expect(clinicCivilDateFromUtc(TZ, openBefore!.startsAt)).toBe('2026-11-17')
      const out = await tryAiAutoBook(s.db, s.caller, s.clock, {
        conversationId: s.cnv.id,
        enabled: true,
        capability: true,
        turn,
        confirmationMessageIdOverride: inbound.id,
      })
      expect((out.replyText ?? '').trim().length).toBeGreaterThan(0)
      expect(out.replyText ?? '').toMatch(/Para confirmar, toca em Confirmar/)
      const buttons =
        out.interactive?.mode === 'buttons' ? (out.interactive.buttons ?? []) : []
      expect(buttons).toHaveLength(1)
      expect(buttons[0]?.title).toBe('Confirmar')
    } finally {
      s.close()
    }
  })
})

describe('S11 — cancelamento com compromisso confirmado', () => {
  it('pedido de cancelar vai a handoff sem cancelar o compromisso (sem confirmação falsa)', async () => {
    const s = seedClinic({
      tenantId: 'clinic-demo-lab-s11',
      waId: '5511900001011',
      now: Date.UTC(2026, 10, 15, 15, 0),
    })
    try {
      const limpeza = upsertServiceOp(
        s.db,
        s.caller,
        {
          name: 'Limpeza de pele profunda',
          durationMinutes: 60,
          bufferMinutes: 0,
          priceCents: 18_000,
          variantKind: 'tipo',
          variantKindPlural: 'tipos',
          variantSelection: 'uma',
          professionalIds: [s.pro.id],
          roomRequirement: { mode: 'none' },
        },
        s.clock,
      )
      const starts = zonedCivilToUtc(TZ, 2026, 11, 19, 15, 15)
      const booked = confirmAppointmentOp(
        s.db,
        s.caller,
        {
          clientRequestId: 'apt-s11-lab',
          serviceId: limpeza.id,
          professionalId: s.pro.id,
          startsAt: starts,
          contactLabel: 'Fernanda',
          actorClerkUserId: 'user_synth_owner_a',
          conversationId: s.cnv.id,
          contactId: s.contact.id,
        },
        s.clock,
      )
      const cancelText =
        'oi, vou ter q cancelar a limpeza de quinta, surgiu um imprevisto'
      const reason = handoffReason(s.db, s.tenantId, cancelText, s.clock, turnFromText(cancelText))
      expect(reason).toBe('human_only')

      const still = s.db.get<{ status: string }>(
        `SELECT status FROM appointments WHERE tenant_id = ? AND id = ?`,
        s.tenantId,
        booked.value.id,
      )
      expect(still?.status).toBe('confirmed')
    } finally {
      s.close()
    }
  })
})

function turnFromText(text: string) {
  return {
    turnText: text,
    messages: [{ direction: 'inbound' as const, body: text, created_at: 0 }],
    catalog: { services: [], resources: [], version: 'v0' },
    upcoming: { id: 'apt_x', serviceId: 'svc', professionalId: 'pro', startsAt: 0, endsAt: 0, serviceName: 'Limpeza' },
  }
}