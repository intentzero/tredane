/**
 * Baseline 15/11/2026 — itens P3 (atendente) e P4 (handoff indevido + silêncio)
 * e regra de 2 incompreensões consecutivas (aprovada 15/11 17:46 BRT).
 */
import { describe, expect, it } from 'vitest'
import { createControllableClock } from '../../db/clock'
import { setWeeklyWindowsOp, upsertResourceOp, upsertServiceOp } from '../config'
import { setClinicAiAssistEnabled } from '../config/settings'
import { upsertContact } from '../contacts'
import { workerCaller } from '../index'
import { createConversation } from '../inbox/conversations'
import { readReviewFlag } from '../inbox/review-flag'
import { listOpenPendingCommunicationsForConversation } from '../proposals/pending-communication'
import { insertMessage } from '../inbox/messages'
import { bootClinicDb } from '../test-db'
import { syncWhatsappChannel } from '../whatsapp/channel'
import {
  classifySensitive,
  wantsHumanText,
  BOOKING_ACK_WITH_THANKS_RE,
  FAMILY_VOCATIVE_RE,
} from './nlu/sensitive'
import { resolveBookingObject } from './booking-object'
import {
  afterHoursHumanRequestBody,
  inboundWarrantsHandoffResume,
  notifyHumanHandoff,
  readAiReplyPause,
  replyAfterHoursHumanRequest,
} from './human-handoff'
import { notifyModelFallback, MODEL_FALLBACK_TEXT } from './model-fallback'
import { MISUNDERSTANDING_ESCALATION_TEXT } from './misunderstanding-streak'
import { enqueueAutoDraft, runDueAutoDrafts } from './autodraft'
import type { AiGenerateResult } from '../../ai'

const TZ_CLOSED = Date.UTC(2026, 10, 9, 14, 0) // domingo fora do horário (S3/S9)

function seed(nowMs: number) {
  const clock = createControllableClock(nowMs)
  const boot = bootClinicDb({ clock })
  const { db } = boot
  const tenantId = 'clinic-demo-p34'
  const caller = workerCaller(tenantId, 'user_synth_owner_p34')
  syncWhatsappChannel(
    db,
    tenantId,
    {
      status: 'connected',
      bindingId: 'bind_p34',
      phoneNumberId: 'pn_p34',
      wabaId: 'waba_p34',
      displayPhone: '+5511900000100',
      displayName: 'Clínica baseline',
      action: 'channel_connected',
    },
    clock,
  )
  const luiza = upsertResourceOp(db, caller, { kind: 'professional', name: 'Luiza' }, clock)
  const toxina = upsertServiceOp(
    db,
    caller,
    {
      name: 'Toxina botulínica (3 regiões)',
      durationMinutes: 30,
      bufferMinutes: 15,
      priceCents: 120_000,
      professionalIds: [luiza.id],
      roomRequirement: { mode: 'none' },
    },
    clock,
  )
  setWeeklyWindowsOp(
    db,
    caller,
    {
      resourceId: luiza.id,
      windows: [1, 2, 3, 4, 5, 6].map((d) => ({
        dayOfWeek: d,
        startMinute: 540,
        endMinute: 19 * 60,
      })),
    },
    clock,
  )
  setClinicAiAssistEnabled(db, tenantId, true, clock)
  const contact = upsertContact(db, { tenantId, waId: '5511900000101', displayName: 'Lurdes' }, clock)
  const cnv = createConversation(db, { tenantId, contactId: contact.id, status: 'open' }, clock)
  insertMessage(
    db,
    {
      tenantId,
      conversationId: cnv.id,
      direction: 'inbound',
      body: 'oi',
      deliveryState: 'received',
      createdAt: nowMs - 60_000,
    },
    clock,
  )
  return { db, caller, tenantId, clock, cnv, toxina, close: boot.close }
}

describe('baseline P3 — pedido de atendente', () => {
  it.each([
    'tem uma pessoa ai?',
    'boa tarde, nao to entendendo nada desse robo',
    'qual o telefone de vcs? prefiro ligar',
    'tem como falar com alguem?',
  ])('«%s» é pedido humano à primeira', (text) => {
    expect(wantsHumanText(text)).toBe(true)
    expect(classifySensitive(text).map((h) => h.label)).toContain('pedir_pessoa')
  })

  it('fora do horário registra pedido e não pausa', () => {
    const s = seed(TZ_CLOSED)
    try {
      const body = afterHoursHumanRequestBody(s.db, s.tenantId, s.clock, s.cnv.id)
      expect(body).toContain('Deixei seu pedido para a equipe')
      const reply = replyAfterHoursHumanRequest(
        s.db,
        s.tenantId,
        { conversationId: s.cnv.id, clientRequestId: 'after-hours-reg' },
        s.clock,
      )
      expect(reply.outbox.some((o) => o.type === 'whatsapp.send')).toBe(true)
      expect(readAiReplyPause(s.db, s.tenantId, s.cnv.id)).toBeNull()
      const pending = listOpenPendingCommunicationsForConversation(s.db, s.tenantId, s.cnv.id)
      expect(pending.some((p) => p.kind === 'alter_awaiting_team' && p.status !== 'resolved')).toBe(
        true,
      )
      expect(readReviewFlag(s.db, s.tenantId, s.cnv.id)?.flaggedAt).not.toBeNull()
    } finally {
      s.close()
    }
  })
})

describe('baseline P4 — falsos positivos e silêncio', () => {
  it('vocativo «minha filha» não é terceiro', () => {
    const text =
      'Boa tarde minha filha. Eu queria ver aquele negocio pra ruga da testa'
    expect(FAMILY_VOCATIVE_RE.test(text)).toBe(true)
    expect(classifySensitive(text).map((h) => h.label)).not.toContain('terceiro')
  })

  it('«ruga da testa» aproxima toxina botulínica', () => {
    const s = seed(TZ_CLOSED)
    try {
      const match = resolveBookingObject({
        text: 'Eu queria ver aquele negocio pra ruga da testa',
        services: [{ ...s.toxina, active: true, zones: [], synonyms: ['botox'] }],
        conversationId: s.cnv.id,
      })
      expect(match.handoffReason).not.toBe('terceiro')
      expect(match.kind === 'clarify' || match.serviceId != null || match.kind === 'none').toBe(true)
    } finally {
      s.close()
    }
  })

  it('confirmação com «deus te abençoe» não é abandono nem terceiro', () => {
    const text = 'sim pode marcar. obrigada minha filha deus te abençoe'
    expect(BOOKING_ACK_WITH_THANKS_RE.test(text)).toBe(true)
    expect(classifySensitive(text).map((h) => h.label)).not.toContain('terceiro')
    expect(classifySensitive(text).map((h) => h.label)).not.toContain('desistir')
  })

  it('mensagem após handoff off_purpose retoma ou acusa receção (sem silêncio)', async () => {
    const s = seed(TZ_CLOSED)
    try {
      notifyHumanHandoff(
        s.db,
        s.tenantId,
        {
          conversationId: s.cnv.id,
          reason: 'off_purpose',
          clientRequestId: 'handoff-health',
        },
        s.clock,
      )
      expect(readAiReplyPause(s.db, s.tenantId, s.cnv.id)?.reason).toBe('off_purpose')
      expect(inboundWarrantsHandoffResume('o botox. Queria marcar pra quinta', 'off_purpose')).toBe(
        true,
      )
      const msg = insertMessage(
        s.db,
        {
          tenantId: s.tenantId,
          conversationId: s.cnv.id,
          direction: 'inbound',
          body: 'o botox. Queria marcar pra quinta depois do almoço',
          deliveryState: 'received',
          createdAt: s.clock.nowMs(),
        },
        s.clock,
      )
      enqueueAutoDraft(s.db, s.tenantId, { conversationId: s.cnv.id, messageId: msg.id }, s.clock)
      s.clock.advance(4_000)
      const adapter = {
        providerId: 'test',
        mode: 'synthetic' as const,
        async generate(): Promise<AiGenerateResult> {
          throw new Error('no_model')
        },
        lastInspection() {
          return null
        },
      }
      await runDueAutoDrafts(s.db, s.caller, s.clock, { mode: 'synthetic', adapter })
      const outbound = s.db.get<{ body: string }>(
        `SELECT body FROM messages WHERE tenant_id = ? AND conversation_id = ? AND direction = 'outbound' ORDER BY created_at DESC LIMIT 1`,
        s.tenantId,
        s.cnv.id,
      )
      expect(outbound?.body?.trim().length).toBeGreaterThan(0)
      expect(readAiReplyPause(s.db, s.tenantId, s.cnv.id)).toBeNull()
    } finally {
      s.close()
    }
  })
})

describe('regra 2 incompreensões consecutivas (aprovada fundador 15/11)', () => {
  it('à 2.ª falha envia oferta de equipe em vez da frase DEC-107', () => {
    const s = seed(TZ_CLOSED)
    try {
      const first = notifyModelFallback(
        s.db,
        s.tenantId,
        { conversationId: s.cnv.id, messageId: 'msg-1' },
        s.clock,
      )
      expect(first.sent).toBe(true)
      const second = notifyModelFallback(
        s.db,
        s.tenantId,
        { conversationId: s.cnv.id, messageId: 'msg-2' },
        s.clock,
      )
      expect(second.sent).toBe(true)
      const bodies = s.db.all<{ body: string }>(
        `SELECT body FROM messages WHERE tenant_id = ? AND direction = 'outbound' ORDER BY created_at ASC`,
        s.tenantId,
      )
      expect(bodies.map((r) => r.body)).toContain(MODEL_FALLBACK_TEXT)
      expect(bodies.map((r) => r.body)).toContain(MISUNDERSTANDING_ESCALATION_TEXT)
      const pending = listOpenPendingCommunicationsForConversation(s.db, s.tenantId, s.cnv.id)
      expect(pending.length).toBeGreaterThan(0)
    } finally {
      s.close()
    }
  })
})