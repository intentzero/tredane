import { describe, expect, it } from 'vitest'
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
} from './end-help-hint'
import { isExplicitAbandonText } from './nlu/sensitive'

describe('end-help-hint helpers (DEC-152)', () => {
  it('paridade hint↔Class A: toda frase ensinada por «diga X» é abandono A (DEC-C2)', () => {
    expect(botTaughtExitCommands()).toEqual([])
    // Catálogo DEC-142 ensina «diga “serviços masculinos”» — não é saída; não entra.
    expect(
      taughtExitCommandsFromCopy([
        'Continuo no feminino. Para ver o masculino, diga “serviços masculinos”.',
      ]),
    ).toEqual([])
  })

  it('discovery hint ensina «começar de novo» (CF-28), sem «diga terminar»', () => {
    expect(botTaughtRestartPhraseInCopy()).toBe(true)
    expect(RESET_DISCOVERY_HINT_TEXT).toMatch(/começar de novo/)
    expect(RESET_DISCOVERY_HINT_TEXT).not.toMatch(/terminar/)
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

  it('appendEndHelpHint é idempotente (copy sem «diga terminar»)', () => {
    const once = appendEndHelpHint('Qual tipo você quer?')
    expect(once).toMatch(/botão Terminar/)
    expect(once).not.toContain(END_HELP_HINT_TEXT)
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
    ).toBe(false)
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
