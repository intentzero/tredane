import { describe, expect, it } from 'vitest'
import { bootAdminDb } from '../db/test-db'
import { createControllableClock } from '../db/clock'
import {
  assertSafePushPayload,
  buildNeedsPersonPayload,
  buildNewConversationPayload,
  buildNewMessagePayload,
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
      contactLabel: 'Ana Silva',
    })
    expect(payload.body).toBe('Ana Silva · Clínica Aurora')
    expect(payload.title).toBe('Nova conversa')
    expect(payload.url).toContain('/c/clinic-demo-a/conversas/cnv_1')
    expect(JSON.stringify(payload)).not.toMatch(/waId|bodyPreview|5511/)
    assertSafePushPayload(payload)
    const fallback = buildNewConversationPayload({
      tenantId: 'clinic-demo-a',
      tenantName: 'Clínica Aurora',
      conversationId: 'cnv_1',
    })
    expect(fallback.body).toBe('Cliente · Clínica Aurora')
    assertSafePushPayload(fallback)
  })

  it('clinicLabel com « · » no nome não parte o corpo tipado', () => {
    const payload = buildNeedsPersonPayload({
      tenantId: 'clinic-demo-a',
      tenantName: 'Clínica · Aurora · Sul',
      conversationId: 'cnv_dot',
      contactLabel: 'Lia · Silva',
      handoffReason: 'off_purpose',
    })
    expect(payload.body).toBe('Lia Silva · Clínica Aurora Sul · fora do assunto')
    assertSafePushPayload(payload)
    const msg = buildNewMessagePayload({
      tenantId: 'clinic-demo-a',
      tenantName: 'A · B',
      conversationId: 'cnv_dot',
      contactLabel: 'Ana',
    })
    expect(msg.body).toBe('Mensagem de Ana · A B')
    assertSafePushPayload(msg)
  })

  it('buildNeedsPersonPayload (DEC-156) sem PII e com escalate', () => {
    const base = buildNeedsPersonPayload({
      tenantId: 'clinic-demo-a',
      tenantName: 'Clínica Aurora',
      conversationId: 'cnv_9',
      contactLabel: 'Lia',
      handoffReason: 'customer_requested',
    })
    expect(base.kind).toBe('needs_person')
    expect(base.body).toBe('Lia · Clínica Aurora · pediu a equipe')
    assertSafePushPayload(base)
    const noReason = buildNeedsPersonPayload({
      tenantId: 'clinic-demo-a',
      tenantName: 'Clínica Aurora',
      conversationId: 'cnv_9',
    })
    expect(noReason.body).toBe('Cliente · Clínica Aurora')
    assertSafePushPayload(noReason)
    const esc = buildNeedsPersonPayload({
      tenantId: 'clinic-demo-a',
      tenantName: 'Clínica Aurora',
      conversationId: 'cnv_9',
      contactLabel: 'Lia',
      escalate: true,
    })
    expect(esc.kind).toBe('needs_person_escalate')
    expect(esc.body).toBe('Lia · Clínica Aurora · há 5 min')
    assertSafePushPayload(esc)
  })

  it('assertSafePushPayload rejeita campos sensíveis', () => {
    expect(() =>
      assertSafePushPayload({
        kind: 'new_conversation',
        title: 'x',
        body: 'Cliente · A',
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
      expect(live.mailbox.every((m) => m.payload.body.endsWith(' · Clínica Aurora'))).toBe(
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
