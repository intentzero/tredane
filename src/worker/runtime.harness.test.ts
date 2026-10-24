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
      phase: 'f1',
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
    expect(JSON.parse(await replied)).toEqual({ echo: 'probe-f0', phase: 'f1' })
    socket!.close(1000, 'done')
  })

  it('migrates Clinic DO SQLite per instance and isolates same logical ids', async () => {
    const ingestA = await worker.fetch('http://localhost/api/f1/clinic/clinic-demo-a/ingest', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        providerEventKey: 'wa:harness:shared-key',
        waId: '5511999000001',
        displayName: 'Sintético A',
        body: 'mensagem A',
        drain: true,
      }),
    })
    const ingestB = await worker.fetch('http://localhost/api/f1/clinic/clinic-demo-b/ingest', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        providerEventKey: 'wa:harness:shared-key',
        waId: '5511999000001',
        displayName: 'Sintético B',
        body: 'mensagem B',
        drain: true,
      }),
    })
    expect(ingestA.status).toBe(200)
    expect(ingestB.status).toBe(200)
    const bodyA = (await ingestA.json()) as { duplicate: boolean; contactId: string }
    const bodyB = (await ingestB.json()) as { duplicate: boolean; contactId: string }
    expect(bodyA.duplicate).toBe(false)
    expect(bodyB.duplicate).toBe(false)

    const statusA = await worker.fetch('http://localhost/api/f1/clinic/clinic-demo-a/status')
    const statusB = await worker.fetch('http://localhost/api/f1/clinic/clinic-demo-b/status')
    await expect(statusA.json()).resolves.toMatchObject({
      tenantId: 'clinic-demo-a',
      schemaReady: true,
      contactCount: 1,
    })
    await expect(statusB.json()).resolves.toMatchObject({
      tenantId: 'clinic-demo-b',
      schemaReady: true,
      contactCount: 1,
    })

    const storageA = await worker.getDurableObjectStorage('CLINIC', { name: 'clinic-demo-a' })
    const storageB = await worker.getDurableObjectStorage('CLINIC', { name: 'clinic-demo-b' })
    const contactsA = await storageA.exec(
      'SELECT display_name FROM contacts WHERE tenant_id = ?',
      'clinic-demo-a',
    )
    const contactsB = await storageB.exec(
      'SELECT display_name FROM contacts WHERE tenant_id = ?',
      'clinic-demo-b',
    )
    expect(contactsA).toEqual([{ display_name: 'Sintético A' }])
    expect(contactsB).toEqual([{ display_name: 'Sintético B' }])

    const schemaA = await storageA.exec(
      'SELECT version, status FROM clinic_schema_state WHERE id = 1',
    )
    expect(schemaA).toEqual([{ version: 1, status: 'ready' }])
  })

  it('rejects forged tenant on Clinic DO RPC and recovers outbox after deferred drain', async () => {
    const forged = await worker.fetch(
      'http://localhost/api/f1/clinic/clinic-demo-a/ingest-forged?forged=clinic-demo-b',
      { method: 'POST' },
    )
    expect(forged.status).toBe(403)
    await expect(forged.json()).resolves.toMatchObject({ rejected: true })

    const ingest = await worker.fetch('http://localhost/api/f1/clinic/clinic-demo-a/ingest', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        providerEventKey: 'wa:harness:deferred-drain',
        waId: '5511999000099',
        body: 'pendente',
        drain: false,
      }),
    })
    expect(ingest.status).toBe(200)
    const ingested = (await ingest.json()) as { outboxId: string; drained: string[] }
    expect(ingested.outboxId).toBeTruthy()
    expect(ingested.drained).toEqual([])

    const storage = await worker.getDurableObjectStorage('CLINIC', { name: 'clinic-demo-a' })
    const pending = await storage.exec(
      `SELECT processing_state FROM outbox_events WHERE id = ?`,
      ingested.outboxId,
    )
    expect(pending).toEqual([{ processing_state: 'pending' }])

    const drain = await worker.fetch('http://localhost/api/f1/clinic/clinic-demo-a/drain', {
      method: 'POST',
    })
    expect(drain.status).toBe(200)
    await expect(drain.json()).resolves.toMatchObject({
      published: [ingested.outboxId],
      failed: [],
    })

    const after = await storage.exec(
      `SELECT processing_state FROM outbox_events WHERE id = ?`,
      ingested.outboxId,
    )
    expect(after).toEqual([{ processing_state: 'published' }])

    const contacts = await storage.exec(
      `SELECT COUNT(*) AS n FROM contacts WHERE tenant_id = ?`,
      'clinic-demo-a',
    )
    expect(contacts[0]).toMatchObject({ n: expect.anything() })
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

  it('autoriza /api/me/tenants com Bearer synth e isola tenants (#21)', async () => {
    const missing = await worker.fetch('http://localhost/api/me')
    expect(missing.status).toBe(401)

    const multi = await worker.fetch('http://localhost/api/me/tenants', {
      headers: { Authorization: 'Bearer synth:user_synth_multi' },
    })
    expect(multi.status).toBe(200)
    await expect(multi.json()).resolves.toEqual({
      tenants: [
        { tenantId: 'clinic-demo-a', role: 'owner', status: 'active' },
        { tenantId: 'clinic-demo-b', role: 'attendant', status: 'active' },
      ],
    })

    const cross = await worker.fetch('http://localhost/api/tenants/clinic-demo-b/context', {
      headers: { Authorization: 'Bearer synth:user_synth_attendant_a' },
    })
    expect(cross.status).toBe(403)

    const platformDenied = await worker.fetch('http://localhost/api/platform/tenants', {
      headers: { Authorization: 'Bearer synth:user_synth_string_super' },
    })
    expect(platformDenied.status).toBe(403)

    const platformOk = await worker.fetch('http://localhost/api/platform/tenants', {
      headers: { Authorization: 'Bearer synth:user_synth_superadmin' },
    })
    expect(platformOk.status).toBe(200)
  })
})
