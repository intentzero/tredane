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
import { PROPOSAL_BUTTON_TITLES } from '../proposals/render'
import { tryAiAutoBook } from './autobook'
import { SLOT_LIST_BUTTON_LABEL } from './choice-offer'
import { HUMAN_HANDOFF_BUTTON_TITLE } from './human-handoff'
import {
  HUMAN_HELP_HINT_TEXT,
  HUMAN_HELP_TAUGHT_PHRASE,
  appendHumanHelpHint,
  botTaughtHumanHelpPhraseMatchesHandoff,
  isSlotListOfferInteractive,
  shouldAppendHumanHelpHint,
  wasHumanHelpHintSent,
} from './human-help-hint'
import { WANTS_HUMAN_RE } from './nlu/sensitive'
import { getBookingFrame, saveBookingFrame } from './schedule-session'

const NOW = Date.UTC(2026, 9, 28, 18, 51)

describe('human-help-hint helpers (DEC-153)', () => {
  it('paridade copy↔WANTS_HUMAN_RE: frase ensinada continua a pedir pessoa', () => {
    expect(botTaughtHumanHelpPhraseMatchesHandoff()).toBe(true)
    expect(WANTS_HUMAN_RE.test(HUMAN_HELP_TAUGHT_PHRASE)).toBe(true)
    expect(WANTS_HUMAN_RE.test('quero falar com a equipe')).toBe(true)
  })

  it('appendHumanHelpHint é idempotente e não altera o corpo já com a dica', () => {
    const once = appendHumanHelpHint('Para Depilação, tenho 14:00. Qual fica melhor?')
    expect(once).toContain(HUMAN_HELP_HINT_TEXT)
    expect(appendHumanHelpHint(once)).toBe(once)
  })

  it('só a lista Horários conta como oferta de slots (T1 período excluído)', () => {
    expect(
      isSlotListOfferInteractive({
        mode: 'list',
        button: SLOT_LIST_BUTTON_LABEL,
        sections: [{ rows: [{ id: 'a', title: '14:00' }] }],
      }),
    ).toBe(true)
    expect(
      isSlotListOfferInteractive({
        mode: 'buttons',
        buttons: [
          { id: '1', title: 'Manhã' },
          { id: '2', title: 'Tarde' },
          { id: '3', title: 'Outro dia' },
        ],
      }),
    ).toBe(false)
  })

  it('shouldAppend exige lista Horários, corpo e flag 0; proposta e já enviado saltam', () => {
    const interactive = {
      mode: 'list' as const,
      button: SLOT_LIST_BUTTON_LABEL,
      sections: [{ rows: [{ id: 'a', title: '14:00' }] }],
    }
    expect(
      shouldAppendHumanHelpHint({
        replyText: 'Qual fica melhor?',
        interactive,
        alreadySent: false,
      }),
    ).toBe(true)
    expect(
      shouldAppendHumanHelpHint({
        replyText: 'Qual fica melhor?',
        interactive,
        alreadySent: true,
      }),
    ).toBe(false)
    expect(
      shouldAppendHumanHelpHint({
        replyText: 'Qual fica melhor?',
        interactive,
        proposalId: 'prop_1',
        alreadySent: false,
      }),
    ).toBe(false)
    expect(
      shouldAppendHumanHelpHint({
        replyText: 'Qual fica melhor?',
        interactive: {
          mode: 'buttons',
          buttons: [{ id: 'handoff:human', title: HUMAN_HANDOFF_BUTTON_TITLE }],
        },
        alreadySent: false,
      }),
    ).toBe(false)
  })

  it('proposta mantém o botão Falar com a equipe (DEC-083)', () => {
    expect(PROPOSAL_BUTTON_TITLES.human).toBe(HUMAN_HANDOFF_BUTTON_TITLE)
    expect(PROPOSAL_BUTTON_TITLES.confirm).toBe('Confirmar')
    expect(PROPOSAL_BUTTON_TITLES.alter).toBe('Alterar detalhes')
  })
})

describe('tryAiAutoBook — dica one-shot na 1.ª oferta de Horários (DEC-153)', () => {
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
        bindingId: 'bind_hh',
        phoneNumberId: 'pn_hh',
        wabaId: 'waba_hh',
        displayPhone: '+5511900000099',
        displayName: 'Clínica Help',
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
      { tenantId, waId: '5511999990099', displayName: 'Help Client' },
      clock,
    )
    const cnv = createConversation(db, { tenantId, contactId: contact.id, status: 'open' }, clock)
    return { db, clock, tenantId, caller, svc, pro, cnv, close: () => boot.close() }
  }

  it('1.ª oferta inclui a dica; 2.ª oferta na mesma sessão não repete; mostrar a dica não pausa', async () => {
    const s = seed()
    try {
      saveBookingFrame(
        s.db,
        s.tenantId,
        s.cnv.id,
        {
          serviceId: s.svc.id,
          line: 'feminino',
          phase: 'coletando',
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
          body: 'amanhã à tarde',
          deliveryState: 'received',
          createdAt: s.clock.nowMs(),
        },
        s.clock,
      )

      const first = await tryAiAutoBook(s.db, s.caller, s.clock, {
        conversationId: s.cnv.id,
        capability: true,
      })
      expect(first.replyText).toBeTruthy()
      expect(first.interactive?.mode).toBe('list')
      if (first.interactive?.mode === 'list') {
        expect(first.interactive.button).toBe(SLOT_LIST_BUTTON_LABEL)
      }
      expect(first.replyText).toContain(HUMAN_HELP_HINT_TEXT)
      expect(wasHumanHelpHintSent(s.db, s.tenantId, s.cnv.id)).toBe(true)
      // Mostrar a dica ≠ handoff (DEC-083).
      const paused = s.db.get<{ at: number | null }>(
        `SELECT ai_reply_paused_at AS at FROM conversations WHERE tenant_id = ? AND id = ?`,
        s.tenantId,
        s.cnv.id,
      )
      expect(paused?.at ?? null).toBeNull()

      // Segunda oferta: re-pedir outro dia com flag já marcada.
      s.clock.advance(60_000)
      insertMessage(
        s.db,
        {
          tenantId: s.tenantId,
          conversationId: s.cnv.id,
          direction: 'inbound',
          body: 'e na sexta?',
          deliveryState: 'received',
          createdAt: s.clock.nowMs(),
        },
        s.clock,
      )
      const second = await tryAiAutoBook(s.db, s.caller, s.clock, {
        conversationId: s.cnv.id,
        capability: true,
      })
      expect(second.replyText).toBeTruthy()
      const hits = (second.replyText?.match(new RegExp(HUMAN_HELP_HINT_TEXT.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) ?? [])
        .length
      expect(hits).toBe(0)
      // Flag permanece; frame ainda vivo.
      expect(wasHumanHelpHintSent(s.db, s.tenantId, s.cnv.id)).toBe(true)
      expect(getBookingFrame(s.db, s.tenantId, s.cnv.id)?.serviceId).toBe(s.svc.id)
    } finally {
      s.close()
    }
  })

  it('texto «falar com a equipe» mid-booking casa com handoff (regressão DEC-083)', () => {
    // Autodraft (DEC-083) usa WANTS_HUMAN_RE; a dica ensina a mesma frase.
    expect(WANTS_HUMAN_RE.test('falar com a equipe')).toBe(true)
    expect(WANTS_HUMAN_RE.test('quero falar com a equipe')).toBe(true)
    expect(HUMAN_HELP_HINT_TEXT.toLowerCase()).toContain(HUMAN_HELP_TAUGHT_PHRASE)
  })
})
