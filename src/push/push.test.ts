import { describe, expect, it } from 'vitest'
import { bootAdminDb } from '../db/test-db'
import { createControllableClock } from '../db/clock'
import {
  assertSafePushPayload,
  buildNewConversationPayload,
} from './send'
import {
  deletePushSubscriptionsForMember,
  listNewConversationSubscriptions,
  upsertPushSubscription,
} from './subscriptions'
import { createSimulatedPushTransport } from './synthetic'
import { notifyNewConversation } from './notify'
import { SYNTHETIC_VAPID_PUBLIC_KEY, resolveVapidConfig } from './vapid'

const clock = createControllableClock(1_700_000_000_000)

describe('push / PWA (#42)', () => {
  it('buildNewConversationPayload nunca inclui corpo de mensagem', () => {
    const payload = buildNewConversationPayload({
      tenantId: 'clinic-demo-a',
      tenantName: 'Clínica Aurora',
      conversationId: 'cnv_1',
    })
    expect(payload.body).toBe('Nova conversa na Clínica Aurora')
    expect(payload.title).toBe('Nova conversa')
    expect(payload.url).toContain('/c/clinic-demo-a/conversas/cnv_1')
    expect(JSON.stringify(payload)).not.toMatch(/waId|bodyPreview|5511/)
    assertSafePushPayload(payload)
  })

  it('assertSafePushPayload rejeita campos sensíveis', () => {
    expect(() =>
      assertSafePushPayload({
        kind: 'new_conversation',
        title: 'x',
        body: 'Nova conversa na A',
        tag: 't',
        url: '/c/a/conversas/1',
        tenantId: 'a',
        conversationId: '1',
        // @ts-expect-error intentional
        waId: '5511999',
      }),
    ).toThrow(/sensitive/)
  })

  it('inscreve, notifica só membership ativa e remove gone', async () => {
    const { db, close } = bootAdminDb({ seed: true })
    try {
      const subA = upsertPushSubscription(db, clock, {
        tenantId: 'clinic-demo-a',
        clerkUserId: 'user_synth_owner_a',
        subscription: {
          endpoint: 'https://push.example/a',
          keys: { p256dh: 'p256', auth: 'auth' },
        },
      })
      expect(subA.notifyNewConversation).toBe(true)

      // utilizador sem membership neste tenant — se inscrito por engano, é cortado
      upsertPushSubscription(db, clock, {
        tenantId: 'clinic-demo-a',
        clerkUserId: 'user_synth_outsider',
        subscription: {
          endpoint: 'https://push.example/outsider',
          keys: { p256dh: 'p256', auth: 'auth' },
        },
      })

      const gone = createSimulatedPushTransport({
        clock,
        goneEndpoints: ['https://push.example/gone'],
      })
      upsertPushSubscription(db, clock, {
        tenantId: 'clinic-demo-a',
        clerkUserId: 'user_synth_attendant_a',
        subscription: {
          endpoint: 'https://push.example/gone',
          keys: { p256dh: 'p256', auth: 'auth' },
        },
      })

      const live = createSimulatedPushTransport({ clock })
      // transporte composto: first try gone set then live mailbox
      const transport = {
        async send(
          sub: { endpoint: string; keys: { p256dh: string; auth: string } },
          payload: Parameters<typeof live.send>[1],
        ) {
          if (sub.endpoint.includes('gone')) return gone.send(sub, payload)
          return live.send(sub, payload)
        },
      }

      const result = await notifyNewConversation(
        {
          db,
          clock,
          vapid: resolveVapidConfig({ PUSH_MODE: 'synthetic' }),
          transport,
        },
        {
          tenantId: 'clinic-demo-a',
          conversationId: 'cnv_new_1',
          tenantName: 'Clínica Aurora',
        },
      )

      expect(result.skippedUnauthorized).toBeGreaterThanOrEqual(1)
      expect(result.removedGone).toBe(1)
      expect(result.sent).toBeGreaterThanOrEqual(1)
      expect(live.mailbox.every((m) => m.payload.body.startsWith('Nova conversa na '))).toBe(
        true,
      )
      expect(live.mailbox.every((m) => !JSON.stringify(m.payload).includes('bodyPreview'))).toBe(
        true,
      )

      const remaining = listNewConversationSubscriptions(db, 'clinic-demo-a')
      expect(remaining.every((s) => s.endpoint !== 'https://push.example/gone')).toBe(true)
      expect(remaining.every((s) => s.clerkUserId !== 'user_synth_outsider')).toBe(true)
    } finally {
      close()
    }
  })

  it('revoke remove assinaturas do par user×tenant', () => {
    const { db, close } = bootAdminDb({ seed: true })
    try {
      upsertPushSubscription(db, clock, {
        tenantId: 'clinic-demo-a',
        clerkUserId: 'user_synth_attendant_a',
        subscription: {
          endpoint: 'https://push.example/a1',
          keys: { p256dh: 'p', auth: 'a' },
        },
      })
      upsertPushSubscription(db, clock, {
        tenantId: 'clinic-demo-b',
        clerkUserId: 'user_synth_multi',
        subscription: {
          endpoint: 'https://push.example/b1',
          keys: { p256dh: 'p', auth: 'a' },
        },
      })
      // também em A para o multi — revoke só corta A
      upsertPushSubscription(db, clock, {
        tenantId: 'clinic-demo-a',
        clerkUserId: 'user_synth_multi',
        subscription: {
          endpoint: 'https://push.example/a-multi',
          keys: { p256dh: 'p', auth: 'a' },
        },
      })
      const n = deletePushSubscriptionsForMember(
        db,
        'clinic-demo-a',
        'user_synth_attendant_a',
      )
      expect(n).toBe(1)
      const nMulti = deletePushSubscriptionsForMember(
        db,
        'clinic-demo-a',
        'user_synth_multi',
      )
      expect(nMulti).toBe(1)
      expect(listNewConversationSubscriptions(db, 'clinic-demo-a')).toHaveLength(0)
      expect(listNewConversationSubscriptions(db, 'clinic-demo-b')).toHaveLength(1)
    } finally {
      close()
    }
  })

  it('resolveVapidConfig synthetic devolve chave pública estável', () => {
    const cfg = resolveVapidConfig({ PUSH_MODE: 'synthetic' })
    expect(cfg.mode).toBe('synthetic')
    expect(cfg.publicKey).toBe(SYNTHETIC_VAPID_PUBLIC_KEY)
  })
})
