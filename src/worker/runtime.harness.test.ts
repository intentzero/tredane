/**
 * Testes de integração no runtime Cloudflare via createTestHarness (Wrangler).
 * Exercitam D1, DO/SQLite, R2, Queue producer e WebSocket hibernável do harness F0.
 * Domínio de produto (auth, agenda, Meta) permanece fora de escopo (#15).
 */
import { readFileSync } from 'node:fs'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createTestHarness } from 'wrangler'

const seedSql = readFileSync(new URL('../../db/seed.sql', import.meta.url), 'utf8')

const server = createTestHarness({
  // Sem assets SPA — wrangler.jsonc de produto exige directory no harness.
  workers: [{ configPath: './wrangler.runtime-test.jsonc' }],
})

const worker = server.getWorker('tredane-dev')

async function seedD1() {
  await worker.applyD1Migrations('DB')
  const env = await worker.getEnv()
  // wrangler d1 execute --file não está no harness; aplicar seed statement a statement.
  for (const statement of seedSql.split(';').map((s) => s.trim()).filter(Boolean)) {
    // Ignorar comentários de linha no início do statement
    const sql = statement
      .split('\n')
      .filter((line) => !line.trim().startsWith('--'))
      .join('\n')
      .trim()
    if (!sql) continue
    await env.DB.prepare(sql).run()
  }
}

describe('Cloudflare runtime harness — F0', () => {
  beforeAll(async () => {
    await server.listen()
  }, 60_000)

  beforeEach(async () => {
    await seedD1()
  }, 30_000)

  afterEach(async () => {
    await server.reset()
  }, 30_000)

  afterAll(async () => {
    await server.close()
  }, 30_000)

  it('serves /api/health from the Worker build', async () => {
    const response = await worker.fetch('http://localhost/api/health')
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      status: 'ok',
      service: 'tredane',
      phase: 'f0',
      environment: 'development',
    })
  })

  it('applies D1 migrations and synthetic membership fixtures', async () => {
    const env = await worker.getEnv()
    const tenants = await env.DB.prepare('SELECT id, status FROM tenants ORDER BY id').all()
    expect(tenants.results).toEqual([
      { id: 'clinic-demo-a', status: 'active' },
      { id: 'clinic-demo-b', status: 'active' },
      { id: 'clinic-demo-suspended', status: 'suspended' },
    ])
    const memberships = await env.DB.prepare(
      'SELECT COUNT(*) AS n FROM tenant_memberships',
    ).first() as { n: number } | null
    expect(memberships?.n).toBe(7)
    const schema = await env.DB.prepare(
      'SELECT version FROM admin_schema_state WHERE id = 1',
    ).first() as { version: number } | null
    expect(schema?.version).toBe(3)

    const multi = await env.DB.prepare(
      `SELECT tenant_id, role FROM tenant_memberships
       WHERE clerk_user_id = ? ORDER BY tenant_id`,
    )
      .bind('user_synth_multi')
      .all()
    expect(multi.results).toEqual([
      { tenant_id: 'clinic-demo-a', role: 'owner' },
      { tenant_id: 'clinic-demo-b', role: 'attendant' },
    ])
  })

  it('pings isolated Clinic Durable Object SQLite instances', async () => {
    const a = await worker.fetch('http://localhost/api/f0/clinic/clinic-demo-a/ping')
    const b = await worker.fetch('http://localhost/api/f0/clinic/clinic-demo-b/ping')
    expect(a.status).toBe(200)
    expect(b.status).toBe(200)
    await expect(a.json()).resolves.toEqual({
      ok: true,
      tenantId: 'clinic-demo-a',
      value: 'clinic-demo-a',
    })
    await expect(b.json()).resolves.toEqual({
      ok: true,
      tenantId: 'clinic-demo-b',
      value: 'clinic-demo-b',
    })

    const storageA = await worker.getDurableObjectStorage('CLINIC', { name: 'clinic-demo-a' })
    const storageB = await worker.getDurableObjectStorage('CLINIC', { name: 'clinic-demo-b' })
    const rowsA = await storageA.exec('SELECT value FROM f0_probe WHERE key = ?', 'last_ping')
    const rowsB = await storageB.exec('SELECT value FROM f0_probe WHERE key = ?', 'last_ping')
    expect(rowsA).toEqual([{ value: 'clinic-demo-a' }])
    expect(rowsB).toEqual([{ value: 'clinic-demo-b' }])
  })

  it('echoes over hibernatable WebSocket on the clinic DO', async () => {
    const response = await worker.fetch('http://localhost/api/f0/clinic/clinic-demo-a/ws', {
      headers: { Upgrade: 'websocket' },
    })
    expect(response.status).toBe(101)
    const socket = response.webSocket
    expect(socket).toBeTruthy()
    socket!.accept()

    const replied = new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('websocket timeout')), 5_000)
      socket!.addEventListener('message', (event) => {
        clearTimeout(timer)
        resolve(String(event.data))
      })
    })
    socket!.send('probe-f0')
    expect(JSON.parse(await replied)).toEqual({ echo: 'probe-f0', phase: 'f0' })
    socket!.close(1000, 'done')
  })

  it('writes and reads a synthetic object in the local R2 binding', async () => {
    const env = await worker.getEnv()
    const key = 'f0/synthetic/probe.txt'
    await env.ATTACHMENTS.put(key, 'fixture-only', {
      httpMetadata: { contentType: 'text/plain' },
    })
    const object = await env.ATTACHMENTS.get(key)
    expect(object).not.toBeNull()
    expect(await object!.text()).toBe('fixture-only')
  })

  it('enqueues a synthetic message on the local Queue producer binding', async () => {
    const env = await worker.getEnv()
    await env.INBOUND_EVENTS.send({
      phase: 'f0',
      kind: 'synthetic_probe',
      tenantId: 'clinic-demo-a',
    })
    // Consumer real chega na F3; aqui só prova o producer binding no runtime.
    expect(typeof env.INBOUND_EVENTS.send).toBe('function')
  })
})
