import { describe, expect, it, vi } from 'vitest'
import { bootAdminDb } from '../db/test-db'
import { createControllableClock } from '../db/clock'
import { upsertPushSubscription } from './subscriptions'
import { notifyNewConversation } from './notify'
import { resolveVapidConfig } from './vapid'
import type { NewConversationPushPayload } from './types'
import { applyAppBadge } from '../client/panel/badge'

const clock = createControllableClock(1_700_000_000_000)

describe('push: badge e supressão com app aberta', () => {
  it('não envia a quem tem a app aberta e inclui badgeCount', async () => {
    const { db, close } = bootAdminDb({ seed: true })
    try {
      for (const [u, e] of [
        ['user_synth_owner_a', 'https://push.example/owner'],
        ['user_synth_attendant_a', 'https://push.example/att'],
      ]) {
        upsertPushSubscription(db, clock, {
          tenantId: 'clinic-demo-a',
          clerkUserId: u!,
          subscription: { endpoint: e!, keys: { p256dh: 'p', auth: 'a' } },
        })
      }
      const sent: Array<{ endpoint: string; payload: NewConversationPushPayload }> = []
      const transport = {
        async send(s: { endpoint: string }, payload: NewConversationPushPayload) {
          sent.push({ endpoint: s.endpoint, payload })
          return { ok: true as const, status: 201 }
        },
      }
      const r = await notifyNewConversation(
        { db, clock, vapid: resolveVapidConfig({ PUSH_MODE: 'synthetic' }), transport },
        {
          tenantId: 'clinic-demo-a',
          conversationId: 'cnv_1',
          kind: 'new_message',
          badgeCount: 3,
          suppressUserIds: ['user_synth_owner_a'],
        },
      )
      expect(r.sent).toBe(1)
      expect(sent.map((s) => s.endpoint)).toEqual(['https://push.example/att'])
      expect(sent[0]!.payload.badgeCount).toBe(3)
      expect(JSON.stringify(sent[0]!.payload)).not.toMatch(/waId|bodyPreview/)
    } finally {
      close()
    }
  })

  it('applyAppBadge define e limpa com feature-detect', () => {
    const nav = {
      setAppBadge: vi.fn(() => Promise.resolve()),
      clearAppBadge: vi.fn(() => Promise.resolve()),
    }
    applyAppBadge(2, nav)
    applyAppBadge(0, nav)
    expect(nav.setAppBadge).toHaveBeenCalledWith(2)
    expect(nav.clearAppBadge).toHaveBeenCalledTimes(1)
    expect(() => applyAppBadge(1, {})).not.toThrow()
  })
})
