/**
 * DEC-155 — timeout 30 min sem Assumir → devolver à IA; fora do expediente sem pausa.
 */
import { describe, expect, it } from 'vitest'
import { createControllableClock } from '../../db/clock'
import { HANDOFF_TIMEOUT_MS } from '../constants'
import { setWeeklyWindowsOp, upsertResourceOp, upsertServiceOp } from '../config'
import { setClinicAiAssistEnabled } from '../config/settings'
import { upsertContact } from '../contacts'
import { workerCaller } from '../index'
import { assignConversationOp } from '../inbox/operations'
import { createConversation } from '../inbox/conversations'
import { insertMessage } from '../inbox/messages'
import { bootClinicDb } from '../test-db'
import { syncWhatsappChannel } from '../whatsapp/channel'
import {
  AFTER_HOURS_HUMAN_KEEP_AI_FALLBACK,
  HANDOFF_TIMEOUT_RESUME_TEXT,
  HUMAN_HANDOFF_TEXT,
  afterHoursHumanRequestBody,
  isHumanTeamOfferAllowed,
  nextHandoffTimeoutAt,
  notifyHumanHandoff,
  readAiReplyPause,
  readHandoffTimeoutAt,
  replyAfterHoursHumanRequest,
  resumeAiReply,
  sweepDueHandoffTimeouts,
} from './human-handoff'

const TZ_OPEN = Date.UTC(2026, 9, 28, 15, 0) // quarta 12:00 America/Sao_Paulo
const TZ_CLOSED = Date.UTC(2026, 10, 7, 20, 0) // sáb 17:00 America/Sao_Paulo

function seed(nowMs: number) {
  const clock = createControllableClock(nowMs)
  const boot = bootClinicDb({ clock })
  const { db } = boot
  const tenantId = 'clinic-demo-a'
  const caller = workerCaller(tenantId, 'user_synth_owner_a')
  syncWhatsappChannel(
    db,
    tenantId,
    {
      status: 'connected',
      bindingId: 'bind_timeout',
      phoneNumberId: 'pn_timeout',
      wabaId: 'waba_timeout',
      displayPhone: '+5511900000011',
      displayName: 'Clínica Timeout',
      action: 'channel_connected',
    },
    clock,
  )
  const gi = upsertResourceOp(db, caller, { kind: 'professional', name: 'Gi' }, clock)
  upsertServiceOp(
    db,
    caller,
    {
      name: 'Depilação',
      durationMinutes: 15,
      bufferMinutes: 15,
      priceCents: 5000,
      professionalIds: [gi.id],
      roomRequirement: { mode: 'none' },
    },
    clock,
  )
  setWeeklyWindowsOp(
    db,
    caller,
    {
      resourceId: gi.id,
      windows: [1, 2, 3, 4, 5].map((d) => ({
        dayOfWeek: d,
        startMinute: 540,
        endMinute: 1080,
      })),
    },
    clock,
  )
  setClinicAiAssistEnabled(db, tenantId, true, clock)
  const contact = upsertContact(db, { tenantId, waId: '5511900000012', displayName: 'Ana' }, clock)
  const cnv = createConversation(db, { tenantId, contactId: contact.id, status: 'open' }, clock)
  // Abre a janela 24 h do WhatsApp para o outbound do timeout / after-hours.
  insertMessage(
    db,
    {
      tenantId,
      conversationId: cnv.id,
      direction: 'inbound',
      body: 'Oi',
      deliveryState: 'received',
      createdAt: nowMs - 60_000,
    },
    clock,
  )
  return { db, caller, tenantId, clock, cnv, close: boot.close }
}

function payloadOf(row: { payloadJson: string }): Record<string, unknown> {
  return JSON.parse(row.payloadJson) as Record<string, unknown>
}

describe('DEC-155 handoff timeout', () => {
  it('pausa agenda timeout em 30 min; Assumir cancela o prazo', () => {
    const s = seed(TZ_OPEN)
    try {
      expect(isHumanTeamOfferAllowed(s.db, s.tenantId, s.clock)).toBe(true)
      const handoff = notifyHumanHandoff(
        s.db,
        s.tenantId,
        {
          conversationId: s.cnv.id,
          reason: 'customer_requested',
          clientRequestId: 'timeout-test-1',
        },
        s.clock,
      )
      expect(handoff.already).toBe(false)
      expect(readAiReplyPause(s.db, s.tenantId, s.cnv.id)?.at).toBe(TZ_OPEN)
      expect(readHandoffTimeoutAt(s.db, s.tenantId, s.cnv.id)).toBe(TZ_OPEN + HANDOFF_TIMEOUT_MS)
      expect(nextHandoffTimeoutAt(s.db, s.tenantId)).toBe(TZ_OPEN + HANDOFF_TIMEOUT_MS)

      assignConversationOp(
        s.db,
        s.caller,
        {
          conversationId: s.cnv.id,
          assigneeClerkUserId: 'user_synth_owner_a',
          assigneeDisplayName: 'Owner',
          actorClerkUserId: 'user_synth_owner_a',
          actorDisplayName: 'Owner',
        },
        s.clock,
      )
      expect(readHandoffTimeoutAt(s.db, s.tenantId, s.cnv.id)).toBeNull()
      expect(readAiReplyPause(s.db, s.tenantId, s.cnv.id)?.at).toBe(TZ_OPEN)
      expect(sweepDueHandoffTimeouts(s.db, s.tenantId, s.clock)).toHaveLength(0)
    } finally {
      s.close()
    }
  })

  it('após 30 min sem Assumir: mensagem curta + IA retomada (source timeout_resume)', () => {
    const s = seed(TZ_OPEN)
    try {
      notifyHumanHandoff(
        s.db,
        s.tenantId,
        {
          conversationId: s.cnv.id,
          reason: 'customer_requested',
          clientRequestId: 'timeout-test-2',
        },
        s.clock,
      )
      s.clock.advance(HANDOFF_TIMEOUT_MS + 1)
      const swept = sweepDueHandoffTimeouts(s.db, s.tenantId, s.clock)
      expect(swept).toHaveLength(1)
      expect(swept[0]!.conversationId).toBe(s.cnv.id)
      expect(readAiReplyPause(s.db, s.tenantId, s.cnv.id)).toBeNull()
      expect(readHandoffTimeoutAt(s.db, s.tenantId, s.cnv.id)).toBeNull()
      const pauseOff = swept[0]!.outbox.find((o) => o.type === 'conversation.ai_pause')
      expect(pauseOff && payloadOf(pauseOff)).toMatchObject({
        conversationId: s.cnv.id,
        aiReplyPaused: false,
        source: 'timeout_resume',
        handoffTimeoutAt: null,
      })
      const body = s.db.get<{ body: string }>(
        `SELECT body FROM messages WHERE tenant_id = ? AND direction = 'outbound' ORDER BY created_at DESC LIMIT 1`,
        s.tenantId,
      )?.body
      expect(body).toBe(HANDOFF_TIMEOUT_RESUME_TEXT)
    } finally {
      s.close()
    }
  })

  it('Devolver à IA limpa o timeout (source manual_resume)', () => {
    const s = seed(TZ_OPEN)
    try {
      notifyHumanHandoff(
        s.db,
        s.tenantId,
        {
          conversationId: s.cnv.id,
          reason: 'off_purpose',
          clientRequestId: 'timeout-test-3',
        },
        s.clock,
      )
      const outbox = resumeAiReply(s.db, s.tenantId, s.cnv.id, s.clock)
      expect(readHandoffTimeoutAt(s.db, s.tenantId, s.cnv.id)).toBeNull()
      expect(payloadOf(outbox[0]!)).toMatchObject({
        aiReplyPaused: false,
        source: 'manual_resume',
      })
    } finally {
      s.close()
    }
  })

  it('alarme agendado após Terminar/resume: sem alerta aberto → sem DEC-155', () => {
    const s = seed(TZ_OPEN)
    try {
      notifyHumanHandoff(
        s.db,
        s.tenantId,
        {
          conversationId: s.cnv.id,
          reason: 'customer_requested',
          clientRequestId: 'timeout-test-orphan-alarm',
        },
        s.clock,
      )
      const armedAt = readHandoffTimeoutAt(s.db, s.tenantId, s.cnv.id)!
      resumeAiReply(s.db, s.tenantId, s.cnv.id, s.clock, { source: 'manual_resume' })
      expect(readHandoffTimeoutAt(s.db, s.tenantId, s.cnv.id)).toBeNull()

      // Estado parcial como se o setAlarm órfão disparasse com colunas reaparecidas.
      s.db.run(
        `UPDATE conversations
         SET ai_reply_paused_at = ?, ai_reply_pause_reason = 'customer_requested',
             ai_handoff_timeout_at = ?, updated_at = ?
         WHERE tenant_id = ? AND id = ?`,
        TZ_OPEN,
        armedAt,
        s.clock.nowMs(),
        s.tenantId,
        s.cnv.id,
      )
      s.clock.advance(HANDOFF_TIMEOUT_MS + 1)
      expect(sweepDueHandoffTimeouts(s.db, s.tenantId, s.clock)).toHaveLength(0)
      const body = s.db.get<{ body: string }>(
        `SELECT body FROM messages WHERE tenant_id = ? AND conversation_id = ? AND direction = 'outbound'
         AND body = ? LIMIT 1`,
        s.tenantId,
        s.cnv.id,
        HANDOFF_TIMEOUT_RESUME_TEXT,
      )
      expect(body).toBeUndefined()
    } finally {
      s.close()
    }
  })
})

describe('DEC-155 fora do expediente', () => {
  it('pedido de equipe fora do horário: copy de abertura + IA activa', () => {
    const s = seed(TZ_CLOSED)
    try {
      expect(isHumanTeamOfferAllowed(s.db, s.tenantId, s.clock)).toBe(false)
      const body = afterHoursHumanRequestBody(s.db, s.tenantId, s.clock, s.cnv.id)
      expect(body).toContain('A equipe atende a partir de segunda às 09:00')
      expect(body).toContain('Posso continuar te ajudando por aqui')
      expect(body).not.toContain(HUMAN_HANDOFF_TEXT)

      const reply = replyAfterHoursHumanRequest(
        s.db,
        s.tenantId,
        { conversationId: s.cnv.id, clientRequestId: 'after-hours-1' },
        s.clock,
      )
      expect(reply.outbox.some((o) => o.type === 'whatsapp.send')).toBe(true)
      expect(readAiReplyPause(s.db, s.tenantId, s.cnv.id)).toBeNull()
      expect(readHandoffTimeoutAt(s.db, s.tenantId, s.cnv.id)).toBeNull()
    } finally {
      s.close()
    }
  })

  it('fallback sem próxima abertura usa copy estável', () => {
    expect(AFTER_HOURS_HUMAN_KEEP_AI_FALLBACK).toMatch(/Fora do horário/)
  })
})
