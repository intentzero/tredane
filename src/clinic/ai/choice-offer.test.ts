/**
 * M5 (#415) / DEC-128 — ids opacos, validação de oferta e parse.
 */
import { describe, expect, it } from 'vitest'
import { createControllableClock } from '../../db/clock'
import { upsertContact } from '../contacts'
import { createConversation } from '../inbox/conversations'
import { insertMessage } from '../inbox/messages'
import { workerCaller } from '../index'
import { bootClinicDb } from '../test-db'
import { bindOrAssertTenant } from '../tenant'
import { PENDING_OFFER_TTL_MS } from './booking-frame-choice'
import {
  attachChoiceOfferToDeferred,
  buildLineChoiceInteractive,
  buildSlotChoiceInteractive,
  buildVariantChoiceInteractive,
  encodeChoiceId,
  isChoiceOfferId,
  parseChoiceId,
  slotBindingFromChoice,
  toSendInteractive,
  validateChoiceAgainstFrame,
  SLOT_LIST_BUTTON_LABEL,
  VARIANT_LIST_BUTTON_LABEL,
} from './choice-offer'
import { extractDates } from './nlu/temporal'
import { createDeferredBookingFrame, OUTBOUND_MESSAGE_ID_PLACEHOLDER } from './deferred-booking-frame'
import { getBookingFrame } from './schedule-session'

function boot() {
  const clock = createControllableClock(Date.UTC(2026, 10, 5, 15, 0))
  const { db, close } = bootClinicDb({ clock })
  const tenantId = 'clinic-demo-m5'
  const caller = workerCaller(tenantId)
  bindOrAssertTenant(db, caller, clock)
  const contact = upsertContact(
    db,
    { tenantId, waId: '5511999000415', displayName: 'Carla' },
    clock,
  )
  const conversation = createConversation(
    db,
    { tenantId, contactId: contact.id, status: 'open' },
    clock,
  )
  return { db, clock, tenantId, conversationId: conversation.id, close, caller }
}

describe('choice-offer ids', () => {
  it('codifica e decodifica slot + catalogVersion + key (com : na versão)', () => {
    const id = encodeChoiceId('linha', '1:2', 'feminino')
    expect(id.startsWith('ch1~')).toBe(true)
    expect(parseChoiceId(id)).toEqual({
      slot: 'linha',
      catalogVersion: '1:2',
      key: 'feminino',
    })
    expect(isChoiceOfferId(id)).toBe(true)
    expect(isChoiceOfferId('prop:x:v1:confirm')).toBe(false)
  })

  it('linha → 2 botões Feminina/Masculina', () => {
    const built = buildLineChoiceInteractive('3:4')
    expect(built.interactive.mode).toBe('buttons')
    expect(built.interactive.buttons).toHaveLength(2)
    expect(built.interactive.buttons.map((b) => b.title)).toEqual(['Feminina', 'Masculina'])
    expect(built.pending.slot).toBe('linha')
    expect(built.pending.options.map((o) => o.key)).toEqual(['feminino', 'masculino'])
    for (const b of built.interactive.buttons) {
      const p = parseChoiceId(b.id)
      expect(p?.catalogVersion).toBe('3:4')
      expect(p?.slot).toBe('linha')
    }
  })

  it('variantes → lista com zonas + Todas (≤10)', () => {
    const zones = Array.from({ length: 12 }, (_, i) => ({
      id: `z${i}`,
      name: `Zona ${i}`,
    }))
    const built = buildVariantChoiceInteractive({ catalogVersion: '1', zones })
    expect(built.interactive.mode).toBe('list')
    expect(built.interactive.button).toBe(VARIANT_LIST_BUTTON_LABEL)
    const rows = built.interactive.sections.flatMap((s) => s.rows)
    expect(rows.length).toBeLessThanOrEqual(10)
    expect(rows.at(-1)?.title).toBe('Todas')
    expect(built.pending.options.at(-1)?.key).toBe('todas')
  })

  it('horários → lista com CTA Horários', () => {
    const built = buildSlotChoiceInteractive({
      catalogVersion: '9',
      slots: [
        { key: '09:00', label: '06/11 09:00' },
        { key: '10:00', label: '06/11 10:00' },
      ],
    })
    expect(built.interactive.mode).toBe('list')
    expect(built.interactive.button).toBe(SLOT_LIST_BUTTON_LABEL)
    expect(toSendInteractive(built.interactive)?.list?.sections[0]?.rows).toHaveLength(2)
  })

  it('o id do horário liga a data; o título 11-03 17:00 não é data', () => {
    expect(slotBindingFromChoice('2026-11-03T17:00', '11-03 17:00')).toEqual({
      date: '2026-11-03',
      time: '17:00',
    })
    expect(slotBindingFromChoice('17:00', '2026-11-03 às 17:00')).toEqual({
      date: '2026-11-03',
      time: '17:00',
    })
    expect(slotBindingFromChoice('17:00', '11-03 17:00')).toBeNull()
    expect(extractDates('11-03 17:00', '2026-11-03').size).toBe(0)
    const id = encodeChoiceId('horario', '9', '2026-11-03T17:00')
    expect(parseChoiceId(id)?.key).toBe('2026-11-03T17:00')
  })

  it('#507: dois horários à mesma hora em dias diferentes — o id escolhe o dia', () => {
    const built = buildSlotChoiceInteractive({
      catalogVersion: '9',
      slots: [
        {
          key: '2026-11-03T17:00',
          label: 'terça 03/11 17:00',
          description: 'terça 03/11 17:00',
        },
        {
          key: '2026-11-04T17:00',
          label: 'quarta 04/11 17:00',
          description: 'quarta 04/11 17:00',
        },
      ],
    })
    const rows = built.interactive.sections.flatMap((s) => s.rows)
    expect(rows.map((r) => r.title)).toEqual(['terça 03/11 17:00', 'quarta 04/11 17:00'])
    expect(JSON.stringify(rows)).not.toMatch(/\b\d{2}-\d{2} \d{2}:\d{2}\b/)
    expect(parseChoiceId(rows[0]!.id)?.key).toBe('2026-11-03T17:00')
    expect(parseChoiceId(rows[1]!.id)?.key).toBe('2026-11-04T17:00')
    expect(slotBindingFromChoice('2026-11-03T17:00', rows[0]!.title)).toEqual({
      date: '2026-11-03',
      time: '17:00',
    })
    expect(slotBindingFromChoice('2026-11-04T17:00', rows[1]!.title)).toEqual({
      date: '2026-11-04',
      time: '17:00',
    })
    // Título sozinho (mês-dia ou DD/MM) não autoriza o slot.
    expect(slotBindingFromChoice('17:00', 'terça 03/11 17:00')).toBeNull()
    expect(built.pending.options.map((o) => o.key)).toEqual([
      '2026-11-03T17:00',
      '2026-11-04T17:00',
    ])
  })
})

describe('validateChoiceAgainstFrame', () => {
  it('aceita toque fresco e recusa expirado / catálogo / opção antiga', () => {
    const { db, clock, tenantId, conversationId, close } = boot()
    try {
      const built = buildLineChoiceInteractive('v1')
      const deferred = createDeferredBookingFrame()
      attachChoiceOfferToDeferred(deferred, 'svc_dep', 'v1', built)
      const msg = insertMessage(
        db,
        {
          tenantId,
          conversationId,
          direction: 'outbound',
          body: 'linha?',
          externalMessageId: null,
          deliveryState: 'accepted',
          authorClerkUserId: 'system:ai-autodraft',
          authorDisplayName: 'IA',
          createdAt: clock.nowMs(),
        },
        clock,
      )
      deferred.toAfterPersist(clock)({
        db,
        tenantId,
        conversationId,
        messageId: msg.id,
        outboundId: 'ob1',
        now: clock.nowMs(),
      })
      const frame = getBookingFrame(db, tenantId, conversationId)
      expect(frame?.pending?.messageId).toBe(msg.id)
      expect(frame?.pending?.messageId).not.toBe(OUTBOUND_MESSAGE_ID_PLACEHOLDER)

      const okId = built.interactive.buttons[0]!.id
      expect(
        validateChoiceAgainstFrame(db, tenantId, conversationId, okId, clock.nowMs()).ok,
      ).toBe(true)

      const staleCatalog = encodeChoiceId('linha', 'other', 'feminino')
      const badCat = validateChoiceAgainstFrame(
        db,
        tenantId,
        conversationId,
        staleCatalog,
        clock.nowMs(),
      )
      expect(badCat.ok).toBe(false)
      if (!badCat.ok) expect(badCat.reason).toBe('catalog_mismatch')

      const unknown = encodeChoiceId('linha', 'v1', 'inexistente')
      const badOpt = validateChoiceAgainstFrame(
        db,
        tenantId,
        conversationId,
        unknown,
        clock.nowMs(),
      )
      expect(badOpt.ok).toBe(false)
      if (!badOpt.ok) expect(badOpt.reason).toBe('unknown_option')

      const expired = validateChoiceAgainstFrame(
        db,
        tenantId,
        conversationId,
        okId,
        clock.nowMs() + PENDING_OFFER_TTL_MS + 60_000,
      )
      expect(expired.ok).toBe(false)
      if (!expired.ok) expect(expired.reason).toBe('expired')
    } finally {
      close()
    }
  })
})
