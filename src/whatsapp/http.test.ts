import { describe, expect, it } from 'vitest'
import { createApp } from '../worker/app'
import { bootAdminDb } from '../db/test-db'
import { asyncFromSync } from '../db/admin/async-store'
import {
  createSyntheticAuthorityReader,
  createSyntheticSessionAuthenticator,
  synthAuthHeader,
  type AuthServices,
} from '../auth'
import { clinicWhatsapp } from '../clinic'
import { bootClinicDb } from '../clinic/test-db'
import { createWhatsappService } from './service'
import { createMemoryWhatsappChannelSync } from './routes'
import { SYNTHETIC_CODES } from './meta'

function testWhatsappApp() {
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
  const app = createApp({
    authServicesFactory: () => services,
    syncAdminDbFactory: () => admin.db,
    whatsappClinicDbFactory: getClinic,
    whatsappServiceFactory: () =>
      createWhatsappService({
        db: admin.db,
        channelSync,
        metaEnv: { META_MODE: 'synthetic' },
      }),
  })
  return {
    app,
    getClinic,
    close: () => {
      for (const c of clinics.values()) c.close()
      admin.close()
    },
    auth: (userId: string, init: RequestInit = {}) => {
      const headers = new Headers(init.headers)
      headers.set('Authorization', synthAuthHeader(userId))
      return { ...init, headers }
    },
  }
}

describe('HTTP — WhatsApp conexão (#31)', () => {
  it('attendant lê estado mas não conecta; owner conecta sem vazar tokens', async () => {
    const { app, close, auth } = testWhatsappApp()
    try {
      const readAtt = await app.request(
        'http://localhost/api/tenants/clinic-demo-a/whatsapp',
        auth('user_synth_attendant_a'),
      )
      expect(readAtt.status).toBe(200)
      const attBody = (await readAtt.json()) as { status: string }
      expect(attBody.status).toBe('disconnected')

      const denied = await app.request(
        'http://localhost/api/tenants/clinic-demo-a/whatsapp/session',
        auth('user_synth_attendant_a', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ purpose: 'connect' }),
        }),
      )
      expect(denied.status).toBe(403)

      const sessionRes = await app.request(
        'http://localhost/api/tenants/clinic-demo-a/whatsapp/session',
        auth('user_synth_owner_a', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ purpose: 'connect' }),
        }),
      )
      expect(sessionRes.status).toBe(201)
      const session = (await sessionRes.json()) as { state: string; metaMode: string }
      expect(session.metaMode).toBe('synthetic')

      const complete = await app.request(
        'http://localhost/api/tenants/clinic-demo-a/whatsapp/complete',
        auth('user_synth_owner_a', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            state: session.state,
            code: SYNTHETIC_CODES.valid,
            phoneNumberId: 'pnid_http_a',
            wabaId: 'waba_http_a',
            displayPhone: '+5511988880001',
          }),
        }),
      )
      expect(complete.status).toBe(200)
      const connected = (await complete.json()) as Record<string, unknown>
      expect(connected.status).toBe('connected')
      expect(JSON.stringify(connected)).not.toMatch(/synth_token_|access_token|accessToken/)

      const cross = await app.request(
        'http://localhost/api/tenants/clinic-demo-b/whatsapp/session',
        auth('user_synth_owner_b', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ purpose: 'connect' }),
        }),
      )
      const sessionB = (await cross.json()) as { state: string }
      const clash = await app.request(
        'http://localhost/api/tenants/clinic-demo-b/whatsapp/complete',
        auth('user_synth_owner_b', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            state: sessionB.state,
            code: SYNTHETIC_CODES.valid,
            phoneNumberId: 'pnid_http_a',
            wabaId: 'waba_http_b',
            displayPhone: '+5511988880001',
          }),
        }),
      )
      expect(clash.status).toBe(409)
      const clashBody = (await clash.json()) as { error: string }
      expect(clashBody.error).toBe('phone_in_use')
    } finally {
      close()
    }
  })

  it('GET /whatsapp lê lastInboundAt do espelho da clínica (não null hardcodado)', async () => {
    const { app, getClinic, close, auth } = testWhatsappApp()
    try {
      const sessionRes = await app.request(
        'http://localhost/api/tenants/clinic-demo-a/whatsapp/session',
        auth('user_synth_owner_a', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ purpose: 'connect' }),
        }),
      )
      expect(sessionRes.status).toBe(201)
      const session = (await sessionRes.json()) as { state: string }

      const complete = await app.request(
        'http://localhost/api/tenants/clinic-demo-a/whatsapp/complete',
        auth('user_synth_owner_a', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            state: session.state,
            code: SYNTHETIC_CODES.valid,
            phoneNumberId: 'pnid_http_inbound',
            wabaId: 'waba_http_inbound',
            displayPhone: '+15551820342',
            displayName: 'Test Number',
          }),
        }),
      )
      expect(complete.status).toBe(200)

      const before = await app.request(
        'http://localhost/api/tenants/clinic-demo-a/whatsapp',
        auth('user_synth_owner_a'),
      )
      expect(before.status).toBe(200)
      const beforeBody = (await before.json()) as { lastInboundAt: number | null }
      expect(beforeBody.lastInboundAt).toBeNull()

      const inboundAt = 1_730_000_000_000
      clinicWhatsapp.touchWhatsappLastInbound(
        getClinic('clinic-demo-a').db,
        'clinic-demo-a',
        inboundAt,
      )

      const after = await app.request(
        'http://localhost/api/tenants/clinic-demo-a/whatsapp',
        auth('user_synth_owner_a'),
      )
      expect(after.status).toBe(200)
      const afterBody = (await after.json()) as {
        status: string
        lastInboundAt: number | null
        displayPhone: string | null
      }
      expect(afterBody.status).toBe('connected')
      expect(afterBody.displayPhone).toBe('+15551820342')
      expect(afterBody.lastInboundAt).toBe(inboundAt)
    } finally {
      close()
    }
  })
})
