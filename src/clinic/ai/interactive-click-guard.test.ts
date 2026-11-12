import { describe, expect, it } from 'vitest'
import { createControllableClock } from '../../db/clock'
import { upsertContact } from '../contacts'
import { workerCaller } from '../index'
import { createConversation } from '../inbox/conversations'
import { insertMessage } from '../inbox/messages'
import { readAiReplyPause } from './human-handoff'
import { bootClinicDb } from '../test-db'
import { syncWhatsappChannel } from '../whatsapp/channel'
import {
  CHOICE_CLICK_FALLBACK_TEXT,
  CHOICE_STALE_CLICK_FALLBACK_TEXT,
  escalateChoiceClickDeliveryToTeam,
  hasChoiceClickBookingDelivery,
  pickFallbackBody,
  sendChoiceClickSilentFallback,
} from './interactive-click-guard'
import { sendOutboundMessageOp } from '../inbox/operations'

const NOW = Date.UTC(2026, 10, 12, 23, 0)

function seed() {
  const clock = createControllableClock(NOW)
  const boot = bootClinicDb({ clock })
  const { db } = boot
  const tenantId = 'clinic-demo-guard'
  syncWhatsappChannel(
    db,
    tenantId,
    {
      status: 'connected',
      bindingId: 'bind_guard',
      phoneNumberId: 'pn_guard',
      wabaId: 'waba_guard',
      displayPhone: '+5511900000888',
      displayName: 'Clínica Guard',
      action: 'channel_connected',
    },
    clock,
  )
  const contact = upsertContact(db, { tenantId, waId: '5511900000888', displayName: 'Ana' }, clock)
  const cnv = createConversation(db, { tenantId, contactId: contact.id, status: 'open' }, clock)
  insertMessage(
    db,
    {
      tenantId,
      conversationId: cnv.id,
      direction: 'inbound',
      body: 'quero horário',
      deliveryState: 'received',
      createdAt: NOW - 60_000,
    },
    clock,
  )
  const caller = workerCaller(tenantId)
  return { db, clock, tenantId, cnv, caller, close: boot.close }
}

describe('CHOICE_CLICK_FALLBACK_TEXT', () => {
  it('usa a cópia aprovada pelo fundador', () => {
    expect(CHOICE_CLICK_FALLBACK_TEXT).toBe('Recebi sua escolha, já confirmo para você.')
  })
})

describe('pickFallbackBody', () => {
  it('stale_cleared → texto de oferta indisponível', () => {
    expect(pickFallbackBody('stale_cleared', 'no_pending')).toBe(CHOICE_STALE_CLICK_FALLBACK_TEXT)
  })

  it('reason expired → texto de oferta indisponível', () => {
    expect(pickFallbackBody('stale_reoffered', 'expired')).toBe(CHOICE_STALE_CLICK_FALLBACK_TEXT)
    expect(pickFallbackBody('applied', 'expired')).toBe(CHOICE_STALE_CLICK_FALLBACK_TEXT)
  })

  it('timeout → texto de recebi sua escolha', () => {
    expect(pickFallbackBody('applied', 'timeout')).toBe(CHOICE_CLICK_FALLBACK_TEXT)
  })

  it('already_sent → texto de recebi sua escolha', () => {
    expect(pickFallbackBody('applied', 'already_sent')).toBe(CHOICE_CLICK_FALLBACK_TEXT)
  })

  it('error → texto de recebi sua escolha', () => {
    expect(pickFallbackBody('applied', 'error')).toBe(CHOICE_CLICK_FALLBACK_TEXT)
  })

  it('sem reason → texto de recebi sua escolha', () => {
    expect(pickFallbackBody('applied')).toBe(CHOICE_CLICK_FALLBACK_TEXT)
    expect(pickFallbackBody()).toBe(CHOICE_CLICK_FALLBACK_TEXT)
  })
})

describe('escalateChoiceClickDeliveryToTeam', () => {
  it('fil fallback sem booking → handoff silencioso + um alerta; repetição idempotente', () => {
    const s = seed()
    try {
      const providerEventKey = 'wa:msg:handoff1'
      sendChoiceClickSilentFallback(
        s.db,
        s.caller,
        { conversationId: s.cnv.id, providerEventKey, outcome: 'applied', reason: 'timeout' },
        s.clock,
      )
      expect(hasChoiceClickBookingDelivery(s.db, s.tenantId, providerEventKey, s.cnv.id)).toBe(false)

      const first = escalateChoiceClickDeliveryToTeam(
        s.db,
        s.tenantId,
        { conversationId: s.cnv.id, providerEventKey },
        s.clock,
      )
      expect(first.escalated).toBe(true)
      expect(readAiReplyPause(s.db, s.tenantId, s.cnv.id)).not.toBeNull()
      const pendingCount = s.db.get<{ n: number }>(
        `SELECT COUNT(*) AS n FROM pending_communications
         WHERE tenant_id = ? AND conversation_id = ? AND kind = 'alter_awaiting_team'`,
        s.tenantId,
        s.cnv.id,
      )?.n
      expect(pendingCount).toBe(1)
      const outboundBodies = () =>
        s.db
          .all<{ body: string }>(
            `SELECT m.body AS body FROM outbound_messages o
             JOIN messages m ON m.id = o.message_id
             WHERE o.tenant_id = ? AND o.conversation_id = ?`,
            s.tenantId,
            s.cnv.id,
          )
          .map((r) => r.body)

      const bodiesAfterFirst = outboundBodies()
      expect(bodiesAfterFirst).toContain(CHOICE_CLICK_FALLBACK_TEXT)
      expect(bodiesAfterFirst.filter((b) => b.includes('Vou pedir para a equipe')).length).toBe(0)

      const second = escalateChoiceClickDeliveryToTeam(
        s.db,
        s.tenantId,
        { conversationId: s.cnv.id, providerEventKey },
        s.clock,
      )
      expect(second.already).toBe(true)
      expect(second.escalated).toBe(false)
      expect(outboundBodies()).toEqual(bodiesAfterFirst)
    } finally {
      s.close()
    }
  })

  it('hasChoiceClickBookingDelivery ignora só o anti-silêncio genérico', () => {
    const s = seed()
    try {
      const providerEventKey = 'wa:msg:split'
      sendChoiceClickSilentFallback(
        s.db,
        s.caller,
        { conversationId: s.cnv.id, providerEventKey, outcome: 'applied' },
        s.clock,
      )
      expect(hasChoiceClickBookingDelivery(s.db, s.tenantId, providerEventKey, s.cnv.id)).toBe(false)
      sendOutboundMessageOp(
        s.db,
        s.caller,
        {
          conversationId: s.cnv.id,
          body: 'Proposta enviada',
          clientRequestId: `choice:${providerEventKey}`,
          authorClerkUserId: 'system:ai-autodraft',
          authorDisplayName: 'IA',
        },
        s.clock,
      )
      expect(hasChoiceClickBookingDelivery(s.db, s.tenantId, providerEventKey, s.cnv.id)).toBe(true)
    } finally {
      s.close()
    }
  })
})
