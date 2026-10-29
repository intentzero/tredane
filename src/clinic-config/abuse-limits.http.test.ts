/**
 * HTTP — limites de abuso por clínica (owner UI).
 * Dados fictícios. Attendant 403; cross-tenant 403; bounds; auditoria.
 */
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
import { DEFAULT_ABUSE_LIMIT_NUMBERS } from '../clinic/ai/abuse-limits'

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

const url = (tenant = 'clinic-demo-a') =>
  `http://localhost/api/tenants/${tenant}/config/abuse-limits`

describe('HTTP — limites de abuso da clínica', () => {
  it('owner lê defaults Confirmados (enabled off); attendant e cross-tenant 403', async () => {
    const { app, close, auth } = testConfigApp()
    try {
      const ok = await app.request(url(), auth('user_synth_owner_a'))
      expect(ok.status).toBe(200)
      const body = (await ok.json()) as {
        enabled: boolean
        autoBookPaused: boolean
        limits: { autoDraftsPerContact: number; proposalsPerClinic: number }
      }
      expect(body.enabled).toBe(false)
      expect(body.autoBookPaused).toBe(false)
      expect(body.limits.autoDraftsPerContact).toBe(
        DEFAULT_ABUSE_LIMIT_NUMBERS.autoDraftsPerContact,
      )
      expect(body.limits.proposalsPerClinic).toBe(
        DEFAULT_ABUSE_LIMIT_NUMBERS.proposalsPerClinic,
      )

      expect((await app.request(url(), auth('user_synth_attendant_a'))).status).toBe(403)
      expect(
        (
          await app.request(
            url('clinic-demo-b'),
            auth('user_synth_owner_a', {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ enabled: true }),
            }),
          )
        ).status,
      ).toBe(403)
    } finally {
      close()
    }
  })

  it('owner liga, ajusta números, rejeita acima do teto, restaura e audita', async () => {
    const { app, close, auth, clinics } = testConfigApp()
    try {
      const patch = (body: unknown) =>
        app.request(
          url(),
          auth('user_synth_owner_a', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          }),
        )

      expect((await patch({ enabled: true, autoBookPaused: true })).status).toBe(200)
      const on = await patch({ autoDraftsPerContact: 7, proposalsPerContact: 3 })
      expect(on.status).toBe(200)
      const saved = (await on.json()) as {
        enabled: boolean
        autoBookPaused: boolean
        limits: { autoDraftsPerContact: number; proposalsPerContact: number }
        effective: { enabled: boolean }
      }
      expect(saved.enabled).toBe(true)
      expect(saved.autoBookPaused).toBe(true)
      expect(saved.limits.autoDraftsPerContact).toBe(7)
      expect(saved.limits.proposalsPerContact).toBe(3)
      expect(saved.effective.enabled).toBe(true)

      const over = await patch({ autoDraftsPerContact: 9999 })
      expect(over.status).toBe(400)
      const overBody = (await over.json()) as { error: string }
      expect(overBody.error).toBe('abuse_limit_above_cap')

      const reset = await patch({ resetToDefaults: true })
      expect(reset.status).toBe(200)
      const r = (await reset.json()) as {
        enabled: boolean
        limits: { autoDraftsPerContact: number }
      }
      // reset só números; enable permanece
      expect(r.enabled).toBe(true)
      expect(r.limits.autoDraftsPerContact).toBe(
        DEFAULT_ABUSE_LIMIT_NUMBERS.autoDraftsPerContact,
      )

      const boot = clinics.get('clinic-demo-a')!
      const audit = boot.db.get<{ n: number }>(
        `SELECT COUNT(*) AS n FROM operational_audit WHERE action = 'config.abuse_limits_updated'`,
      )
      expect(audit?.n).toBeGreaterThanOrEqual(3)
    } finally {
      close()
    }
  })

  it('attendant não grava (403)', async () => {
    const { app, close, auth } = testConfigApp()
    try {
      const denied = await app.request(
        url(),
        auth('user_synth_attendant_a', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enabled: true }),
        }),
      )
      expect(denied.status).toBe(403)
    } finally {
      close()
    }
  })
})
