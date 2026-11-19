/**
 * Regressão: humano no cartão → IA não envia à cliente até Devolver à IA (staging Paulo 17/11).
 */
import { describe, expect, it } from 'vitest'
import type { AiGenerateResult } from '../../ai'
import { createControllableClock } from '../../db/clock'
import { AI_ACTOR_ID, AI_ACTOR_NAME } from '../ai-actor'
import {
  enqueueAutoDraft,
  runDueAutoDrafts,
} from '../ai/autodraft'
import {
  pauseAiForStaffTakeover,
  readAiReplyPause,
  resumeAiReply,
} from '../ai/human-handoff'
import { suppressFollowupsAfterClientEnd } from '../followup/suppress-after-end'
import { setClinicAiAssistEnabled } from '../config/settings'
import { workerCaller } from '../index'
import { ingestContactMessage } from '../operations'
import { assignConversationOp, sendOutboundMessageOp } from './operations'
import { bootClinicDb } from '../test-db'
import { syncWhatsappChannel } from '../whatsapp/channel'
import { seedSyntheticWhatsappTemplates } from './templates'
import { ensureOpenOpportunity } from '../pipeline/operations'

function seedConversation() {
  const clock = createControllableClock(Date.UTC(2026, 10, 17, 13, 0))
  const boot = bootClinicDb({ clock })
  const { db } = boot
  const tenantId = 'clinic-demo-a'
  syncWhatsappChannel(
    db,
    tenantId,
    {
      status: 'connected',
      bindingId: 'bind_staff',
      phoneNumberId: 'pn_staff',
      wabaId: 'waba_staff',
      displayPhone: '+5511999999999',
      action: 'channel_connected',
    },
    clock,
  )
  seedSyntheticWhatsappTemplates(db, tenantId, clock)
  setClinicAiAssistEnabled(db, tenantId, true, clock)
  const caller = workerCaller(tenantId, 'user_synth_owner_a')
  const ingested = ingestContactMessage(
    db,
    caller,
    {
      providerEventKey: `wa:staff-takeover:${clock.nowMs()}`,
      waId: '5511987665544',
      body: 'oi',
    },
    clock,
  )
  const conversationId = ingested.conversation!.id
  ensureOpenOpportunity(
    db,
    {
      tenantId,
      contactId: ingested.contact!.id,
      conversationId,
    },
    clock,
  )
  let modelCalls = 0
  const adapter = {
    providerId: 'test',
    mode: 'synthetic' as const,
    async generate(): Promise<AiGenerateResult> {
      modelCalls += 1
      return {
        ok: true as const,
        text: 'Olá! Sou a assistente da clínica.',
        provider: 'test',
        model: 'test',
        latencyMs: 1,
        inputTokens: 1,
        outputTokens: 1,
      }
    },
    lastInspection() {
      return null
    },
  }
  return {
    db,
    clock,
    caller,
    tenantId,
    conversationId,
    adapter,
    modelCalls: () => modelCalls,
    close: boot.close,
  }
}

describe('staff takeover — IA não responde à cliente', () => {
  it('após Assumir, inbound não gera outbound da IA', async () => {
    const s = seedConversation()
    try {
      const handoffCaller = workerCaller(s.tenantId, 'user_synth_owner_a')
      assignConversationOp(
        s.db,
        handoffCaller,
        {
          conversationId: s.conversationId,
          assigneeClerkUserId: 'user_synth_owner_a',
          assigneeDisplayName: 'Paulo',
          actorClerkUserId: 'user_synth_owner_a',
          actorDisplayName: 'Paulo',
        },
        s.clock,
      )
      expect(readAiReplyPause(s.db, s.tenantId, s.conversationId)?.reason).toBe('staff_active')

      const inbound = ingestContactMessage(
        s.db,
        workerCaller(s.tenantId, AI_ACTOR_ID),
        {
          providerEventKey: `wa:staff-in:${s.clock.nowMs()}`,
          waId: '5511987665544',
          body: 'tem horário?',
        },
        s.clock,
      )
      const job = enqueueAutoDraft(
        s.db,
        s.tenantId,
        { conversationId: s.conversationId, messageId: inbound.message!.id },
        s.clock,
      )
      expect(job).toBeNull()
      s.clock.advance(8_000)
      const outcomes = await runDueAutoDrafts(s.db, s.caller, s.clock, {
        mode: 'synthetic',
        adapter: s.adapter,
      })
      expect(outcomes).toHaveLength(0)
      expect(s.modelCalls()).toBe(0)
      const aiOutbound = s.db.get<{ n: number }>(
        `SELECT COUNT(*) AS n FROM messages
         WHERE tenant_id = ? AND conversation_id = ? AND direction = 'outbound'
           AND author_clerk_user_id = ?`,
        s.tenantId,
        s.conversationId,
        AI_ACTOR_ID,
      )?.n
      expect(aiOutbound).toBe(0)
    } finally {
      s.close()
    }
  })

  it('Terminar após Assumir não devolve à IA nem despausa', () => {
    const s = seedConversation()
    try {
      assignConversationOp(
        s.db,
        s.caller,
        {
          conversationId: s.conversationId,
          assigneeClerkUserId: 'user_synth_owner_a',
          assigneeDisplayName: 'Paulo',
          actorClerkUserId: 'user_synth_owner_a',
          actorDisplayName: 'Paulo',
        },
        s.clock,
      )
      suppressFollowupsAfterClientEnd(s.db, s.tenantId, s.conversationId, s.clock)
      expect(readAiReplyPause(s.db, s.tenantId, s.conversationId)?.reason).toBe('staff_active')
      expect(
        s.db.get<{ a: string | null }>(
          `SELECT assignee_clerk_user_id AS a FROM conversations WHERE id = ?`,
          s.conversationId,
        )?.a,
      ).toBe('user_synth_owner_a')
    } finally {
      s.close()
    }
  })

  it('envio manual mantém humano responsável e pausa staff_active', () => {
    const s = seedConversation()
    try {
      assignConversationOp(
        s.db,
        s.caller,
        {
          conversationId: s.conversationId,
          assigneeClerkUserId: 'user_synth_owner_a',
          assigneeDisplayName: 'Paulo',
          actorClerkUserId: 'user_synth_owner_a',
          actorDisplayName: 'Paulo',
        },
        s.clock,
      )
      sendOutboundMessageOp(
        s.db,
        s.caller,
        {
          conversationId: s.conversationId,
          body: 'Agora sou eu',
          clientRequestId: 'client:manual-1',
          authorClerkUserId: 'user_synth_owner_a',
          authorDisplayName: 'Paulo',
        },
        s.clock,
      )
      expect(
        s.db.get<{ a: string | null }>(
          `SELECT assignee_clerk_user_id AS a FROM conversations WHERE id = ?`,
          s.conversationId,
        )?.a,
      ).toBe('user_synth_owner_a')
      expect(readAiReplyPause(s.db, s.tenantId, s.conversationId)?.reason).toBe('staff_active')
    } finally {
      s.close()
    }
  })

  it('Devolver à IA (resumeAiReply) restaura responsável IA', () => {
    const s = seedConversation()
    try {
      pauseAiForStaffTakeover(s.db, s.tenantId, s.conversationId, s.clock)
      assignConversationOp(
        s.db,
        s.caller,
        {
          conversationId: s.conversationId,
          assigneeClerkUserId: 'user_synth_owner_a',
          assigneeDisplayName: 'Paulo',
          actorClerkUserId: 'user_synth_owner_a',
          actorDisplayName: 'Paulo',
        },
        s.clock,
      )
      resumeAiReply(s.db, s.tenantId, s.conversationId, s.clock, {
        source: 'manual_resume',
      })
      expect(readAiReplyPause(s.db, s.tenantId, s.conversationId)).toBeNull()
      expect(
        s.db.get<{ a: string | null; d: string | null }>(
          `SELECT assignee_clerk_user_id AS a, assignee_display_name AS d FROM conversations WHERE id = ?`,
          s.conversationId,
        ),
      ).toMatchObject({ a: AI_ACTOR_ID, d: AI_ACTOR_NAME })
    } finally {
      s.close()
    }
  })

  it('atribuição repetida ao mesmo responsável não duplica evento de sistema', () => {
    const s = seedConversation()
    try {
      const first = assignConversationOp(
        s.db,
        s.caller,
        {
          conversationId: s.conversationId,
          assigneeClerkUserId: 'user_synth_owner_a',
          assigneeDisplayName: 'Paulo',
          actorClerkUserId: 'user_synth_owner_a',
          actorDisplayName: 'Paulo',
        },
        s.clock,
      )
      expect(first.value.systemMessage?.body).toBe('Paulo assumiu a conversa')
      const second = assignConversationOp(
        s.db,
        s.caller,
        {
          conversationId: s.conversationId,
          assigneeClerkUserId: 'user_synth_owner_a',
          assigneeDisplayName: 'Paulo',
          actorClerkUserId: 'user_synth_owner_a',
          actorDisplayName: 'Paulo',
        },
        s.clock,
      )
      expect(second.value.systemMessage).toBeNull()
      const n = s.db.get<{ n: number }>(
        `SELECT COUNT(*) AS n FROM messages WHERE conversation_id = ? AND direction = 'system'`,
        s.conversationId,
      )?.n
      expect(n).toBe(1)
    } finally {
      s.close()
    }
  })

  it('transferência usa nome real ou IA, não rótulo Responsável', () => {
    const s = seedConversation()
    try {
      assignConversationOp(
        s.db,
        workerCaller(s.tenantId, AI_ACTOR_ID),
        {
          conversationId: s.conversationId,
          assigneeClerkUserId: AI_ACTOR_ID,
          assigneeDisplayName: AI_ACTOR_NAME,
          actorClerkUserId: AI_ACTOR_ID,
          actorDisplayName: AI_ACTOR_NAME,
        },
        s.clock,
      )
      const tr = assignConversationOp(
        s.db,
        s.caller,
        {
          conversationId: s.conversationId,
          assigneeClerkUserId: 'user_synth_owner_a',
          assigneeDisplayName: 'Paulo',
          actorClerkUserId: 'user_synth_owner_a',
          actorDisplayName: 'Paulo',
        },
        s.clock,
      )
      expect(tr.value.systemMessage?.body).toBe('Paulo transferiu para Paulo')
      expect(tr.value.systemMessage?.body).not.toMatch(/Responsável transferiu/)
    } finally {
      s.close()
    }
  })

  it('lista: Assumir / transferir não substitui a prévia pela frase do evento', () => {
    const s = seedConversation()
    try {
      const before = s.db.get<{
        preview: string | null
        direction: string | null
      }>(
        `SELECT last_message_preview AS preview, last_message_direction AS direction
         FROM conversations WHERE id = ?`,
        s.conversationId,
      )
      expect(before?.preview).toBe('oi')
      expect(before?.direction).toBe('inbound')

      assignConversationOp(
        s.db,
        s.caller,
        {
          conversationId: s.conversationId,
          assigneeClerkUserId: 'user_synth_owner_a',
          assigneeDisplayName: 'Paulo',
          actorClerkUserId: 'user_synth_owner_a',
          actorDisplayName: 'Paulo',
        },
        s.clock,
      )
      const afterAssume = s.db.get<{
        preview: string | null
        direction: string | null
        unread: number
      }>(
        `SELECT last_message_preview AS preview, last_message_direction AS direction,
                unread_count AS unread
         FROM conversations WHERE id = ?`,
        s.conversationId,
      )
      expect(afterAssume?.preview).toBe('oi')
      expect(afterAssume?.direction).toBe('inbound')
      expect(afterAssume?.unread).toBe(0)

      assignConversationOp(
        s.db,
        workerCaller(s.tenantId, 'user_synth_owner_b'),
        {
          conversationId: s.conversationId,
          assigneeClerkUserId: 'user_synth_owner_b',
          assigneeDisplayName: 'Ana',
          actorClerkUserId: 'user_synth_owner_a',
          actorDisplayName: 'Paulo',
        },
        s.clock,
      )
      const afterTransfer = s.db.get<{
        preview: string | null
        direction: string | null
      }>(
        `SELECT last_message_preview AS preview, last_message_direction AS direction
         FROM conversations WHERE id = ?`,
        s.conversationId,
      )
      expect(afterTransfer?.preview).toBe('oi')
      expect(afterTransfer?.direction).toBe('inbound')
      expect(afterTransfer?.preview).not.toMatch(/transferiu/)
    } finally {
      s.close()
    }
  })
})