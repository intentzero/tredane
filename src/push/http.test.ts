import { describe, expect, it } from 'vitest'
import { createApp } from '../worker/app'
import { bootAdminDb } from '../db/test-db'
import { asyncFromSync } from '../db/admin/async-store'
import { createControllableClock } from '../db/clock'
import {
  createSyntheticAuthorityReader,
  createSyntheticSessionAuthenticator,
  createSyntheticVerifiedEmailReader,
  synthAuthHeader,
  type AuthServices,
} from '../auth'
import { upsertPushSubscription } from './subscriptions'
import { createSimulatedPushTransport } from './synthetic'
import { SYNTHETIC_VAPID_PUBLIC_KEY } from './vapid'

const clock = createControllableClock(1_700_000_000_100)

function testPushApp() {
  const boot = bootAdminDb()
  const services: AuthServices = {
    sessions: createSyntheticSessionAuthenticator({
      authorizedParties: ['http://localhost:5173'],
    }),
    authority: createSyntheticAuthorityReader(),
    adminDb: asyncFromSync(boot.db),
    verifiedEmails: createSyntheticVerifiedEmailReader(),
  }
  const app = createApp({
    authServicesFactory: () => services,
    syncAdminDbFactory: () => boot.db,
    clockFactory: () => clock,
    push: {
      syncAdminDbFactory: () => boot.db,
      clockFactory: () => clock,
    },
  })
  const env = {
    ENVIRONMENT: 'development',
    AUTH_MODE: 'synthetic',
    PUSH_MODE: 'synthetic',
  } as never
  return {
    app,
    boot,
    env,
    close: boot.close,
    auth: (userId: string, init: RequestInit = {}) => {
      const headers = new Headers(init.headers)
      headers.set('Authorization', synthAuthHeader(userId))
      headers.set('Origin', 'http://localhost:5173')
      return { ...init, headers }
    },
  }
}

describe('push HTTP (#42)', () => {
  it('vapid público autenticado; subscribe e harness notify sem PII', async () => {
    const ctx = testPushApp()
    try {
      const unauth = await ctx.app.request(
        'http://localhost/api/push/vapid-public-key',
        {},
        ctx.env,
      )
      expect([401, 403]).toContain(unauth.status)

      const vapid = await ctx.app.request(
        'http://localhost/api/push/vapid-public-key',
        ctx.auth('user_synth_owner_a'),
        ctx.env,
      )
      expect(vapid.status).toBe(200)
      const vapidBody = (await vapid.json()) as {
        publicKey: string
        mode: string
        supported: boolean
      }
      expect(vapidBody.supported).toBe(true)
      expect(vapidBody.publicKey).toBe(SYNTHETIC_VAPID_PUBLIC_KEY)
      expect(vapidBody.mode).toBe('synthetic')

      const subRes = await ctx.app.request(
        'http://localhost/api/tenants/clinic-demo-a/push/subscriptions',
        ctx.auth('user_synth_owner_a', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            subscription: {
              endpoint: 'https://push.example/http-a',
              keys: { p256dh: 'AA', auth: 'BB' },
            },
            notifyNewConversation: true,
          }),
        }),
        ctx.env,
      )
      expect(subRes.status).toBe(201)

      const cross = await ctx.app.request(
        'http://localhost/api/tenants/clinic-demo-b/push/subscriptions',
        ctx.auth('user_synth_attendant_a', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            subscription: {
              endpoint: 'https://push.example/cross',
              keys: { p256dh: 'AA', auth: 'BB' },
            },
          }),
        }),
        ctx.env,
      )
      expect([403, 404]).toContain(cross.status)

      const notify = await ctx.app.request(
        'http://localhost/api/f5/push/notify-new-conversation',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tenantId: 'clinic-demo-a',
            conversationId: 'cnv_http_1',
            tenantName: 'Clínica Aurora',
          }),
        },
        ctx.env,
      )
      expect(notify.status).toBe(200)
      const body = (await notify.json()) as {
        sent: number
        records: Array<{ payloadBody: string; payloadUrl: string }>
      }
      expect(body.sent).toBeGreaterThanOrEqual(1)
      expect(body.records[0]!.payloadBody).toBe('Nova conversa na Clínica Aurora')
      expect(body.records[0]!.payloadUrl).toContain('/conversas/cnv_http_1')
      expect(JSON.stringify(body)).not.toMatch(/bodyPreview|waId/)
    } finally {
      ctx.close()
    }
  })

  it('preferência desligada não notifica; delete remove endpoint', async () => {
    const ctx = testPushApp()
    try {
      upsertPushSubscription(ctx.boot.db, clock, {
        tenantId: 'clinic-demo-a',
        clerkUserId: 'user_synth_owner_a',
        subscription: {
          endpoint: 'https://push.example/off',
          keys: { p256dh: 'x', auth: 'y' },
        },
        notifyNewConversation: false,
      })
      const notify = await ctx.app.request(
        'http://localhost/api/f5/push/notify-new-conversation',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tenantId: 'clinic-demo-a',
            conversationId: 'cnv_off',
          }),
        },
        ctx.env,
      )
      expect(notify.status).toBe(200)
      const body = (await notify.json()) as { sent: number; attempted: number }
      expect(body.attempted).toBe(0)
      expect(body.sent).toBe(0)

      const del = await ctx.app.request(
        'http://localhost/api/tenants/clinic-demo-a/push/subscriptions',
        ctx.auth('user_synth_owner_a', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint: 'https://push.example/off' }),
        }),
        ctx.env,
      )
      expect(del.status).toBe(200)
      expect(((await del.json()) as { removed: boolean }).removed).toBe(true)
    } finally {
      ctx.close()
    }
  })

  it('simulated transport regista envio (mailbox)', async () => {
    const transport = createSimulatedPushTransport({ clock })
    const r = await transport.send(
      { endpoint: 'https://push.example/x', keys: { p256dh: 'a', auth: 'b' } },
      {
        kind: 'new_conversation',
        title: 'Nova conversa',
        body: 'Nova conversa na X',
        tag: 't',
        url: '/c/x/conversas/1',
        tenantId: 'x',
        conversationId: '1',
      },
    )
    expect(r.ok).toBe(true)
    expect(transport.mailbox).toHaveLength(1)
  })
})
