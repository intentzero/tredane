/**
 * Lab Bloco C (15/11/2026): toque multi-dia Horários com a mesma HH:MM em dois dias
 * (ex. terça 15:15 + quarta 15:15) → Proposta, não «qual horário?».
 *
 * Causa: semanticTextForChoice devolve «às 15:15»; matchPendingChoice via ambíguo
 * e o early-return DEC-127 corria *antes* de boundSlot (id civil da linha).
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
import { zonedCivilToUtc } from '../scheduling'
import {
  encodeChoiceId,
  handleChoiceOfferClick,
  buildSlotChoiceInteractive,
} from './choice-offer'
import { slotListRowCopy } from './slot-offer'
import { saveBookingFrame } from './schedule-session'

const TZ = 'America/Sao_Paulo'
/** Domingo 15/11/2026 18:00 BRT — «amanhã» sticky = segunda 16/11. */
const NOW = Date.UTC(2026, 10, 15, 21, 0)

describe('Lab Bloco C — multi-day Horários tap (same HH:MM)', () => {
  it('toque «terça 17/11 15:15» com outro 15:15 na lista monta Proposta', async () => {
    const clock = createControllableClock(NOW)
    const boot = bootClinicDb({ clock })
    const { db } = boot
    const tenantId = 'clinic-demo-multiday-tap'
    const caller = workerCaller(tenantId, 'user_owner')
    syncWhatsappChannel(
      db,
      tenantId,
      {
        status: 'connected',
        bindingId: 'b',
        phoneNumberId: 'p',
        wabaId: 'w',
        displayPhone: '+5511900000001',
        action: 'channel_connected',
      },
      clock,
    )
    const room = upsertResourceOp(
      db,
      caller,
      { kind: 'room', name: 'Sala', category: 'estetica', capacity: 1 },
      clock,
    )
    const pro = upsertResourceOp(
      db,
      caller,
      { kind: 'professional', name: 'Conceição', homeRoomId: room.id },
      clock,
    )
    const week = [1, 2, 3, 4, 5].map((d) => ({
      dayOfWeek: d,
      startMinute: 540,
      endMinute: 1140,
    }))
    setWeeklyWindowsOp(db, caller, { resourceId: pro.id, windows: week }, clock)
    setWeeklyWindowsOp(db, caller, { resourceId: room.id, windows: week }, clock)
    const svc = upsertServiceOp(
      db,
      caller,
      {
        name: 'Limpeza de pele profunda',
        durationMinutes: 60,
        bufferMinutes: 15,
        priceCents: 18000,
        professionalIds: [pro.id],
        roomRequirement: { mode: 'rooms', resourceIds: [room.id] },
      },
      clock,
    )
    setClinicAiAssistEnabled(db, tenantId, true, clock)
    const contact = upsertContact(
      db,
      { tenantId, waId: '5511900000001', displayName: 'Lab' },
      clock,
    )
    const cnv = createConversation(db, { tenantId, contactId: contact.id, status: 'open' }, clock)

    const slotKey = '2026-11-17T15:15'
    const title = slotListRowCopy('2026-11-17', '15:15').title
    expect(title).toMatch(/terça/)

    const built = buildSlotChoiceInteractive({
      catalogVersion: 'cv1',
      slots: [
        { key: slotKey, label: title },
        { key: '2026-11-18T12:30', label: slotListRowCopy('2026-11-18', '12:30').title },
        { key: '2026-11-18T15:15', label: slotListRowCopy('2026-11-18', '15:15').title },
      ],
    })

    const offerMsg = insertMessage(
      db,
      {
        tenantId,
        conversationId: cnv.id,
        direction: 'outbound',
        body: 'Não tenho horário livre amanhã. Os próximos são terça 17/11 às 15:15 e quarta…',
        deliveryState: 'delivered',
        createdAt: clock.nowMs(),
      },
      clock,
    )

    saveBookingFrame(
      db,
      tenantId,
      cnv.id,
      {
        serviceId: svc.id,
        catalogVersion: 'cv1',
        date: '2026-11-16',
        phase: 'ofertado',
        pending: { ...built.pending, messageId: offerMsg.id },
        lastOffer: {
          slots: [
            { startsAt: zonedCivilToUtc(TZ, 2026, 11, 17, 15, 15), professionalId: pro.id },
            { startsAt: zonedCivilToUtc(TZ, 2026, 11, 18, 12, 30), professionalId: pro.id },
            { startsAt: zonedCivilToUtc(TZ, 2026, 11, 18, 15, 15), professionalId: pro.id },
          ],
          messageId: offerMsg.id,
        },
      },
      clock,
    )

    insertMessage(
      db,
      {
        tenantId,
        conversationId: cnv.id,
        direction: 'inbound',
        body: `[Lista] ${title}`,
        deliveryState: 'received',
        createdAt: clock.nowMs() + 1000,
      },
      clock,
    )

    const result = await handleChoiceOfferClick(
      db,
      caller,
      {
        tenantId,
        conversationId: cnv.id,
        buttonId: encodeChoiceId('horario', 'cv1', slotKey),
        buttonTitle: title,
        providerEventKey: 'lab:bloco-c-multiday',
        capability: true,
      },
      clock,
    )

    expect(result.handled).toBe(true)
    if (!result.handled) return
    expect(result.outcome).toBe('applied')
    expect(result.autoBook?.proposalId).toBeTruthy()
    expect(result.autoBook?.replyText ?? '').not.toMatch(/qual horário/i)
    const bodies = db
      .all<{ body: string }>(
        `SELECT body FROM messages WHERE tenant_id = ? AND conversation_id = ? AND direction = 'outbound' ORDER BY created_at, id`,
        tenantId,
        cnv.id,
      )
      .map((r) => r.body)
    expect(bodies.some((b) => /Fica assim:/i.test(b))).toBe(true)
    boot.close()
  })
})
