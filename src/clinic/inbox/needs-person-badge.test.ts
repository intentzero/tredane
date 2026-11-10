/**
 * DEC-156 — Assumir limpa «Precisa de alguém» (gancho clearedAwaitingTeam / DEC-155).
 */
import { describe, expect, it } from 'vitest'
import { createControllableClock } from '../../db/clock'
import { upsertContact } from '../contacts'
import { notifyHumanHandoff, readAiReplyPause } from '../ai/human-handoff'
import { bootClinicDb } from '../test-db'
import { syncWhatsappChannel } from '../whatsapp/channel'
import { workerCaller } from '../index'
import { assignConversationOp } from './operations'
import { createConversation, listConversations } from './conversations'
import { insertMessage } from './messages'

const NOW = Date.UTC(2026, 10, 10, 15, 0)

describe('DEC-156 needsPerson badge', () => {
  it('handoff marca Precisa de alguém; Assumir limpa sem religar a IA', () => {
    const clock = createControllableClock(NOW)
    const { db, close } = bootClinicDb({ clock })
    try {
      const tenantId = 'clinic-demo-a'
      syncWhatsappChannel(
        db,
        tenantId,
        {
          status: 'connected',
          bindingId: 'bind_badge',
          phoneNumberId: 'pn_badge',
          wabaId: 'waba_badge',
          displayPhone: '+5511900000033',
          displayName: 'Clínica Badge',
          action: 'channel_connected',
        },
        clock,
      )
      const contact = upsertContact(
        db,
        { tenantId, waId: '5511900000034', displayName: 'Lia' },
        clock,
      )
      const cnv = createConversation(
        db,
        { tenantId, contactId: contact.id, status: 'open' },
        clock,
      )
      insertMessage(
        db,
        {
          tenantId,
          conversationId: cnv.id,
          direction: 'inbound',
          body: 'quero uma pessoa',
          deliveryState: 'received',
          createdAt: NOW - 10_000,
        },
        clock,
      )
      notifyHumanHandoff(
        db,
        tenantId,
        {
          conversationId: cnv.id,
          reason: 'customer_requested',
          clientRequestId: 'badge-1',
        },
        clock,
      )
      expect(
        listConversations(db, tenantId, { filter: 'needs_person' }).items.some(
          (c) => c.id === cnv.id,
        ),
      ).toBe(true)

      const caller = workerCaller(tenantId, 'user_synth_owner_a')
      const assigned = assignConversationOp(
        db,
        caller,
        {
          conversationId: cnv.id,
          assigneeClerkUserId: 'user_synth_owner_a',
          assigneeDisplayName: 'Owner',
          actorClerkUserId: 'user_synth_owner_a',
          actorDisplayName: 'Owner',
        },
        clock,
      )
      expect(assigned.outbox.some((o) => o.type === 'conversation.assigned')).toBe(true)
      const assignPayload = JSON.parse(
        assigned.outbox.find((o) => o.type === 'conversation.assigned')!.payloadJson,
      ) as { clearedAwaitingTeam?: boolean }
      expect(assignPayload.clearedAwaitingTeam).toBe(true)
      expect(
        listConversations(db, tenantId, { filter: 'needs_person' }).items.some(
          (c) => c.id === cnv.id,
        ),
      ).toBe(false)
      expect(readAiReplyPause(db, tenantId, cnv.id)).not.toBeNull()
    } finally {
      close()
    }
  })
})
