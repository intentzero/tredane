import { describe, expect, it } from 'vitest'
import { createApp } from '../worker/app'
import { bootAdminDb } from '../db/test-db'
import { asyncFromSync } from '../db/admin/async-store'
import {
  createSyntheticAuthorityReader,
  createSyntheticSessionAuthenticator,
  type AuthServices,
} from '../auth'
import { bootClinicDb } from '../clinic/test-db'
import { createWhatsappService } from './service'
import { createMemoryWhatsappChannelSync } from './routes'
import { SYNTHETIC_CODES } from './meta'
import {
  computeHubSignature256,
  SYNTHETIC_APP_SECRET,
  SYNTHETIC_VERIFY_TOKEN,
} from './webhook-verify'
import type { WhatsappWebhookQueueMessage } from './queue-types'

function testApp() {
  const admin = bootAdminDb()
  const clinics = new Map<string, ReturnType<typeof bootClinicDb>>()
  const getClinic = (tenantId: string) => {
    let boot = clinics.get(tenantId)
    if (!boot) {
      boot = bootClinicDb()
      clinics.set(tenantId, boot)
    }
    return { db: boot.db, clock: boot.clock }
  }
  const channelSync = createMemoryWhatsappChannelSync(getClinic)
  const services: AuthServices = {
    sessions: createSyntheticSessionAuthenticator({
      authorizedParties: ['http://localhost:5173'],
    }),
    authority: createSyntheticAuthorityReader(),
    adminDb: asyncFromSync(admin.db),
  }
  const queue: WhatsappWebhookQueueMessage[] = []
  const logs: string[] = []
  const app = createApp({
    authServicesFactory: () => services,
    syncAdminDbFactory: () => admin.db,
    whatsappServiceFactory: () =>
      createWhatsappService({
        db: admin.db,
        channelSync,
        metaEnv: { META_MODE: 'synthetic' },
      }),
    whatsappWebhook: {
      syncAdminDbFactory: () => admin.db,
      queueFactory: () => ({
        send: async (m) => {
          queue.push(m)
        },
      }),
      logFactory: () => (entry) => {
        logs.push(JSON.stringify({ event: entry.event, ...entry.detail }))
      },
    },
  })
  return {
    app,
    admin,
    queue,
    logs,
    channelSync,
    close: () => {
      for (const c of clinics.values()) c.close()
      admin.close()
    },
  }
}

describe('HTTP — webhooks WhatsApp (#32)', () => {
  it('GET challenge e POST assinado enfileiram; inválido 401; logs sem PII', async () => {
    const { app, queue, logs, close } = testApp()
    try {
      const challenge = await app.request(
        `http://localhost/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=${encodeURIComponent(SYNTHETIC_VERIFY_TOKEN)}&hub.challenge=abc123`,
      )
      expect(challenge.status).toBe(200)
      expect(await challenge.text()).toBe('abc123')

      const denied = await app.request(
        'http://localhost/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=abc123',
      )
      expect(denied.status).toBe(403)

      // Conectar número via API owner
      const { synthAuthHeader } = await import('../auth')
      const sessionRes = await app.request(
        'http://localhost/api/tenants/clinic-demo-a/whatsapp/session',
        {
          method: 'POST',
          headers: {
            Authorization: synthAuthHeader('user_synth_owner_a'),
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ purpose: 'connect' }),
        },
      )
      const session = (await sessionRes.json()) as { state: string }
      await app.request('http://localhost/api/tenants/clinic-demo-a/whatsapp/complete', {
        method: 'POST',
        headers: {
          Authorization: synthAuthHeader('user_synth_owner_a'),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          state: session.state,
          code: SYNTHETIC_CODES.valid,
          phoneNumberId: 'pnid_http_wh',
          wabaId: 'waba_http_wh',
          displayPhone: '+5511988776655',
        }),
      })

      const body = JSON.stringify({
        object: 'whatsapp_business_account',
        entry: [
          {
            id: 'waba',
            changes: [
              {
                field: 'messages',
                value: {
                  metadata: { phone_number_id: 'pnid_http_wh' },
                  contacts: [
                    { wa_id: '5511912345678', profile: { name: 'Ana Synth' } },
                  ],
                  messages: [
                    {
                      from: '5511912345678',
                      id: 'wamid.HTTP1',
                      timestamp: '1700000400',
                      type: 'text',
                      text: { body: 'Quero agendar laser' },
                    },
                  ],
                },
              },
            ],
          },
        ],
      })

      const unsigned = await app.request('http://localhost/api/webhooks/whatsapp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      })
      expect(unsigned.status).toBe(401)

      const sig = await computeHubSignature256(body, SYNTHETIC_APP_SECRET)
      const ok = await app.request('http://localhost/api/webhooks/whatsapp', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Hub-Signature-256': sig,
        },
        body,
      })
      expect(ok.status).toBe(200)
      const json = (await ok.json()) as { enqueued: number }
      expect(json.enqueued).toBe(1)
      expect(queue).toHaveLength(1)
      expect(queue[0]?.tenantId).toBe('clinic-demo-a')
      expect(queue[0]?.providerEventKey).toBe('wa:msg:wamid.HTTP1')

      const dump = logs.join('\n')
      expect(dump).not.toContain('Quero agendar laser')
      expect(dump).not.toContain('5511912345678')
    } finally {
      close()
    }
  })
})
