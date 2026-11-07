/**
 * CF-28 / #508 — «começar de novo» / «outra coisa» limpa BookingFrame;
 * encerrar conversa (painel / idle DEC-087) também limpa.
 */
import { describe, expect, it } from 'vitest'
import { createControllableClock } from '../../db/clock'
import { upsertResourceOp, upsertServiceOp, setWeeklyWindowsOp } from '../config'
import { setClinicAiAssistEnabled } from '../config/settings'
import { upsertContact } from '../contacts'
import { workerCaller } from '../index'
import { closeConversationOp } from '../inbox/operations'
import { createConversation } from '../inbox/conversations'
import { insertMessage } from '../inbox/messages'
import {
  createProposal,
  getActiveProposalForConversation,
  getProposal,
  markProposalSent,
} from '../proposals/proposals'
import { zonedCivilToUtc } from '../scheduling'
import { bootClinicDb } from '../test-db'
import { syncWhatsappChannel } from '../whatsapp/channel'
import {
  IDLE_CLOSE_AFTER_MS,
  IDLE_PROMPT_AFTER_MS,
  handleIdleButtonClick,
  idleButtonId,
  rescheduleConversationIdle,
  sweepDueIdleConversations,
} from '../followup/idle'
import { ensureOpenOpportunity } from '../pipeline'
import { tryAiAutoBook } from './autobook'
import {
  classifySensitive,
  hasRestartRequest,
  hasSlotRejectRequest,
  hasSoftDeclineRequest,
  wantsHumanPause,
} from './nlu/sensitive'
import {
  clearBookingFrame,
  getBookingFrame,
  saveBookingFrame,
  saveScheduleSession,
} from './schedule-session'

const TZ = 'America/Sao_Paulo'
const NOW = Date.UTC(2026, 9, 28, 18, 51)

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
      bindingId: 'bind_restart',
      phoneNumberId: 'pn_restart',
      wabaId: 'waba_restart',
      displayPhone: '+5511900000099',
      displayName: 'Clínica Restart',
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
  upsertServiceOp(
    db,
    caller,
    {
      name: 'Massagem',
      durationMinutes: 60,
      bufferMinutes: 0,
      priceCents: 15000,
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
    { tenantId, waId: '5511900000099', displayName: 'Carla Ficticia' },
    clock,
  )
  const cnv = createConversation(db, { tenantId, contactId: contact.id, status: 'open' }, clock)
  return { ...boot, clock, caller, tenantId, svc, pro, contact, cnv }
}

describe('classifySensitive — recomeçar (CF-28 / #508)', () => {
  const positives = [
    'começar de novo',
    'Começar de novo',
    'recomeçar',
    'recomecar',
    'outra coisa',
    'quero outra coisa',
    'esquece',
    'Esquece.',
  ]
  const negatives = [
    'outra sessão',
    'outra hora',
    'outra zona',
    'esquece a clínica',
    'quero massagem',
    'pode ser',
  ]

  it.each(positives)('TP: %s', (text) => {
    const hits = classifySensitive(text)
    expect(hasRestartRequest(hits)).toBe(true)
    expect(wantsHumanPause(hits)).toBe(false)
  })

  it.each(negatives)('FP: %s', (text) => {
    expect(hasRestartRequest(classifySensitive(text))).toBe(false)
  })
})

describe('tryAiAutoBook — recomeçar limpa frame e proposta (#508)', () => {
  it('proposta activa + «começar de novo» → proposta retirada, frame vazio, pergunta serviço', async () => {
    const s = seed()
    try {
      saveBookingFrame(
        s.db,
        s.tenantId,
        s.cnv.id,
        {
          serviceId: s.svc.id,
          line: 'feminino',
          date: '2026-11-06',
          time: '14:00',
          variantIds: ['z_fake'],
          phase: 'proposto',
          pending: {
            slot: 'horario',
            options: [{ key: '14:00', label: '14:00' }],
            messageId: 'm_old',
          },
          lastOffer: {
            slots: [{ startsAt: Date.UTC(2026, 10, 6, 17, 0), professionalId: s.pro.id }],
            messageId: 'm_old',
          },
        },
        s.clock,
      )
      const startsAt = zonedCivilToUtc(TZ, 2026, 10, 29, 14, 0)
      const proposal = createProposal(
        s.db,
        s.tenantId,
        {
          contactId: s.contact.id,
          conversationId: s.cnv.id,
          serviceId: s.svc.id,
          professionalId: s.pro.id,
          startsAt,
        },
        s.clock,
      )
      markProposalSent(s.db, s.tenantId, proposal.id, s.clock)
      expect(getActiveProposalForConversation(s.db, s.tenantId, s.cnv.id, s.clock)?.id).toBe(
        proposal.id,
      )

      s.clock.advance(60_000)
      insertMessage(
        s.db,
        {
          tenantId: s.tenantId,
          conversationId: s.cnv.id,
          direction: 'inbound',
          body: 'começar de novo',
          deliveryState: 'received',
          createdAt: s.clock.nowMs(),
        },
        s.clock,
      )

      const out = await tryAiAutoBook(s.db, s.caller, s.clock, {
        conversationId: s.cnv.id,
        capability: true,
      })
      expect(out.replyText).toMatch(/servi[cç]o/i)
      expect(out.replyText).not.toMatch(/\b\d{2}:\d{2}\b/)
      expect(out.deferredFrame?.hasWork).toBe(true)

      // Commit do clear (mesmo caminho que afterPersist no envio).
      const flushed = out.deferredFrame!.flushNow(s.db, s.tenantId, s.cnv.id, s.clock)
      expect(flushed.some((o) => o.type === 'booking_frame.updated')).toBe(true)
      expect(getBookingFrame(s.db, s.tenantId, s.cnv.id)).toBeNull()
      expect(getActiveProposalForConversation(s.db, s.tenantId, s.cnv.id, s.clock)).toBeNull()
      expect(getProposal(s.db, s.tenantId, proposal.id)?.state).toBe('substituida')
    } finally {
      s.close()
    }
  })

  it('«outra sessão» não limpa o frame', async () => {
    const s = seed()
    try {
      saveScheduleSession(
        s.db,
        s.tenantId,
        s.cnv.id,
        { serviceId: s.svc.id, audienceLine: 'feminino', date: '2026-11-06' },
        s.clock,
      )
      s.clock.advance(60_000)
      insertMessage(
        s.db,
        {
          tenantId: s.tenantId,
          conversationId: s.cnv.id,
          direction: 'inbound',
          body: 'outra sessão',
          deliveryState: 'received',
          createdAt: s.clock.nowMs(),
        },
        s.clock,
      )
      await tryAiAutoBook(s.db, s.caller, s.clock, {
        conversationId: s.cnv.id,
        capability: true,
      })
      expect(getBookingFrame(s.db, s.tenantId, s.cnv.id)?.serviceId).toBe(s.svc.id)
    } finally {
      s.close()
    }
  })
})

describe('classifySensitive — desistência educada (DEC-147)', () => {
  const positives = [
    'Deixa estar, obrigado',
    'deixa',
    'Podes encerrar a sessao',
    'encerrar a sessão',
    'obrigado',
    'tchau',
    'não quero',
    'desisto',
    'por agora não',
    'vou pensar',
  ]
  const negatives = [
    'outra sessão',
    'quero massagem',
    'obrigado, às 10',
    'tem horário amanhã?',
    // D3: correção de variante, não abandono A.
    'Na verdade não quero pernas, só axila',
  ]

  it.each(positives)('TP: %s', (text) => {
    const hits = classifySensitive(text)
    expect(hasSoftDeclineRequest(hits)).toBe(true)
    expect(wantsHumanPause(hits)).toBe(false)
  })

  it.each(negatives)('FP: %s', (text) => {
    expect(hasSoftDeclineRequest(classifySensitive(text))).toBe(false)
  })

  it.each(['não', 'não serve'] as const)('classe C não é A/B: %s', (text) => {
    expect(hasSoftDeclineRequest(classifySensitive(text))).toBe(false)
    expect(hasSlotRejectRequest(classifySensitive(text))).toBe(true)
  })
})

describe('tryAiAutoBook — rejeição de slots classe C (DEC-147)', () => {
  it('«não serve» com oferta → mantém variante e volta a oferecer, sem Não encontrei', async () => {
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
            options: [
              { key: '2026-11-06T14:00', label: '14:00' },
              { key: '2026-11-06T15:00', label: '15:00' },
            ],
            messageId: 'm_slots_c',
          },
          lastOffer: {
            slots: [{ startsAt: Date.UTC(2026, 10, 6, 17, 0), professionalId: s.pro.id }],
            messageId: 'm_slots_c',
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
          body: 'não serve',
          deliveryState: 'received',
          createdAt: s.clock.nowMs(),
        },
        s.clock,
      )
      const out = await tryAiAutoBook(s.db, s.caller, s.clock, {
        conversationId: s.cnv.id,
        capability: true,
      })
      expect(out.replyText).not.toMatch(/Não encontrei/i)
      expect(out.replyText).not.toMatch(/quando quiser|fico por aqui/i)
      expect(out.deferredFrame?.hasWork).toBe(true)
      out.deferredFrame!.flushNow(s.db, s.tenantId, s.cnv.id, s.clock)
      const frame = getBookingFrame(s.db, s.tenantId, s.cnv.id)
      // Classe C: não abandona — serviço fica; não é adeus A/B.
      expect(frame).not.toBeNull()
      expect(frame?.serviceId).toBe(s.svc.id)
    } finally {
      s.close()
    }
  })
})

describe('tryAiAutoBook — CF-23: agradecimento com proposta não abandona (DEC-147 B)', () => {
  it('«obrigada!» com proposta aberta mantém a proposta', async () => {
    const s = seed()
    try {
      saveBookingFrame(
        s.db,
        s.tenantId,
        s.cnv.id,
        {
          serviceId: s.svc.id,
          line: 'feminino',
          date: '2026-11-06',
          time: '14:00',
          phase: 'proposto',
        },
        s.clock,
      )
      const startsAt = zonedCivilToUtc(TZ, 2026, 10, 29, 14, 0)
      const proposal = createProposal(
        s.db,
        s.tenantId,
        {
          contactId: s.contact.id,
          conversationId: s.cnv.id,
          serviceId: s.svc.id,
          professionalId: s.pro.id,
          startsAt,
        },
        s.clock,
      )
      markProposalSent(s.db, s.tenantId, proposal.id, s.clock)
      s.clock.advance(60_000)
      insertMessage(
        s.db,
        {
          tenantId: s.tenantId,
          conversationId: s.cnv.id,
          direction: 'inbound',
          body: 'obrigada!',
          deliveryState: 'received',
          createdAt: s.clock.nowMs(),
        },
        s.clock,
      )
      await tryAiAutoBook(s.db, s.caller, s.clock, {
        conversationId: s.cnv.id,
        capability: true,
      })
      expect(getActiveProposalForConversation(s.db, s.tenantId, s.cnv.id, s.clock)?.id).toBe(
        proposal.id,
      )
      expect(getProposal(s.db, s.tenantId, proposal.id)?.state).not.toBe('substituida')
    } finally {
      s.close()
    }
  })
})

describe('tryAiAutoBook — desistência após slots A/B (DEC-147)', () => {
  it.each([
    'Deixa estar, obrigado',
    'Podes encerrar a sessao',
  ] as const)('oferta aberta + «%s» → frame limpo, adeus, sem Não encontrei', async (body) => {
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
          body,
          deliveryState: 'received',
          createdAt: s.clock.nowMs(),
        },
        s.clock,
      )

      const out = await tryAiAutoBook(s.db, s.caller, s.clock, {
        conversationId: s.cnv.id,
        capability: true,
      })
      expect(out.replyText).toMatch(/quando quiser|fico por aqui|qualquer coisa/i)
      expect(out.replyText).not.toMatch(/Não encontrei/i)
      expect(out.replyText).not.toMatch(/Quer .+Opç/i)
      expect(out.deferredFrame?.hasWork).toBe(true)

      out.deferredFrame!.flushNow(s.db, s.tenantId, s.cnv.id, s.clock)
      expect(getBookingFrame(s.db, s.tenantId, s.cnv.id)).toBeNull()
    } finally {
      s.close()
    }
  })
})

describe('encerrar conversa limpa BookingFrame (#508)', () => {
  it('closeConversationOp no painel apaga o frame e emite booking_frame.updated', () => {
    const s = seed()
    try {
      saveBookingFrame(
        s.db,
        s.tenantId,
        s.cnv.id,
        { serviceId: s.svc.id, line: 'feminino', date: '2026-11-06', time: '10:00' },
        s.clock,
      )
      const closed = closeConversationOp(
        s.db,
        s.caller,
        {
          conversationId: s.cnv.id,
          actorClerkUserId: 'user_synth_owner_a',
          actorDisplayName: 'Owner',
        },
        s.clock,
      )
      expect(getBookingFrame(s.db, s.tenantId, s.cnv.id)).toBeNull()
      expect(closed.outbox.some((o) => o.type === 'booking_frame.updated')).toBe(true)
      expect(closed.outbox.some((o) => o.type === 'conversation.closed')).toBe(true)
    } finally {
      s.close()
    }
  })

  it('Terminar no idle (DEC-087) limpa o frame', () => {
    const s = seed()
    try {
      ensureOpenOpportunity(
        s.db,
        {
          tenantId: s.tenantId,
          contactId: s.contact.id,
          conversationId: s.cnv.id,
        },
        s.clock,
      )
      insertMessage(
        s.db,
        {
          tenantId: s.tenantId,
          conversationId: s.cnv.id,
          direction: 'inbound',
          body: 'oi',
          deliveryState: 'received',
          createdAt: s.clock.nowMs(),
        },
        s.clock,
      )
      saveBookingFrame(
        s.db,
        s.tenantId,
        s.cnv.id,
        { serviceId: s.svc.id, date: '2026-11-06' },
        s.clock,
      )
      rescheduleConversationIdle(s.db, s.tenantId, s.cnv.id, s.clock, {
        progressAt: s.clock.nowMs(),
      })
      s.clock.advance(IDLE_PROMPT_AFTER_MS + 1)
      sweepDueIdleConversations(s.db, s.tenantId, s.clock)
      const click = handleIdleButtonClick(
        s.db,
        {
          tenantId: s.tenantId,
          conversationId: s.cnv.id,
          buttonId: idleButtonId(s.cnv.id, 'end'),
          providerEventKey: 'wa:idle:end:508',
        },
        s.clock,
      )
      expect(click.handled).toBe(true)
      if (!click.handled) return
      expect(getBookingFrame(s.db, s.tenantId, s.cnv.id)).toBeNull()
      expect(click.outbox.some((o) => o.type === 'booking_frame.updated')).toBe(true)
    } finally {
      s.close()
    }
  })

  it('fecho automático por segundo prazo idle limpa o frame', () => {
    const s = seed()
    try {
      ensureOpenOpportunity(
        s.db,
        {
          tenantId: s.tenantId,
          contactId: s.contact.id,
          conversationId: s.cnv.id,
        },
        s.clock,
      )
      insertMessage(
        s.db,
        {
          tenantId: s.tenantId,
          conversationId: s.cnv.id,
          direction: 'inbound',
          body: 'oi',
          deliveryState: 'received',
          createdAt: s.clock.nowMs(),
        },
        s.clock,
      )
      saveBookingFrame(
        s.db,
        s.tenantId,
        s.cnv.id,
        { serviceId: s.svc.id, date: '2026-11-06' },
        s.clock,
      )
      rescheduleConversationIdle(s.db, s.tenantId, s.cnv.id, s.clock, {
        progressAt: s.clock.nowMs(),
      })
      s.clock.advance(IDLE_PROMPT_AFTER_MS + 1)
      sweepDueIdleConversations(s.db, s.tenantId, s.clock)
      s.clock.advance(IDLE_CLOSE_AFTER_MS + 1)
      const swept = sweepDueIdleConversations(s.db, s.tenantId, s.clock)
      expect(swept.some((r) => r.action === 'closed')).toBe(true)
      expect(getBookingFrame(s.db, s.tenantId, s.cnv.id)).toBeNull()
    } finally {
      s.close()
    }
  })
})

describe('clearBookingFrame emite evento no recomeço', () => {
  it('clear com clock emite booking_frame.updated', () => {
    const s = seed()
    try {
      saveBookingFrame(
        s.db,
        s.tenantId,
        s.cnv.id,
        { serviceId: s.svc.id },
        s.clock,
      )
      const ob = clearBookingFrame(s.db, s.tenantId, s.cnv.id, s.clock)
      expect(ob?.type).toBe('booking_frame.updated')
      expect(JSON.parse(ob!.payloadJson)).toMatchObject({
        conversationId: s.cnv.id,
        phase: 'idle',
        serviceId: null,
      })
    } finally {
      s.close()
    }
  })
})
