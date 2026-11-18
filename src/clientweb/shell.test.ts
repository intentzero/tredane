import { describe, expect, it } from 'vitest'
import { createApp } from '../worker/app'
import type { WorkerBindings } from '../worker/bindings'
import { applyShellHeaders } from './shell'

const ON = {} as unknown as WorkerBindings
const INDEX = '<!doctype html><html><body><div id="root"></div></body></html>'

function appWith(assets?: (r: Request) => Promise<Response>) {
  const seen: string[] = []
  const app = createApp({
    clientWebShell: {
      assetsFetch:
        assets ??
        (async (r) => {
          seen.push(new URL(r.url).pathname)
          return new Response(INDEX, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=3600', ETag: '"abc"' } })
        }),
    },
  })
  return { app, seen }
}

describe('casca da página da cliente (/c)', () => {
  it('serve o index.html com no-store, no-referrer, noindex e sem moldura, e tira o cache do asset', async () => {
    const { app, seen } = appWith()
    for (const path of ['/c', '/c/cw1_exemplo']) {
      const res = await app.request(`https://app.test${path}`, {}, ON)
      expect(res.status).toBe(200)
      expect(await res.text()).toBe(INDEX)
      expect(res.headers.get('content-type')).toContain('text/html')
      expect(res.headers.get('cache-control')).toBe('no-store')
      expect(res.headers.get('referrer-policy')).toBe('no-referrer')
      expect(res.headers.get('x-robots-tag')).toBe('noindex')
      expect(res.headers.get('x-frame-options')).toBe('DENY')
      expect(res.headers.get('content-security-policy')).toBe("frame-ancestors 'none'")
    }
    // Pede sempre a raiz dos assets: o token do URL nunca vai para a busca de ficheiros.
    expect(seen).toEqual(['/', '/'])
  })

  it('sem assets disponíveis responde 503 e não vaza o token', async () => {
    const app = createApp({})
    const res = await app.request('https://app.test/c/cw1_segredo', {}, ON)
    expect(res.status).toBe(503)
    expect(await res.text()).not.toContain('cw1_segredo')
  })

  it('só serve GET e não apanha caminhos parecidos', async () => {
    const { app } = appWith()
    expect((await app.request('https://app.test/c/cw1_x', { method: 'POST' }, ON)).status).toBe(404)
    expect((await app.request('https://app.test/clientes', {}, ON)).status).not.toBe(200)
  })

  it('um erro do asset passa com o seu estado, sem cache', async () => {
    const { app } = appWith(async () => new Response('erro', { status: 500 }))
    const res = await app.request('https://app.test/c/cw1_x', {}, ON)
    expect(res.status).toBe(500)
    expect(res.headers.get('cache-control')).toBe('no-store')
  })

  it('applyShellHeaders substitui o cache existente', () => {
    const h = new Headers({ 'Cache-Control': 'public, max-age=31536000' })
    applyShellHeaders(h)
    expect(h.get('cache-control')).toBe('no-store')
  })
})
