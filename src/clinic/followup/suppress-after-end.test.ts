/**
 * Terminar: cancela idle + timeout de handoff e a IA assume (mesmo após Assumir).
 */
import { describe, expect, it } from 'vitest'
import { createControllableClock } from '../../db/clock'
import { HANDOFF_TIMEOUT_MS } from '../constants'
import {
  notifyHumanHandoff,
  readAiReplyPause,
  readHandoffTimeoutAt,
} from '../ai/human-handoff'
import { assignConversationOp } from '../inbox/operations'
import { ingestContactMessage, workerCaller } from '../index'
import { bootClinicDb } from '../test-db'
import { syncWhatsappChannel } from '../whatsapp/channel'
import { seedSyntheticWhatsappTemplates } from '../inbox/templates'
import { ensureOpenOpportunity } from '../pipeline/operations'
import { setConversationIdle } from './idle-state'
import { suppressFollowupsAfterClientEnd } from './suppress-after-end'

const AI = 'system:ai-autodraft'

function seed() {
  const clock = createControllableClock(Date.UTC(2026, 10, 13, 12))
  const boot = bootClinicDb({ clock })
  const { db } = boot
  syncWhatsappChannel(
    db,
    'clinic-demo-a',
    {
      status: 'connected',
      bindingId: 'b1',
      phoneNumberId: 'pn1',
      wabaId: 'w1',
      displayPhone: '+1555',
      action: 'channel_connected',
    },
    clock,
  )
  seedSyntheticWhatsappTemplates(db, 'clinic-demo-a', clock)
  const caller = workerCaller('clinic-demo-a', 'user_synth_attendant_a')
  const ingested = ingestContactMessage(
    db,
    caller,
    {
      providerEventKey: `wa:suppress:${clock.nowMs()}`,
      waId: '5511987001880',
      body: 'oi',
    },
    clock,
  )
  const conversationId = ingested.conversation!.id
  ensureOpenOpportunity(
    db,
    {
      tenantId: 'clinic-demo-a',
      contactId: ingested.contact!.id,
      conversationId,
    },
    clock,
  )
  return { db, clock, caller, conversationId, close: boot.close }
}

describe('suppressFollowupsAfterClientEnd', () => {
  it('limpa idle/timeout e a IA assume após handoff aberto', () => {
    const s = seed()
    try {
      notifyHumanHandoff(
        s.db,
        'clinic-demo-a',
        {
          conversationId: s.conversationId,
          reason: 'off_purpose',
          clientRequestId: 'wa:suppress:handoff',
        },
        s.clock,
      )
      setConversationIdle(s.db, 'clinic-demo-a', s.conversationId, {
        phase: 'prompt',
        dueAt: s.clock.nowMs() + 60_000,
        promptSentAt: null,
        updatedAt: s.clock.nowMs(),
      })

      const outbox = suppressFollowupsAfterClientEnd(
        s.db,
        'clinic-demo-a',
        s.conversationId,
        s.clock,
      )
      expect(outbox.some((o) => o.type === 'conversation.ai_pause')).toBe(true)
      expect(readAiReplyPause(s.db, 'clinic-demo-a', s.conversationId)).toBeNull()
      expect(readHandoffTimeoutAt(s.db, 'clinic-demo-a', s.conversationId)).toBeNull()
      const row = s.db.get<{ due: number | null; assignee: string | null }>(
        `SELECT idle_due_at AS due, assignee_clerk_user_id AS assignee
         FROM conversations WHERE id = ?`,
        s.conversationId,
      )
      expect(row?.due).toBeNull()
      expect(row?.assignee).toBe(AI)
      expect(s.clock.nowMs() + HANDOFF_TIMEOUT_MS).toBeGreaterThan(s.clock.nowMs())
    } finally {
      s.close()
    }
  })

  it('após Assumir, Terminar religa a IA (revê DEC-083 só neste caminho)', () => {
    const s = seed()
    try {
      notifyHumanHandoff(
        s.db,
        'clinic-demo-a',
        {
          conversationId: s.conversationId,
          reason: 'customer_requested',
          clientRequestId: 'wa:suppress:assumir-handoff',
        },
        s.clock,
      )
      assignConversationOp(
        s.db,
        s.caller,
        {
          conversationId: s.conversationId,
          assigneeClerkUserId: 'user_synth_attendant_a',
          assigneeDisplayName: 'Ana',
          actorClerkUserId: 'user_synth_attendant_a',
          actorDisplayName: 'Ana',
        },
        s.clock,
      )
      expect(readHandoffTimeoutAt(s.db, 'clinic-demo-a', s.conversationId)).toBeNull()
      expect(readAiReplyPause(s.db, 'clinic-demo-a', s.conversationId)?.at).not.toBeNull()
      expect(
        s.db.get<{ a: string | null }>(
          `SELECT assignee_clerk_user_id AS a FROM conversations WHERE id = ?`,
          s.conversationId,
        )?.a,
      ).toBe('user_synth_attendant_a')

      suppressFollowupsAfterClientEnd(
        s.db,
        'clinic-demo-a',
        s.conversationId,
        s.clock,
      )
      expect(readAiReplyPause(s.db, 'clinic-demo-a', s.conversationId)).toBeNull()
      expect(readHandoffTimeoutAt(s.db, 'clinic-demo-a', s.conversationId)).toBeNull()
      expect(
        s.db.get<{ a: string | null }>(
          `SELECT assignee_clerk_user_id AS a FROM conversations WHERE id = ?`,
          s.conversationId,
        )?.a,
      ).toBe(AI)
    } finally {
      s.close()
    }
  })
})
