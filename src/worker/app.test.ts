import { describe, expect, it } from 'vitest'
import { createSyntheticAuthorityReader, createSyntheticSessionAuthenticator } from '../auth'
import { asyncFromSync } from '../db/admin/async-store'
import { bootAdminDb } from '../db/test-db'
import { createApp } from './app'

describe('Worker API — F0/F1 harness', () => {
  const boot = bootAdminDb()
  const app = createApp({
    authServicesFactory: () => ({
      sessions: createSyntheticSessionAuthenticator({
        authorizedParties: ['http://localhost:5173'],
      }),
      authority: createSyntheticAuthorityReader(),
      adminDb: asyncFromSync(boot.db),
    }),
  })

  it('exposes a public health endpoint without tenant information', async () => {
    const response = await app.request('http://localhost/api/health')
    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(await response.json()).toEqual({
      status: 'ok',
      service: 'tredane',
      phase: 'f1',
      environment: 'development',
    })
  })

  it('exposes client auth bootstrap without secrets', async () => {
    const response = await app.request('http://localhost/api/auth/client-config')
    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(await response.json()).toEqual({
      authMode: 'synthetic',
      clerkPublishableKey: null,
    })
  })

  it('does not expose unimplemented collection routes', async () => {
    const response = await app.request('http://localhost/api/tenants')
    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'not_found' })
  })

  it('requires authentication on /api/me', async () => {
    const response = await app.request('http://localhost/api/me')
    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: 'unauthenticated' })
  })

  it('rejects non-synthetic tenants on the F0 clinic harness', async () => {
    const response = await app.request('http://localhost/api/f0/clinic/real-clinic/ping')
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'synthetic_tenants_only' })
  })
})
