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
import { ValidationError } from '../clinic'

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

  it('PUT zones: ValidationError ecoada pelo DO RPC (sem instanceof) → 400, não 500', async () => {
    const admin = bootAdminDb()
    const services: AuthServices = {
      sessions: createSyntheticSessionAuthenticator({ authorizedParties: ['http://localhost:5173'] }),
      authority: createSyntheticAuthorityReader(),
      adminDb: asyncFromSync(admin.db),
    }
    const local = new ValidationError(
      'synonym_collision',
      '«peito» já identifica a variante «Peito». Escolha outro sinónimo.',
      { synonym: 'peito', conflictingLabel: 'Peito' },
    )
    // Simula o eco RPC: mesmo name/code/details, protótipo perdido.
    const remote = new Error(local.message)
    remote.name = local.name
    Object.assign(remote, { code: local.code, details: local.details })
    expect(remote instanceof ValidationError).toBe(false)

    const app = createApp({
      authServicesFactory: () => services,
      syncAdminDbFactory: () => admin.db,
      clinicConfigGatewayFactory: () =>
        ({
          replaceServiceZones: async () => {
            throw remote
          },
        }) as never,
    })
    const res = await app.request(
      'http://localhost/api/tenants/clinic-demo-a/config/services/svc_x/zones',
      {
        method: 'PUT',
        headers: {
          Authorization: synthAuthHeader('user_synth_owner_a'),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          zones: [
            {
              name: 'Peito e abdômen',
              durationMinutes: 30,
              priceCents: 9000,
              audience: 'masculino',
              synonyms: ['peito', 'abdominal', 'barriga'],
            },
          ],
        }),
      },
    )
    const body = (await res.json()) as {
      error: string
      message: string
      details: { synonym: string } | null
    }
    expect(res.status).toBe(400)
    expect(body.error).toBe('synonym_collision')
    expect(body.message).toMatch(/peito/i)
    expect(body.details?.synonym).toBe('peito')
    admin.close()
  })
})
