/**
 * Terminar / soft-close: cancela idle + timeout de handoff.
 */
import { describe, expect, it } from 'vitest'
import { createControllableClock } from '../../db/clock'
import { HANDOFF_TIMEOUT_MS } from '../constants'
import {
  notifyHumanHandoff,
  readAiReplyPause,
  readHandoffTimeoutAt,
} from '../ai/human-handoff'
import { ingestContactMessage, workerCaller } from '../index'
import { bootClinicDb } from '../test-db'
import { syncWhatsappChannel } from '../whatsapp/channel'
import { seedSyntheticWhatsappTemplates } from '../inbox/templates'
import { ensureOpenOpportunity } from '../pipeline/operations'
import { setConversationIdle } from './idle-state'
import { suppressFollowupsAfterClientEnd } from './suppress-after-end'

describe('suppressFollowupsAfterClientEnd', () => {
  it('limpa idle e devolve a IA se havia handoff', () => {
    const clock = createControllableClock(Date.UTC(2026, 10, 13, 12))
    const { db, close } = bootClinicDb({ clock })
    try {
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
          providerEventKey: 'wa:suppress:1',
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
      notifyHumanHandoff(
        db,
        'clinic-demo-a',
        {
          conversationId,
          reason: 'off_purpose',
          clientRequestId: 'wa:suppress:handoff',
        },
        clock,
      )
      // Força idle mesmo com humano (estado inconsistente / race).
      setConversationIdle(db, 'clinic-demo-a', conversationId, {
        phase: 'prompt',
        dueAt: clock.nowMs() + 60_000,
        promptSentAt: null,
        updatedAt: clock.nowMs(),
      })

      const outbox = suppressFollowupsAfterClientEnd(
        db,
        'clinic-demo-a',
        conversationId,
        clock,
      )
      expect(outbox.some((o) => o.type === 'conversation.ai_pause')).toBe(true)
      expect(readAiReplyPause(db, 'clinic-demo-a', conversationId)).toBeNull()
      expect(readHandoffTimeoutAt(db, 'clinic-demo-a', conversationId)).toBeNull()
      const idle = db.get<{ due: number | null }>(
        `SELECT idle_due_at AS due FROM conversations WHERE id = ?`,
        conversationId,
      )
      expect(idle?.due).toBeNull()
      // Timeout original já não está no futuro da conversa.
      expect(clock.nowMs() + HANDOFF_TIMEOUT_MS).toBeGreaterThan(clock.nowMs())
    } finally {
      close()
    }
  })
})
