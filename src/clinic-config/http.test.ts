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
import { createMemoryClinicConfigRegistry } from './gateway'

function testConfigApp() {
  const admin = bootAdminDb()
  const clinics = new Map<string, ReturnType<typeof bootClinicDb>>()
  const registry = createMemoryClinicConfigRegistry((tenantId) => {
    let boot = clinics.get(tenantId)
    if (!boot) {
      boot = bootClinicDb()
      clinics.set(tenantId, boot)
    }
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
    clinicConfigGatewayFactory: (_env, tenantId) => registry(tenantId),
  })
  return {
    app,
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

describe('HTTP — configuração da clínica (#28)', () => {
  it('opt-in de IA: default off; só o responsável liga/desliga', async () => {
    const { app, close, auth } = testConfigApp()
    try {
      const url = 'http://localhost/api/tenants/clinic-demo-a/config/ai-assist'
      const snap0 = await app.request(
        'http://localhost/api/tenants/clinic-demo-a/config',
        auth('user_synth_owner_a'),
      )
      const s0 = (await snap0.json()) as { settings: { aiAssistEnabled: boolean } }
      expect(s0.settings.aiAssistEnabled).toBe(false)

      const put = (user: string, body: unknown) =>
        app.request(
          url,
          auth(user, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          }),
        )
      expect((await put('user_synth_attendant_a', { enabled: true })).status).toBe(403)
      expect((await put('user_synth_owner_a', { enabled: 'yes' })).status).toBe(400)
      const on = await put('user_synth_owner_a', { enabled: true })
      expect(on.status).toBe(200)
      expect(((await on.json()) as { aiAssistEnabled: boolean }).aiAssistEnabled).toBe(true)
      const off = await put('user_synth_owner_a', { enabled: false })
      expect(((await off.json()) as { aiAssistEnabled: boolean }).aiAssistEnabled).toBe(false)
      // Outra clínica: owner de A não liga IA em B.
      const cross = await app.request(
        'http://localhost/api/tenants/clinic-demo-b/config/ai-assist',
        auth('user_synth_owner_a', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enabled: true }),
        }),
      )
      expect(cross.status).toBe(403)
    } finally {
      close()
    }
  })

  it('link do Google Business: só https, persiste e volta no snapshot', async () => {
    const { app, close, auth } = testConfigApp()
    try {
      const put = (body: unknown) =>
        app.request(
          'http://localhost/api/tenants/clinic-demo-a/config/ai-assist',
          auth('user_synth_owner_a', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          }),
        )
      const bad = await put({ googleBusinessUrl: 'http://exemplo.com.br/ficticio' })
      expect(bad.status).toBe(400)
      const badBody = (await bad.json()) as { error: string; message: string }
      expect(badBody.error).toBe('invalid_google_business_url')
      expect(badBody.message).toMatch(/https:\/\//)
      const ok = await put({
        clinicAddress: 'Rua Fictícia, 123',
        googleBusinessUrl: 'https://maps.app.goo.gl/ficticio123',
        reschedulePolicy: '',
      })
      expect(ok.status).toBe(200)
      const snap = await app.request(
        'http://localhost/api/tenants/clinic-demo-a/config',
        auth('user_synth_owner_a'),
      )
      const s = (await snap.json()) as { settings: { googleBusinessUrl: string } }
      expect(s.settings.googleBusinessUrl).toBe('https://maps.app.goo.gl/ficticio123')
    } finally {
      close()
    }
  })

  it('attendant lê config mas não escreve; owner escreve', async () => {
    const { app, close, auth } = testConfigApp()
    try {
      const readAtt = await app.request(
        'http://localhost/api/tenants/clinic-demo-a/config',
        auth('user_synth_attendant_a'),
      )
      expect(readAtt.status).toBe(200)
      const snap = (await readAtt.json()) as { readiness: { schedulingAllowed: boolean } }
      expect(snap.readiness.schedulingAllowed).toBe(false)

      const denied = await app.request(
        'http://localhost/api/tenants/clinic-demo-a/config/services',
        auth('user_synth_attendant_a', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: 'Hack',
            durationMinutes: 30,
            bufferMinutes: 0,
            professionalIds: [],
          }),
        }),
      )
      expect(denied.status).toBe(403)

      const pro = await app.request(
        'http://localhost/api/tenants/clinic-demo-a/config/resources',
        auth('user_synth_owner_a', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ kind: 'professional', name: 'Dra. Paula Reis' }),
        }),
      )
      expect(pro.status).toBe(201)
      const proBody = (await pro.json()) as { id: string }

      const room = await app.request(
        'http://localhost/api/tenants/clinic-demo-a/config/resources',
        auth('user_synth_owner_a', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            kind: 'room',
            name: 'Sala 2',
            category: 'Sala com laser',
          }),
        }),
      )
      expect(room.status).toBe(201)
      const roomBody = (await room.json()) as { id: string }

      const svc = await app.request(
        'http://localhost/api/tenants/clinic-demo-a/config/services',
        auth('user_synth_owner_a', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: 'Depilação a laser — pernas',
            durationMinutes: 60,
            bufferMinutes: 15,
            priceCents: 18000,
            clientExplanation: 'Texto fictício para IA.',
            professionalIds: [proBody.id],
            roomRequirement: { mode: 'category', category: 'Sala com laser' },
          }),
        }),
      )
      expect(svc.status).toBe(201)
      const svcBody = (await svc.json()) as { occupiedMinutes: number; active: boolean }
      expect(svcBody.occupiedMinutes).toBe(75)

      for (const resourceId of [proBody.id, roomBody.id]) {
        const weekly = await app.request(
          `http://localhost/api/tenants/clinic-demo-a/config/resources/${resourceId}/weekly`,
          auth('user_synth_owner_a', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              windows: [{ dayOfWeek: 1, startMinute: 540, endMinute: 720 }],
            }),
          }),
        )
        expect(weekly.status).toBe(200)
      }

      const ready = await app.request(
        'http://localhost/api/tenants/clinic-demo-a/config/readiness',
        auth('user_synth_attendant_a'),
      )
      expect(ready.status).toBe(200)
      const readiness = (await ready.json()) as {
        schedulingAllowed: boolean
        missing: string[]
      }
      expect(readiness.schedulingAllowed).toBe(true)
      expect(readiness.missing).toContain('whatsapp')
    } finally {
      close()
    }
  })

  it('não vaza config entre clínicas; falha de validação não apaga cadastro', async () => {
    const { app, close, auth } = testConfigApp()
    try {
      await app.request(
        'http://localhost/api/tenants/clinic-demo-a/config/resources',
        auth('user_synth_owner_a', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ kind: 'professional', name: 'Só A' }),
        }),
      )

      const b = await app.request(
        'http://localhost/api/tenants/clinic-demo-b/config',
        auth('user_synth_multi'),
      )
      expect(b.status).toBe(200)
      const snapB = (await b.json()) as { resources: unknown[] }
      expect(snapB.resources).toEqual([])

      const bad = await app.request(
        'http://localhost/api/tenants/clinic-demo-a/config/services',
        auth('user_synth_owner_a', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: 'Ruim',
            durationMinutes: 17,
            bufferMinutes: 0,
            professionalIds: [],
          }),
        }),
      )
      expect(bad.status).toBe(400)

      const after = await app.request(
        'http://localhost/api/tenants/clinic-demo-a/config',
        auth('user_synth_owner_a'),
      )
      const snapA = (await after.json()) as { services: unknown[]; resources: unknown[] }
      expect(snapA.services).toEqual([])
      expect(snapA.resources).toHaveLength(1)
    } finally {
      close()
    }
  })

  it('bloqueio dryRun e create listam afectados; compromisso permanece', async () => {
    const { app, close, auth } = testConfigApp()
    try {
      const proRes = await app.request(
        'http://localhost/api/tenants/clinic-demo-a/config/resources',
        auth('user_synth_owner_a', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ kind: 'professional', name: 'Dra. Paula' }),
        }),
      )
      const pro = (await proRes.json()) as { id: string }

      const svcRes = await app.request(
        'http://localhost/api/tenants/clinic-demo-a/config/services',
        auth('user_synth_owner_a', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: 'Limpeza',
            durationMinutes: 60,
            bufferMinutes: 0,
            professionalIds: [pro.id],
          }),
        }),
      )
      const svc = (await svcRes.json()) as { id: string }

      const starts = Date.now() + 86_400_000
      const aptRes = await app.request(
        'http://localhost/api/tenants/clinic-demo-a/config/test-appointments',
        auth('user_synth_owner_a', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            serviceId: svc.id,
            professionalId: pro.id,
            startsAt: starts,
            endsAt: starts + 3_600_000,
            contactLabel: 'Ana Fictícia',
          }),
        }),
      )
      expect(aptRes.status).toBe(201)

      const dry = await app.request(
        'http://localhost/api/tenants/clinic-demo-a/config/blocks',
        auth('user_synth_owner_a', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            resourceId: pro.id,
            startsAt: starts - 60_000,
            endsAt: starts + 7_200_000,
            reason: 'ferias',
            dryRun: true,
          }),
        }),
      )
      expect(dry.status).toBe(200)
      const dryBody = (await dry.json()) as {
        created: boolean
        affectedAppointments: unknown[]
      }
      expect(dryBody.created).toBe(false)
      expect(dryBody.affectedAppointments).toHaveLength(1)

      const created = await app.request(
        'http://localhost/api/tenants/clinic-demo-a/config/blocks',
        auth('user_synth_owner_a', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            resourceId: pro.id,
            startsAt: starts - 60_000,
            endsAt: starts + 7_200_000,
            reason: 'ferias',
          }),
        }),
      )
      expect(created.status).toBe(201)
      const body = (await created.json()) as {
        created: boolean
        affectedAppointments: Array<{ status: string }>
      }
      expect(body.created).toBe(true)
      expect(body.affectedAppointments[0]?.status).toBe('confirmed')
    } finally {
      close()
    }
  })
})

describe('HTTP — local da previsão (DEC-077 S2)', () => {
  type Place = {
    aiAssistEnabled: boolean
    clinicAddress: string
    forecastMode: string
    forecastCity: string | null
    forecastLatitude: number | null
    forecastLongitude: number | null
    timezone: string
  }

  it('a responsável grava cidade ou coordenadas; a atendente não; o endereço da IA fica de fora', async () => {
    const { app, close, auth } = testConfigApp()
    try {
      const url = 'http://localhost/api/tenants/clinic-demo-a/config/forecast-place'
      const put = (user: string, body: unknown) =>
        app.request(
          url,
          auth(user, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          }),
        )
      const snap = async () => {
        const res = await app.request(
          'http://localhost/api/tenants/clinic-demo-a/config',
          auth('user_synth_owner_a'),
        )
        const body = (await res.json()) as { settings: Place }
        return body.settings
      }

      expect((await snap()).aiAssistEnabled).toBe(false)
      expect((await put('user_synth_attendant_a', { mode: 'cidade', city: 'Campinas' })).status).toBe(
        403,
      )

      const city = await put('user_synth_owner_a', { mode: 'cidade', city: '  Campinas  ' })
      expect(city.status).toBe(200)
      expect(await snap()).toMatchObject({
        aiAssistEnabled: false,
        clinicAddress: '',
        forecastMode: 'cidade',
        forecastCity: 'Campinas',
        forecastLatitude: null,
        forecastLongitude: null,
      })

      const empty = await put('user_synth_owner_a', { mode: 'cidade', city: '   ' })
      expect(empty.status).toBe(400)
      expect((await snap()).forecastCity).toBe('Campinas')

      const badLat = await put('user_synth_owner_a', {
        mode: 'coordenadas',
        latitude: 91,
        longitude: -47,
      })
      expect(badLat.status).toBe(400)
      expect(await snap()).toMatchObject({
        forecastMode: 'cidade',
        forecastCity: 'Campinas',
        forecastLatitude: null,
        forecastLongitude: null,
      })

      const coords = await put('user_synth_owner_a', {
        mode: 'coordenadas',
        latitude: -90,
        longitude: 180,
      })
      expect(coords.status).toBe(200)
      expect(await snap()).toMatchObject({
        forecastMode: 'coordenadas',
        forecastCity: null,
        forecastLatitude: -90,
        forecastLongitude: 180,
      })

      const address = await app.request(
        'http://localhost/api/tenants/clinic-demo-a/config/ai-assist',
        auth('user_synth_owner_a', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ clinicAddress: 'Rua Fictícia, 10' }),
        }),
      )
      expect(address.status).toBe(200)
      const tz = await app.request(
        'http://localhost/api/tenants/clinic-demo-a/config/settings',
        auth('user_synth_owner_a', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ timezone: 'America/Sao_Paulo' }),
        }),
      )
      expect(tz.status).toBe(200)
      expect(await snap()).toMatchObject({
        aiAssistEnabled: false,
        clinicAddress: 'Rua Fictícia, 10',
        forecastMode: 'coordenadas',
        forecastCity: null,
        forecastLatitude: -90,
        forecastLongitude: 180,
        timezone: 'America/Sao_Paulo',
      })

      const cross = await app.request(
        'http://localhost/api/tenants/clinic-demo-b/config/forecast-place',
        auth('user_synth_owner_a', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mode: 'cidade', city: 'Campinas' }),
        }),
      )
      expect(cross.status).toBe(403)
      const other = await app.request(
        'http://localhost/api/tenants/clinic-demo-b/config',
        auth('user_synth_owner_b'),
      )
      const otherSettings = ((await other.json()) as { settings: Place }).settings
      expect(otherSettings.forecastMode).toBe('nenhum')
      expect(otherSettings.forecastCity).toBeNull()
    } finally {
      close()
    }
  })
})
