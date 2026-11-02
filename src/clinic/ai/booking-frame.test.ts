/**
 * BookingFrame — DEC-127, propriedades, WS e limpeza (#412 M2).
 */
import { describe, expect, it } from 'vitest'
import { createControllableClock } from '../../db/clock'
import { upsertContact } from '../contacts'
import { createConversation } from '../inbox/conversations'
import { workerCaller } from '../index'
import { bootClinicDb } from '../test-db'
import { bindOrAssertTenant } from '../tenant'
import {
  clearBookingFrame,
  getBookingFrame,
  saveBookingFrame,
  wouldAskFilledSlot,
  type BookingFrame,
} from './schedule-session'
import {
  isPendingOfferFresh,
  matchPendingChoice,
  PENDING_OFFER_TTL_MS,
} from './booking-frame-choice'

function boot() {
  const clock = createControllableClock(Date.UTC(2026, 10, 5, 15, 0))
  const { db, close } = bootClinicDb({ clock })
  const tenantId = 'clinic-demo-bf'
  const caller = workerCaller(tenantId)
  bindOrAssertTenant(db, caller, clock)
  const contact = upsertContact(
    db,
    { tenantId, waId: '5511999000001', displayName: 'Ana' },
    clock,
  )
  const conversation = createConversation(
    db,
    { tenantId, contactId: contact.id, status: 'open' },
    clock,
  )
  return { db, clock, tenantId, conversationId: conversation.id, close, caller }
}

describe('BookingFrame API', () => {
  it('grava e lê o contrato §3.3; emite booking_frame.updated', () => {
    const { db, clock, tenantId, conversationId, close } = boot()
    try {
      const { frame, outbox } = saveBookingFrame(
        db,
        tenantId,
        conversationId,
        {
          serviceId: 'svc1',
          line: 'feminino',
          date: '2026-11-06',
          period: 'tarde',
          time: '14:00',
          variantIds: ['z1'],
          catalogVersion: '1:2',
          pending: {
            slot: 'horario',
            options: [
              { key: '14:00', label: 'sexta 06/11 às 14:00' },
              { key: '15:00', label: 'sexta 06/11 às 15:00' },
            ],
            messageId: 'msg1',
          },
          lastOffer: {
            slots: [{ startsAt: Date.UTC(2026, 10, 6, 17, 0), professionalId: 'p1' }],
            messageId: 'msg1',
          },
          sourceMessageId: 'msg-in',
          source: 'regra',
        },
        clock,
      )
      expect(frame.serviceId).toBe('svc1')
      expect(frame.date).toBe('2026-11-06')
      expect(frame.pending?.options).toHaveLength(2)
      expect(outbox?.type).toBe('booking_frame.updated')
      expect(getBookingFrame(db, tenantId, conversationId)?.time).toBe('14:00')
    } finally {
      close()
    }
  })

  it('troca de serviço limpa linha, variantes, hora, pending e lastOffer', () => {
    const { db, clock, tenantId, conversationId, close } = boot()
    try {
      saveBookingFrame(
        db,
        tenantId,
        conversationId,
        {
          serviceId: 'svc1',
          line: 'feminino',
          time: '14:00',
          variantIds: ['z1'],
          pending: {
            slot: 'horario',
            options: [{ key: '14:00', label: '14:00' }],
            messageId: 'm1',
          },
          lastOffer: { slots: [{ startsAt: 1, professionalId: 'p' }], messageId: 'm1' },
        },
        clock,
      )
      const { frame } = saveBookingFrame(
        db,
        tenantId,
        conversationId,
        { serviceId: 'svc2' },
        clock,
      )
      expect(frame.serviceId).toBe('svc2')
      expect(frame.line).toBeNull()
      expect(frame.variantIds).toBeNull()
      expect(frame.time).toBeNull()
      expect(frame.pending).toBeNull()
      expect(frame.lastOffer).toBeNull()
    } finally {
      close()
    }
  })

  it('clear volta a idle / sem linha', () => {
    const { db, clock, tenantId, conversationId, close } = boot()
    try {
      saveBookingFrame(
        db,
        tenantId,
        conversationId,
        { serviceId: 'svc1', date: '2026-11-06' },
        clock,
      )
      clearBookingFrame(db, tenantId, conversationId, clock)
      expect(getBookingFrame(db, tenantId, conversationId)).toBeNull()
    } finally {
      close()
    }
  })

  it('isolamento: clínica A ≠ B (dois DOs)', () => {
    const a = boot()
    const clockB = createControllableClock(Date.UTC(2026, 10, 5, 15, 0))
    const bootB = bootClinicDb({ clock: clockB })
    try {
      const tenantB = 'clinic-demo-bf-b'
      bindOrAssertTenant(bootB.db, workerCaller(tenantB), clockB)
      const contactB = upsertContact(
        bootB.db,
        { tenantId: tenantB, waId: '5511999000002', displayName: 'Bia' },
        clockB,
      )
      const convB = createConversation(
        bootB.db,
        { tenantId: tenantB, contactId: contactB.id, status: 'open' },
        clockB,
      )
      saveBookingFrame(a.db, a.tenantId, a.conversationId, { serviceId: 'svcA' }, a.clock)
      saveBookingFrame(bootB.db, tenantB, convB.id, { serviceId: 'svcB' }, clockB)
      expect(getBookingFrame(a.db, a.tenantId, a.conversationId)?.serviceId).toBe('svcA')
      expect(getBookingFrame(bootB.db, tenantB, convB.id)?.serviceId).toBe('svcB')
      expect(getBookingFrame(a.db, tenantB, convB.id)).toBeNull()
    } finally {
      a.close()
      bootB.close()
    }
  })
})

describe('DEC-127 validade 24 h', () => {
  it('23h59 vale; 24h01 não', () => {
    const created = Date.UTC(2026, 10, 5, 12, 0)
    expect(isPendingOfferFresh(created, created + PENDING_OFFER_TTL_MS - 60_000)).toBe(true)
    expect(isPendingOfferFresh(created, created + PENDING_OFFER_TTL_MS)).toBe(true)
    expect(isPendingOfferFresh(created, created + PENDING_OFFER_TTL_MS + 60_000)).toBe(false)
  })
})

describe('DEC-127 matchPendingChoice', () => {
  const pending = {
    slot: 'horario',
    messageId: 'm1',
    options: [
      { key: '13:00', label: 'amanhã às 13:00' },
      { key: '14:00', label: 'amanhã às 14:00' },
      { key: '15:30', label: 'amanhã às 15:30' },
    ],
  }

  it('«o das 14» casa a opção 14:00 (A-07)', () => {
    expect(matchPendingChoice('o das 14', pending)).toEqual({
      kind: 'match',
      key: '14:00',
      label: 'amanhã às 14:00',
    })
  })

  it('«a segunda opção» casa ordinal 2 (A-08)', () => {
    expect(matchPendingChoice('a segunda opção', pending)).toEqual({
      kind: 'match',
      key: '14:00',
      label: 'amanhã às 14:00',
    })
  })

  it('👍 com uma opção escolhe; com várias pergunta qual (C-05 / DEC-127.3)', () => {
    expect(
      matchPendingChoice('👍', {
        slot: 'horario',
        messageId: 'm',
        options: [{ key: '14:00', label: '14:00' }],
      }),
    ).toEqual({ kind: 'match', key: '14:00', label: '14:00' })
    expect(matchPendingChoice('👍', pending)).toEqual({ kind: 'ask_which' })
    expect(matchPendingChoice('sim', pending)).toEqual({ kind: 'ask_which' })
    expect(
      matchPendingChoice('fechado', {
        slot: 'horario',
        messageId: 'm',
        options: [{ key: '14:00', label: '14:00' }],
      }),
    ).toEqual({ kind: 'match', key: '14:00', label: '14:00' })
  })

  it('ordinal e dia da semana divergentes → ambiguous (DEC-127.2)', () => {
    const opts = {
      slot: 'horario',
      messageId: 'm',
      options: [
        { key: 'a', label: 'sexta às 13:00' },
        { key: 'b', label: 'sábado às 14:00' },
      ],
    }
    expect(matchPendingChoice('a segunda opção', opts).kind).toBe('match')
    expect(matchPendingChoice('a primeira, sexta', opts)).toMatchObject({ kind: 'match', key: 'a' })
    expect(matchPendingChoice('a segunda opção, sexta', opts).kind).toBe('ambiguous')
  })
})

describe('propriedades BookingFrame', () => {
  it('não pergunta slot já preenchido', () => {
    const frame: BookingFrame = {
      phase: 'coletando',
      serviceId: 's',
      line: 'feminino',
      variantIds: ['z'],
      professionalPref: null,
      date: '2026-11-06',
      period: 'tarde',
      time: null,
      pending: null,
      lastOffer: null,
      proposal: null,
      rescheduleAppointmentId: null,
      catalogVersion: '',
      provenance: {},
      updatedAt: 1,
    }
    expect(wouldAskFilledSlot(frame, 'serviceId')).toBe(true)
    expect(wouldAskFilledSlot(frame, 'date')).toBe(true)
    expect(wouldAskFilledSlot(frame, 'time')).toBe(false)
  })

  it('replay idêntico → mesma saída do matchPendingChoice', () => {
    const pending = {
      slot: 'horario',
      messageId: 'm',
      options: [
        { key: '13:00', label: '13:00' },
        { key: '14:00', label: '14:00' },
      ],
    }
    expect(matchPendingChoice('o das 14', pending)).toEqual(
      matchPendingChoice('o das 14', pending),
    )
  })
})
