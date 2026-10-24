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
import { bootClinicDb } from '../clinic/test-db'
import { clinicInbox, clinicWhatsapp } from '../clinic'
import { createMemoryInboxRegistry } from './gateway'

function ensureClinic(
  clinics: Map<string, ReturnType<typeof bootClinicDb>>,
  tenantId: string,
) {
  let boot = clinics.get(tenantId)
  if (!boot) {
    boot = bootClinicDb()
    clinics.set(tenantId, boot)
  }
  return boot
}

function connectWhatsappForSend(
  clinics: Map<string, ReturnType<typeof bootClinicDb>>,
  tenantId: string,
) {
  const { db, clock } = ensureClinic(clinics, tenantId)
  clinicWhatsapp.syncWhatsappChannel(
    db,
    tenantId,
    {
      status: 'connected',
      bindingId: 'bind_http_test',
      phoneNumberId: 'pn_http_test',
      wabaId: 'waba_http_test',
      displayPhone: '+15550001111',
      action: 'channel_connected',
    },
    clock,
  )
  clinicInbox.seedSyntheticWhatsappTemplates(db, tenantId, clock)
}

function testInboxApp() {
  const admin = bootAdminDb()
  const clinics = new Map<string, ReturnType<typeof bootClinicDb>>()
  const registry = createMemoryInboxRegistry((tenantId) => {
    const boot = ensureClinic(clinics, tenantId)
    return { db: boot.db, clock: boot.clock }
  })
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
    inboxGatewayFactory: (_env, tenantId) => registry(tenantId),
  })
  return {
    app,
    clinics,
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

describe('HTTP — caixa de entrada (#29)', () => {
  it('owner e attendant vêem seed; IDs de outra clínica são 404', async () => {
    const { app, close, auth } = testInboxApp()
    try {
      const seedA = await app.request(
        'http://localhost/api/tenants/clinic-demo-a/inbox/seed-demo',
        auth('user_synth_attendant_a', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
        }),
      )
      expect(seedA.status).toBe(200)

      const listAtt = await app.request(
        'http://localhost/api/tenants/clinic-demo-a/inbox/conversations',
        auth('user_synth_attendant_a'),
      )
      expect(listAtt.status).toBe(200)
      const bodyAtt = (await listAtt.json()) as {
        conversations: Array<{ id: string; assigneeClerkUserId: string | null }>
      }
      expect(bodyAtt.conversations.length).toBeGreaterThan(0)
      // DEC-015: conversas de outros membros visíveis
      expect(
        bodyAtt.conversations.some(
          (c) =>
            c.assigneeClerkUserId &&
            c.assigneeClerkUserId !== 'user_synth_attendant_a',
        ),
      ).toBe(true)

      const listOwner = await app.request(
        'http://localhost/api/tenants/clinic-demo-a/inbox/conversations',
        auth('user_synth_owner_a'),
      )
      expect(listOwner.status).toBe(200)

      const cnvId = bodyAtt.conversations[0]!.id
      const cross = await app.request(
        `http://localhost/api/tenants/clinic-demo-b/inbox/conversations/${encodeURIComponent(cnvId)}`,
        auth('user_synth_owner_b'),
      )
      expect(cross.status).toBe(404)

      const noAccess = await app.request(
        'http://localhost/api/tenants/clinic-demo-a/inbox/conversations',
        auth('user_synth_owner_b'),
      )
      expect(noAccess.status).toBe(403)
    } finally {
      close()
    }
  })

  it('assumir valida membership; transferir para não-membro falha', async () => {
    const { app, close, auth } = testInboxApp()
    try {
      await app.request(
        'http://localhost/api/tenants/clinic-demo-a/inbox/seed-demo',
        auth('user_synth_owner_a', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
        }),
      )
      const list = await app.request(
        'http://localhost/api/tenants/clinic-demo-a/inbox/conversations?filter=unassigned',
        auth('user_synth_attendant_a'),
      )
      const body = (await list.json()) as { conversations: Array<{ id: string }> }
      expect(body.conversations.length).toBeGreaterThan(0)
      const cnvId = body.conversations[0]!.id

      const bad = await app.request(
        `http://localhost/api/tenants/clinic-demo-a/inbox/conversations/${cnvId}/assign`,
        auth('user_synth_attendant_a', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            assigneeClerkUserId: 'user_synth_no_access',
            assigneeDisplayName: 'Intruso',
          }),
        }),
      )
      expect(bad.status).toBe(400)

      const ok = await app.request(
        `http://localhost/api/tenants/clinic-demo-a/inbox/conversations/${cnvId}/assign`,
        auth('user_synth_attendant_a', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
        }),
      )
      expect(ok.status).toBe(200)
      const assigned = (await ok.json()) as {
        conversation: { assigneeClerkUserId: string }
      }
      expect(assigned.conversation.assigneeClerkUserId).toBe('user_synth_attendant_a')
    } finally {
      close()
    }
  })

  it('mensagem HTML maliciosa é devolvida como texto (não HTML executável)', async () => {
    const { app, close, auth, clinics } = testInboxApp()
    try {
      await app.request(
        'http://localhost/api/tenants/clinic-demo-a/inbox/seed-demo',
        auth('user_synth_attendant_a', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
        }),
      )
      connectWhatsappForSend(clinics, 'clinic-demo-a')
      const list = await app.request(
        'http://localhost/api/tenants/clinic-demo-a/inbox/conversations?filter=mine',
        auth('user_synth_attendant_a'),
      )
      const body = (await list.json()) as { conversations: Array<{ id: string }> }
      const cnvId = body.conversations[0]!.id
      const xss = '<img src=x onerror=alert(1)>'
      const sent = await app.request(
        `http://localhost/api/tenants/clinic-demo-a/inbox/conversations/${cnvId}/messages`,
        auth('user_synth_attendant_a', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ body: xss, clientRequestId: 'xss-1' }),
        }),
      )
      expect(sent.status).toBe(201)
      const payload = (await sent.json()) as {
        message: { body: string; deliveryState: string }
      }
      expect(payload.message.body).toBe(xss)
      expect(payload.message.deliveryState).toBe('accepted')
      // Serialização JSON — sem campo html / sanitizedHtml
      expect(JSON.stringify(payload)).not.toMatch(/dangerouslySetInnerHTML|__html/)
    } finally {
      close()
    }
  })
})
