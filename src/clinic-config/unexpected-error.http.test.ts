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

/** Falha inesperada do Durable Object (ex.: cota esgotada) não vaza a mensagem interna. */
describe('HTTP — erro inesperado na configuração da clínica', () => {
  it('devolve 500 genérico e não repete a mensagem da exceção', async () => {
    const admin = bootAdminDb()
    const services: AuthServices = {
      sessions: createSyntheticSessionAuthenticator({ authorizedParties: ['http://localhost:5173'] }),
      authority: createSyntheticAuthorityReader(),
      adminDb: asyncFromSync(admin.db),
    }
    const app = createApp({
      authServicesFactory: () => services,
      syncAdminDbFactory: () => admin.db,
      clinicConfigGatewayFactory: () =>
        ({
          getSnapshot: async () => {
            throw new Error('Exceeded allowed rows read in Durable Objects free tier.')
          },
        }) as never,
    })
    const res = await app.request('http://localhost/api/tenants/clinic-demo-a/config', {
      headers: { Authorization: synthAuthHeader('user_synth_owner_a') },
    })
    const text = await res.text()
    expect(res.status).toBe(500)
    expect(JSON.parse(text)).toEqual({ error: 'internal_error' })
    expect(text).not.toContain('Exceeded')
    admin.close()
  })
})
