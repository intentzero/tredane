/**
 * Casca da página da cliente (`/c` e `/c/<token>`), servida pelo Worker em vez do asset estático
 * (ADR-0018 §7a): o URL leva o token do link, por isso a resposta não pode ir para cache nem
 * deixar o endereço no Referer. Devolve o `index.html` da SPA com os cabeçalhos de privacidade.
 *
 * Fora de staging com `CLIENT_WEB_ENABLED` desligado responde 404, como as rotas `/api/c/*`.
 */
import { Hono } from 'hono'
import type { WorkerBindings } from '../worker/bindings'
import { isClientWebEnabled } from './flag'

type AppEnv = { Bindings: WorkerBindings }

export type ClientWebShellOptions = {
  /** Testes: substitui o binding ASSETS. */
  assetsFetch?: (request: Request) => Promise<Response>
}

/** Cabeçalhos de privacidade da casca (mesmos das rotas `/api/c/*`). */
export function applyShellHeaders(headers: Headers): void {
  headers.set('Cache-Control', 'no-store')
  headers.set('Referrer-Policy', 'no-referrer')
  headers.set('X-Robots-Tag', 'noindex')
  headers.set('X-Frame-Options', 'DENY')
  headers.set('Content-Security-Policy', "frame-ancestors 'none'")
}

export function createClientWebShellRoutes(opts: ClientWebShellOptions = {}) {
  const app = new Hono<AppEnv>()
  const serve = async (c: { env: WorkerBindings; req: { url: string }; json: (b: unknown, s?: number) => Response }) => {
    if (!isClientWebEnabled(c.env)) {
      const headers = new Headers({ 'Content-Type': 'application/json' })
      applyShellHeaders(headers)
      return new Response(JSON.stringify({ error: 'not_found' }), { status: 404, headers })
    }
    const fetchAsset = opts.assetsFetch ?? (c.env.ASSETS ? (r: Request) => c.env.ASSETS!.fetch(r) : null)
    if (!fetchAsset) return c.json({ error: 'assets_unavailable' }, 503)
    // A raiz do site serve o index.html da SPA (o caminho `/index.html` redirecionaria).
    const res = await fetchAsset(new Request(new URL('/', c.req.url).toString()))
    const headers = new Headers(res.headers)
    applyShellHeaders(headers)
    headers.delete('Location')
    return new Response(res.body, { status: res.ok ? 200 : res.status, headers })
  }
  app.get('/c', (c) => serve(c))
  app.get('/c/*', (c) => serve(c))
  return app
}
