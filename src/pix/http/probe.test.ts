import { createServer, type IncomingMessage, type Server } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PixHttpProbeClient, type ProbeCharge } from './probe'

type Store = Map<string, ProbeCharge & { idempotencyKey: string }>

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

function startMockProvider(): Promise<{ server: Server; baseUrl: string; store: Store }> {
  const store: Store = new Map()
  const byIdempotency = new Map<string, string>()
  let seq = 0

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    try {
      if (req.method === 'POST' && url.pathname === '/charges') {
        const raw = await readBody(req)
        const body = JSON.parse(raw) as {
          tenantId: string
          accountId: string
          amountCents: number
          expiresInSeconds: number
          externalReference: string
        }
        const idempotencyKey = req.headers['idempotency-key']
        if (typeof idempotencyKey === 'string' && byIdempotency.has(idempotencyKey)) {
          const existing = store.get(byIdempotency.get(idempotencyKey)!)!
          res.writeHead(200, { 'content-type': 'application/json' })
          res.end(JSON.stringify(existing))
          return
        }
        const id = `http_chg_${++seq}`
        const charge: ProbeCharge & { idempotencyKey: string } = {
          id,
          tenantId: body.tenantId,
          accountId: body.accountId,
          amountCents: body.amountCents,
          status: 'awaiting_payment',
          externalReference: body.externalReference,
          expiresAt: new Date(Date.now() + body.expiresInSeconds * 1000).toISOString(),
          idempotencyKey: typeof idempotencyKey === 'string' ? idempotencyKey : id,
        }
        store.set(id, charge)
        if (typeof idempotencyKey === 'string') byIdempotency.set(idempotencyKey, id)
        res.writeHead(201, { 'content-type': 'application/json' })
        res.end(JSON.stringify(charge))
        return
      }

      const chargeMatch = url.pathname.match(/^\/charges\/([^/]+)$/)
      if (req.method === 'GET' && chargeMatch) {
        const charge = store.get(decodeURIComponent(chargeMatch[1]!))
        if (!charge) {
          res.writeHead(404)
          res.end()
          return
        }
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify(charge))
        return
      }

      const cancelMatch = url.pathname.match(/^\/charges\/([^/]+)\/cancel$/)
      if (req.method === 'POST' && cancelMatch) {
        const charge = store.get(decodeURIComponent(cancelMatch[1]!))
        if (!charge) {
          res.writeHead(404)
          res.end()
          return
        }
        charge.status = 'cancelled'
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify(charge))
        return
      }

      // Endpoint lento para prova de timeout do cliente.
      if (req.method === 'POST' && url.pathname === '/slow') {
        await new Promise((r) => setTimeout(r, 200))
        res.writeHead(200)
        res.end('ok')
        return
      }

      res.writeHead(404)
      res.end()
    } catch {
      res.writeHead(500)
      res.end()
    }
  })

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        throw new Error('endereço inesperado do servidor mock')
      }
      resolve({
        server,
        baseUrl: `http://127.0.0.1:${address.port}`,
        store,
      })
    })
  })
}

describe('PixHttpProbeClient — fetch compatível com Workers', () => {
  let server: Server
  let baseUrl: string

  beforeAll(async () => {
    const started = await startMockProvider()
    server = started.server
    baseUrl = started.baseUrl
  })

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()))
    })
  })

  it('cria, consulta e cancela cobrança via HTTP fetch', async () => {
    const client = new PixHttpProbeClient({ baseUrl })
    const created = await client.createCharge({
      tenantId: 'tenant_a',
      accountId: 'acct_a',
      amountCents: 9900,
      expiresInSeconds: 7200,
      idempotencyKey: 'http_idem_1',
      externalReference: 'ref_http_1',
    })
    expect(created.ok).toBe(true)
    if (!created.ok) return
    expect(created.value.status).toBe('awaiting_payment')
    expect(created.value.tenantId).toBe('tenant_a')
    expect(created.value.accountId).toBe('acct_a')
    expect(created.value.amountCents).toBe(9900)

    const got = await client.getCharge(created.value.id)
    expect(got.ok).toBe(true)
    if (!got.ok) return
    expect(got.value.id).toBe(created.value.id)

    const cancelled = await client.cancelCharge(created.value.id)
    expect(cancelled.ok).toBe(true)
    if (!cancelled.ok) return
    expect(cancelled.value.status).toBe('cancelled')
  })

  it('é idempotente na criação HTTP e detecta timeout do cliente', async () => {
    const client = new PixHttpProbeClient({ baseUrl })
    const first = await client.createCharge({
      tenantId: 'tenant_a',
      accountId: 'acct_a',
      amountCents: 100,
      expiresInSeconds: 60,
      idempotencyKey: 'http_idem_dup',
      externalReference: 'ref_dup',
    })
    const second = await client.createCharge({
      tenantId: 'tenant_a',
      accountId: 'acct_a',
      amountCents: 100,
      expiresInSeconds: 60,
      idempotencyKey: 'http_idem_dup',
      externalReference: 'ref_dup',
    })
    expect(first.ok && second.ok).toBe(true)
    if (!first.ok || !second.ok) return
    expect(second.value.id).toBe(first.value.id)

    const slowClient = new PixHttpProbeClient({
      baseUrl,
      timeoutMs: 20,
      fetchImpl: (input, init) =>
        fetch(typeof input === 'string' ? `${baseUrl}/slow` : input, init),
    })
    const timedOut = await slowClient.createCharge({
      tenantId: 'tenant_a',
      accountId: 'acct_a',
      amountCents: 100,
      expiresInSeconds: 60,
      idempotencyKey: 'http_timeout',
      externalReference: 'ref_timeout',
    })
    expect(timedOut.ok).toBe(false)
    if (timedOut.ok) return
    expect(timedOut.code).toBe('timeout')
  })
})
