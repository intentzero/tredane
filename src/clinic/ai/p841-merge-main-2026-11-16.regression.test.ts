/**
 * Merge #841 (P20/P21) + main (#837 slot-offer, #839 upcoming reminder) — autobook.ts.
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
import { listServices } from '../config/services'
import { tryAiAutoBook } from './autobook'
import { CLIENT_FRUSTRATION_APOLOGY } from './client-frustration-turn'
import { PAYMENT_METHOD_REPLY } from './client-copy'
import { PAYMENT_METHOD_REPLY_REPEAT } from './payment-method-turn'
import { loadTurnContext } from './turn-context'
import { saveBookingFrame } from './schedule-session'
import { upcomingAppointmentsOfferPrefix } from './contact-appointment-hint'

const TZ = 'America/Sao_Paulo'

describe('merge #841 + main — frustração, pagamento e oferta com lembrete', () => {
  it('P21 não reoferta horários; P20 anti-repeat; pedido de horário mantém upcoming (#837/#839)', async () => {
    const NOW = Date.UTC(2026, 10, 16, 14, 0)
    const clock = createControllableClock(NOW)
    const boot = bootClinicDb({ clock })
    const { db } = boot
    const tenantId = 'clinic-demo-p841-merge'
    const caller = workerCaller(tenantId, 'user_synth_owner_a')
    syncWhatsappChannel(
      db,
      tenantId,
      {
        status: 'connected',
        bindingId: 'b_p841',
        phoneNumberId: 'p_p841',
        wabaId: 'w_p841',
        displayPhone: '+5511900001999',
        displayName: 'C',
        action: 'channel_connected',
      },
      clock,
    )
    const room = upsertResourceOp(db, caller, { kind: 'room', name: 'Sala', category: 'Sala' }, clock)
    const pro = upsertResourceOp(db, caller, { kind: 'professional', name: 'Samua', homeRoomId: room.id }, clock)
    const week = [1, 2, 3, 4, 5].map((d) => ({ dayOfWeek: d, startMinute: 540, endMinute: 1080 }))
    setWeeklyWindowsOp(db, caller, { resourceId: pro.id, windows: week }, clock)
    setWeeklyWindowsOp(db, caller, { resourceId: room.id, windows: week }, clock)

    const limpeza = upsertServiceOp(
      db,
      caller,
      {
        name: 'Limpeza de pele profunda',
        durationMinutes: 60,
        bufferMinutes: 0,
        priceCents: 18_000,
        variantKind: null,
        variantKindPlural: null,
        variantSelection: 'uma',
        professionalIds: [pro.id],
        roomRequirement: { mode: 'none' },
      },
      clock,
    )
    const massagem = upsertServiceOp(
      db,
      caller,
      {
        name: 'Massagem modeladora',
        durationMinutes: 45,
        bufferMinutes: 0,
        priceCents: 16_000,
        variantKind: 'tipo',
        variantKindPlural: 'tipos',
        variantSelection: 'uma',
        professionalIds: [pro.id],
        roomRequirement: { mode: 'none' },
      },
      clock,
    )
    replaceServiceZonesOp(
      db,
      caller,
      massagem.id,
      [{ name: 'Sessão', audience: 'ambos', durationMinutes: 45, priceCents: 16_000 }],
      clock,
    )
    setClinicAiAssistEnabled(db, tenantId, true, clock)
    const contact = upsertContact(db, { tenantId, waId: '5511900001999', displayName: 'Bia' }, clock)
    const cnv = createConversation(db, { tenantId, contactId: contact.id, status: 'open' }, clock)

    confirmAppointmentOp(
      db,
      caller,
      {
        clientRequestId: 'apt-p841-upcoming',
        serviceId: limpeza.id,
        professionalId: pro.id,
        startsAt: zonedCivilToUtc(TZ, 2026, 11, 25, 10, 0),
        contactId: contact.id,
        conversationId: cnv.id,
        actorClerkUserId: caller.actorId!,
      },
      clock,
    )

    saveBookingFrame(
      db,
      tenantId,
      cnv.id,
      {
        serviceId: massagem.id,
        date: '2026-11-17',
        phase: 'ofertado',
        lastOffer: {
          slots: [{ startsAt: zonedCivilToUtc(TZ, 2026, 11, 17, 9, 0), professionalId: pro.id }],
          messageId: 'offer-p841',
        },
        pending: {
          slot: 'horario',
          options: [{ key: '2026-11-17T09:00', label: '09:00' }],
          messageId: 'offer-p841',
        },
      },
      clock,
    )

    const runTurn = async (body: string, offsetMs = 1000) => {
      const inbound = insertMessage(
        db,
        {
          tenantId,
          conversationId: cnv.id,
          direction: 'inbound',
          body,
          deliveryState: 'received',
          createdAt: clock.nowMs(),
        },
        clock,
      )
      clock.set(clock.nowMs() + offsetMs)
      const turn = loadTurnContext(
        db,
        tenantId,
        {
          conversationId: cnv.id,
          contactId: contact.id,
          messageId: inbound.id,
          inboundBody: inbound.body,
        },
        clock,
      )
      return tryAiAutoBook(db, caller, clock, {
        conversationId: cnv.id,
        enabled: true,
        capability: true,
        turn,
        confirmationMessageIdOverride: inbound.id,
      })
    }

    insertMessage(
      db,
      {
        tenantId,
        conversationId: cnv.id,
        direction: 'inbound',
        body: 'qnto custa?',
        deliveryState: 'received',
        createdAt: clock.nowMs() - 4000,
      },
      clock,
    )
    insertMessage(
      db,
      {
        tenantId,
        conversationId: cnv.id,
        direction: 'outbound',
        body: 'Para Massagem modeladora, o valor é R$ 160,00.',
        deliveryState: 'delivered',
        createdAt: clock.nowMs() - 2000,
      },
      clock,
    )

    const frustration = await runTurn('vc nao responde o q eu pergunto ne')
    expect(frustration.replyText ?? '').toContain(CLIENT_FRUSTRATION_APOLOGY)
    expect(frustration.replyText ?? '').toMatch(/160,00|R\$\s*160/)
    expect(frustration.replyText ?? '').not.toMatch(/hor[aá]rios?\s+dispon[ií]veis/i)
    expect(
      frustration.interactive?.mode === 'buttons' ? frustration.interactive.buttons?.length : 0,
    ).toBeGreaterThan(0)

    insertMessage(
      db,
      {
        tenantId,
        conversationId: cnv.id,
        direction: 'outbound',
        body: frustration.replyText ?? '',
        deliveryState: 'delivered',
        createdAt: clock.nowMs(),
      },
      clock,
    )
    clock.set(clock.nowMs() + 2000)

    const payFirst = await runTurn('vcs aceitam cartao? da pra parcelar?')
    expect(payFirst.replyText ?? '').toMatch(/cart[aã]o|parcelamento|equipe confirma/i)
    expect((payFirst.replyText ?? '').trim()).toContain(PAYMENT_METHOD_REPLY.trim().slice(0, 18))

    insertMessage(
      db,
      {
        tenantId,
        conversationId: cnv.id,
        direction: 'outbound',
        body: payFirst.replyText ?? PAYMENT_METHOD_REPLY,
        deliveryState: 'delivered',
        createdAt: clock.nowMs(),
      },
      clock,
    )
    clock.set(clock.nowMs() + 2000)

    const paySecond = await runTurn('mas e o parcelamento??')
    expect(paySecond.replyText ?? '').toContain(PAYMENT_METHOD_REPLY_REPEAT)
    expect(paySecond.replyText ?? '').not.toBe(payFirst.replyText)

    insertMessage(
      db,
      {
        tenantId,
        conversationId: cnv.id,
        direction: 'outbound',
        body: paySecond.replyText ?? PAYMENT_METHOD_REPLY_REPEAT,
        deliveryState: 'delivered',
        createdAt: clock.nowMs(),
      },
      clock,
    )
    clock.set(clock.nowMs() + 2000)

    const upcomingSnippet = upcomingAppointmentsOfferPrefix(db, tenantId, contact.id, TZ, clock)
    expect(upcomingSnippet).toMatch(/limpeza/i)

    const massagemRow = listServices(db, tenantId).find((s) => s.id === massagem.id)!
    saveBookingFrame(
      db,
      tenantId,
      cnv.id,
      {
        serviceId: massagem.id,
        date: '2026-11-17',
        period: 'manha',
        phase: 'coletando',
        variantIds: massagemRow.zones.filter((z) => z.active).map((z) => z.id),
      },
      clock,
    )

    const slotAsk = await runTurn('tem horario amanha de manha pra massagem?')
    const slotReply = slotAsk.replyText ?? ''
    expect(slotReply).toMatch(/hor[aá]rio|dispon/i)

    insertMessage(
      db,
      {
        tenantId,
        conversationId: cnv.id,
        direction: 'outbound',
        body: slotReply,
        deliveryState: 'delivered',
        createdAt: clock.nowMs(),
      },
      clock,
    )
    clock.set(clock.nowMs() + 2000)

    const slotRepeatGuard = await runTurn('tem horario amanha de manha?')
    const guarded = slotRepeatGuard.replyText ?? ''
    expect(guarded).toMatch(/hor[aá]rio|melhor|serve/i)
    expect(guarded).not.toBe(slotReply)

    boot.close()
  })
})