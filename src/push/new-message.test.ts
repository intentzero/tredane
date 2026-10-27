import { describe, expect, it } from 'vitest'
import { bootAdminDb } from '../db/test-db'
import { createControllableClock } from '../db/clock'
import {
  assertSafePushPayload,
  buildNewConversationPayload,
  buildNewMessagePayload,
} from './send'
import { updatePushPreference, upsertPushSubscription } from './subscriptions'
import { notifyNewConversation } from './notify'
import { resolveVapidConfig } from './vapid'
import type { NewConversationPushPayload } from './types'

const clock = createControllableClock(1_700_000_000_000)

describe('push nova mensagem em conversa existente', () => {
  it('payload sem conteúdo, deep link e tag por conversa partilhada com nova conversa', () => {
    const input = { tenantId: 'clinic-demo-a', tenantName: 'Clínica Aurora', conversationId: 'cnv_1' }
    const msg = buildNewMessagePayload(input)
    const conv = buildNewConversationPayload(input)
    expect(msg.kind).toBe('new_message')
    expect(msg.title).toBe('Nova mensagem')
    expect(msg.body).toBe('Nova mensagem na Clínica Aurora')
    expect(msg.url).toBe('/c/clinic-demo-a/conversas/cnv_1')
    expect(msg.tag).toBe('conversation:clinic-demo-a:cnv_1')
    expect(conv.tag).toBe(msg.tag)
    assertSafePushPayload(msg)
    expect(() => assertSafePushPayload({ ...msg, body: 'Olá, quero marcar' })).toThrow(
      /unexpected/,
    )
  })

  it('envia new_message e respeita a preferência da inscrição', async () => {
    const { db, close } = bootAdminDb({ seed: true })
    try {
      upsertPushSubscription(db, clock, {
        tenantId: 'clinic-demo-a',
        clerkUserId: 'user_synth_owner_a',
        subscription: { endpoint: 'https://push.example/a', keys: { p256dh: 'p', auth: 'a' } },
      })
      const sent: NewConversationPushPayload[] = []
      const transport = {
        async send(_s: unknown, payload: NewConversationPushPayload) {
          sent.push(payload)
          return { ok: true as const, status: 201 }
        },
      }
      const deps = { db, clock, vapid: resolveVapidConfig({ PUSH_MODE: 'synthetic' }), transport }
      const r = await notifyNewConversation(deps, {
        tenantId: 'clinic-demo-a',
        conversationId: 'cnv_x',
        kind: 'new_message',
      })
      expect(r.sent).toBe(1)
      expect(sent[0]?.kind).toBe('new_message')

      updatePushPreference(db, clock, {
        tenantId: 'clinic-demo-a',
        clerkUserId: 'user_synth_owner_a',
        notifyNewConversation: false,
      })
      const r2 = await notifyNewConversation(deps, {
        tenantId: 'clinic-demo-a',
        conversationId: 'cnv_x',
        kind: 'new_message',
      })
      expect(r2.attempted).toBe(0)
      expect(sent).toHaveLength(1)
    } finally {
      close()
    }
  })
})
