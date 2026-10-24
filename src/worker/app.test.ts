import { describe, expect, it } from 'vitest'
import { app } from './app'

describe('Worker API — F0', () => {
  it('exposes a public health endpoint without tenant information', async () => {
    const response = await app.request('http://localhost/api/health')
    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(await response.json()).toEqual({
      status: 'ok',
      service: 'tredane',
      phase: 'f0',
    })
  })

  it('does not expose unimplemented API routes', async () => {
    const response = await app.request('http://localhost/api/tenants')
    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'not_found' })
  })
})
