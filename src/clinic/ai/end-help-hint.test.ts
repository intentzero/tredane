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
import { tryAiAutoBook } from './autobook'
import {
  END_HELP_HINT_TEXT,
  RESET_DISCOVERY_HINT_TEXT,
  appendEndHelpHint,
  bookingFrameProgressKey,
  botTaughtExitCommands,
  botTaughtRestartPhraseInCopy,
  isHowToEndQuestion,
  isOpenBookingAttempt,
  shouldAppendEndHelpHint,
  taughtExitCommandsFromCopy,
  wasEndHelpHintSent,
} from './end-help-hint'
import { isExplicitAbandonText } from './nlu/sensitive'
import { getBookingFrame, saveBookingFrame } from './schedule-session'

const NOW = Date.UTC(2026, 9, 28, 18, 51)

describe('end-help-hint helpers (DEC-152)', () => {
  it('paridade hint↔Class A: toda frase ensinada por «diga X» é abandono A (DEC-C2)', () => {
    const taught = botTaughtExitCommands()
    expect(taught).toEqual(['terminar'])
    for (const cmd of taught) {
      expect(isExplicitAbandonText(cmd), `Class A deve reconhecer «${cmd}»`).toBe(true)
      expect(isExplicitAbandonText(cmd[0]!.toUpperCase() + cmd.slice(1))).toBe(true)
    }
    // Catálogo DEC-142 ensina «diga “serviços masculinos”» — não é saída; não entra.
    expect(
      taughtExitCommandsFromCopy([
        'Continuo no feminino. Para ver o masculino, diga “serviços masculinos”.',
      ]),
    ).toEqual([])
  })

  it('discovery hint ensina «começar de novo» (CF-28) e «terminar» (Class A)', () => {
    expect(botTaughtRestartPhraseInCopy()).toBe(true)
    expect(RESET_DISCOVERY_HINT_TEXT).toMatch(/começar de novo/)
    expect(RESET_DISCOVERY_HINT_TEXT).toMatch(/terminar/)
    expect(isExplicitAbandonText('terminar')).toBe(true)
  })

  it('isHowToEndQuestion: meta sim; Terminar exacto não', () => {
    expect(isHowToEndQuestion('Como faço para terminar esta conversa?')).toBe(true)
    expect(isHowToEndQuestion('como posso encerrar?')).toBe(true)
    expect(isHowToEndQuestion('como termino')).toBe(true)
    expect(isHowToEndQuestion('Como faço para terminar?')).toBe(true)
    expect(isHowToEndQuestion('Terminar')).toBe(false)
    expect(isHowToEndQuestion('quero terminar a sessão')).toBe(false)
    expect(isHowToEndQuestion('quero depilação')).toBe(false)
  })

  it('appendEndHelpHint é idempotente', () => {
    const once = appendEndHelpHint('Qual tipo você quer?')
    expect(once).toContain(END_HELP_HINT_TEXT)
    expect(appendEndHelpHint(once)).toBe(once)
  })

  it('progress key ignora messageId das opções', () => {
    const a = bookingFrameProgressKey({
      serviceId: 's1',
      line: 'feminino',
      variantIds: ['b', 'a'],
      date: null,
      period: null,
      time: null,
      pending: {
        slot: 'horario',
        options: [{ key: '1', label: '14:00' }],
        messageId: 'm1',
      },
      proposal: null,
      lastOffer: { slots: [{ startsAt: 1, professionalId: 'p' }], messageId: 'm1' },
    })
    const b = bookingFrameProgressKey({
      serviceId: 's1',
      line: 'feminino',
      variantIds: ['a', 'b'],
      date: null,
      period: null,
      time: null,
      pending: {
        slot: 'horario',
        options: [{ key: '2', label: '15:00' }],
        messageId: 'm2',
      },
      proposal: null,
      lastOffer: { slots: [{ startsAt: 2, professionalId: 'p' }], messageId: 'm2' },
    })
    expect(a).toBe(b)
  })

  it('shouldAppend exige frame aberto sem avanço e sem envio prévio', () => {
    const frame = {
      phase: 'ofertado' as const,
      serviceId: 's1',
      line: 'feminino' as const,
      variantIds: ['z1'],
      professionalPref: null,
      date: null,
      period: null,
      time: null,
      pending: {
        slot: 'horario',
        options: [{ key: '1', label: '14:00' }],
        messageId: 'm',
      },
      lastOffer: {
        slots: [{ startsAt: 1, professionalId: 'p' }],
        messageId: 'm',
      },
      proposal: null,
      rescheduleAppointmentId: null,
      catalogVersion: '',
      provenance: {},
      updatedAt: 1,
    }
    expect(isOpenBookingAttempt(frame)).toBe(true)
    expect(
      shouldAppendEndHelpHint({
        replyText: 'Qual fica melhor?',
        frameAtStart: frame,
        frameNow: frame,
        alreadySent: false,
      }),
    ).toBe(true)
    expect(
      shouldAppendEndHelpHint({
        replyText: 'Qual fica melhor?',
        frameAtStart: frame,
        frameNow: { ...frame, time: '14:00' },
        alreadySent: false,
      }),
    ).toBe(false)
    expect(
      shouldAppendEndHelpHint({
        replyText: 'Sem problema. Quando quiser, é só chamar.',
        notes: 'DEC-147 A',
        frameAtStart: frame,
        frameNow: frame,
        alreadySent: false,
      }),
    ).toBe(false)
  })
})

describe('tryAiAutoBook — hint one-shot após oferta sem progresso (DEC-152)', () => {
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
        bindingId: 'bind_hint',
        phoneNumberId: 'pn_hint',
        wabaId: 'waba_hint',
        displayPhone: '+5511900000088',
        displayName: 'Clínica Hint',
        action: 'channel_connected',
      },
      clock,
    )
    const room = upsertResourceOp(db, caller, { kind: 'room', name: 'Sala', category: 'Sala' }, clock)
    const pro = upsertResourceOp(
      db,
      caller,
      { kind: 'professional', name: 'Ana', homeRoomId: room.id },
      clock,
    )
    const svc = upsertServiceOp(
      db,
      caller,
      {
        name: 'Depilacao',
        durationMinutes: 45,
        bufferMinutes: 0,
        priceCents: 12000,
        professionalIds: [pro.id],
        roomRequirement: { mode: 'none' },
      },
      clock,
    )
    const week = [1, 2, 3, 4, 5].map((d) => ({ dayOfWeek: d, startMinute: 540, endMinute: 1020 }))
    setWeeklyWindowsOp(db, caller, { resourceId: pro.id, windows: week }, clock)
    setWeeklyWindowsOp(db, caller, { resourceId: room.id, windows: week }, clock)
    setClinicAiAssistEnabled(db, tenantId, true, clock)
    const contact = upsertContact(
      db,
      { tenantId, waId: '5511999990088', displayName: 'Hint Client' },
      clock,
    )
    const cnv = createConversation(db, { tenantId, contactId: contact.id, status: 'open' }, clock)
    return { db, clock, tenantId, caller, svc, pro, cnv, close: () => boot.close() }
  }

  it('após slots, mensagem sem progresso leva o hint uma vez', async () => {
    const s = seed()
    try {
      // Frame já ofertado: pending/horario sem variantes inventadas (evita
      // revalidação do catálogo a mudar o fingerprint do progresso).
      saveBookingFrame(
        s.db,
        s.tenantId,
        s.cnv.id,
        {
          serviceId: s.svc.id,
          line: 'feminino',
          phase: 'ofertado',
          pending: {
            slot: 'horario',
            options: [
              { key: '2026-11-06T14:00', label: '14:00' },
              { key: '2026-11-06T15:00', label: '15:00' },
            ],
            messageId: 'm_slots',
          },
          lastOffer: {
            slots: [{ startsAt: Date.UTC(2026, 10, 6, 17, 0), professionalId: s.pro.id }],
            messageId: 'm_slots',
          },
        },
        s.clock,
      )

      s.clock.advance(60_000)
      insertMessage(
        s.db,
        {
          tenantId: s.tenantId,
          conversationId: s.cnv.id,
          direction: 'inbound',
          body: 'ainda não sei',
          deliveryState: 'received',
          createdAt: s.clock.nowMs(),
        },
        s.clock,
      )

      const out = await tryAiAutoBook(s.db, s.caller, s.clock, {
        conversationId: s.cnv.id,
        capability: true,
      })
      expect(out.replyText).toBeTruthy()
      expect(out.replyText).toContain(END_HELP_HINT_TEXT)
      expect(wasEndHelpHintSent(s.db, s.tenantId, s.cnv.id)).toBe(true)

      s.clock.advance(60_000)
      insertMessage(
        s.db,
        {
          tenantId: s.tenantId,
          conversationId: s.cnv.id,
          direction: 'inbound',
          body: 'hmm ok',
          deliveryState: 'received',
          createdAt: s.clock.nowMs(),
        },
        s.clock,
      )
      const out2 = await tryAiAutoBook(s.db, s.caller, s.clock, {
        conversationId: s.cnv.id,
        capability: true,
      })
      const hits = (out2.replyText?.match(new RegExp(END_HELP_HINT_TEXT, 'g')) ?? []).length
      expect(hits).toBeLessThanOrEqual(1)
      if (out2.replyText?.includes(END_HELP_HINT_TEXT)) {
        expect(hits).toBe(1)
      }
    } finally {
      s.close()
    }
  })

  it('soft-decline não acrescenta o hint', async () => {
    const s = seed()
    try {
      saveBookingFrame(
        s.db,
        s.tenantId,
        s.cnv.id,
        {
          serviceId: s.svc.id,
          line: 'feminino',
          variantIds: ['z_fake'],
          phase: 'ofertado',
          pending: {
            slot: 'horario',
            options: [{ key: '2026-11-06T14:00', label: '14:00' }],
            messageId: 'm_slots',
          },
          lastOffer: {
            slots: [{ startsAt: Date.UTC(2026, 10, 6, 17, 0), professionalId: s.pro.id }],
            messageId: 'm_slots',
          },
        },
        s.clock,
      )
      s.clock.advance(60_000)
      insertMessage(
        s.db,
        {
          tenantId: s.tenantId,
          conversationId: s.cnv.id,
          direction: 'inbound',
          body: 'Deixa estar, obrigado',
          deliveryState: 'received',
          createdAt: s.clock.nowMs(),
        },
        s.clock,
      )
      const out = await tryAiAutoBook(s.db, s.caller, s.clock, {
        conversationId: s.cnv.id,
        capability: true,
      })
      expect(out.replyText).not.toContain(END_HELP_HINT_TEXT)
      expect(getBookingFrame(s.db, s.tenantId, s.cnv.id)).not.toBeNull()
      out.deferredFrame?.flushNow(s.db, s.tenantId, s.cnv.id, s.clock)
      expect(getBookingFrame(s.db, s.tenantId, s.cnv.id)).toBeNull()
    } finally {
      s.close()
    }
  })
})
