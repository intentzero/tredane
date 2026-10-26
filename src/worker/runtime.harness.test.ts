/**
 * Testes de integração no runtime Cloudflare via createTestHarness (Wrangler).
 * Exercitam D1, DO/SQLite, R2, Queue producer e WebSocket hibernável do harness F0.
 * Domínio de produto (auth, agenda, Meta) permanece fora de escopo (#15).
 */
import { readFileSync } from 'node:fs'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createTestHarness } from 'wrangler'
import { CLINIC_SCHEMA_VERSION } from '../clinic'
import { hashToken } from '../db/tokens'

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
      observability: true,
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
    expect(schema?.version).toBe(13)

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
    expect(schemaA).toEqual([{ version: CLINIC_SCHEMA_VERSION, status: 'ready' }])
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
    const drained = (await drain.json()) as { published: string[]; failed: string[] }
    expect(drained.failed).toEqual([])
    expect(drained.published).toContain(ingested.outboxId)
    expect(drained.published.length).toBeGreaterThanOrEqual(1)

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
        {
          tenantId: 'clinic-demo-a',
          name: 'Clínica Aurora (fictícia)',
          role: 'owner',
          status: 'active',
        },
        {
          tenantId: 'clinic-demo-b',
          name: 'Estúdio Horizonte (fictício)',
          role: 'attendant',
          status: 'active',
        },
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

  it('Platform Admin: criar tenant, suspender corta WS, exclusão lógica (#24)', async () => {
    const created = await worker.fetch('http://localhost/api/platform/tenants', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer synth:user_synth_superadmin',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        id: 'clinic-demo-rt-admin',
        name: 'Clínica Runtime Admin',
        ownerClerkUserId: 'user_synth_owner_a',
      }),
    })
    expect(created.status).toBe(201)

    const wsRes = await worker.fetch('http://localhost/api/tenants/clinic-demo-rt-admin/ws', {
      headers: {
        Authorization: 'Bearer synth:user_synth_owner_a',
        Upgrade: 'websocket',
      },
    })
    expect(wsRes.status).toBe(101)
    const socket = wsRes.webSocket
    expect(socket).toBeTruthy()
    socket!.accept()
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('hello timeout')), 5_000)
      socket!.addEventListener('message', () => {
        clearTimeout(timer)
        resolve()
      })
    })

    const revokedWait = new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('suspend revoke timeout')), 5_000)
      socket!.addEventListener('message', (event) => {
        const data = String(event.data)
        if (data.includes('access_revoked') || data.includes('tenant_not_active')) {
          clearTimeout(timer)
          resolve(data)
        }
      })
    })

    const suspended = await worker.fetch(
      'http://localhost/api/platform/tenants/clinic-demo-rt-admin/suspend',
      {
        method: 'POST',
        headers: { Authorization: 'Bearer synth:user_synth_superadmin' },
      },
    )
    expect(suspended.status).toBe(200)
    const susBody = (await suspended.json()) as { tenant: { status: string }; doNotified: boolean }
    expect(susBody.tenant.status).toBe('suspended')
    expect(susBody.doNotified).toBe(true)
    expect(JSON.parse(await revokedWait).type).toBe('access_revoked')

    await worker.fetch(
      'http://localhost/api/platform/tenants/clinic-demo-rt-admin/reactivate',
      {
        method: 'POST',
        headers: { Authorization: 'Bearer synth:user_synth_superadmin' },
      },
    )

    const deleted = await worker.fetch(
      'http://localhost/api/platform/tenants/clinic-demo-rt-admin',
      {
        method: 'DELETE',
        headers: { Authorization: 'Bearer synth:user_synth_superadmin' },
      },
    )
    expect(deleted.status).toBe(200)
    const delBody = (await deleted.json()) as {
      tenant: { status: string }
      deletionCommand: { status: string }
      workflow?: { started: boolean; reason?: string }
    }
    expect(delBody.tenant.status).toBe('pending_deletion')
    expect(delBody.deletionCommand.status).toBe('queued')
    // Binding TENANT_PURGE no harness — Workflow pode avançar em background.
    expect(delBody.workflow?.started).toBe(true)

    const env = await worker.getEnv()
    const cmd = (await env.DB.prepare(
      `SELECT status FROM tenant_deletion_commands WHERE tenant_id = ?`,
    )
      .bind('clinic-demo-rt-admin')
      .first()) as { status: string } | null
    expect(['queued', 'in_progress', 'completed']).toContain(cmd?.status)
  })

  it('C1: Clinic DO aceita tenant real tenant_<hex> e recusa ids fora do formato', async () => {
    const realId = 'tenant_0123456789abcdef01234567'
    for (const id of [realId, 'gistaine-sem-formato']) {
      const created = await worker.fetch('http://localhost/api/platform/tenants', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer synth:user_synth_superadmin',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ id, name: `Clínica ${id}`, ownerClerkUserId: 'user_synth_owner_a' }),
      })
      expect(created.status).toBe(201)
    }

    const ok = await worker.fetch(`http://localhost/api/tenants/${realId}/ws`, {
      headers: { Authorization: 'Bearer synth:user_synth_owner_a', Upgrade: 'websocket' },
    })
    expect(ok.status).toBe(101)
    ok.webSocket?.accept()
    ok.webSocket?.close()

    const inbox = await worker.fetch(`http://localhost/api/tenants/${realId}/inbox/conversations`, {
      headers: { Authorization: 'Bearer synth:user_synth_owner_a' },
    })
    expect(inbox.status).toBe(200)

    const bad = await worker.fetch('http://localhost/api/tenants/gistaine-sem-formato/ws', {
      headers: { Authorization: 'Bearer synth:user_synth_owner_a', Upgrade: 'websocket' },
    })
    expect(bad.status).toBe(403)
  })

  it('WS autenticado + revoke corta A e preserva B (#23)', async () => {
    async function openWs(tenantId: string, userId: string) {
      const response = await worker.fetch(`http://localhost/api/tenants/${tenantId}/ws`, {
        headers: {
          Authorization: `Bearer synth:${userId}`,
          Upgrade: 'websocket',
        },
      })
      expect(response.status).toBe(101)
      const socket = response.webSocket
      expect(socket).toBeTruthy()
      socket!.accept()
      const hello = await new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('hello timeout')), 5_000)
        socket!.addEventListener('message', (event) => {
          clearTimeout(timer)
          resolve(String(event.data))
        }, { once: true })
      })
      const parsed = JSON.parse(hello) as { type: string; tenantId: string }
      expect(parsed.type).toBe('hello')
      expect(parsed.tenantId).toBe(tenantId)
      return socket!
    }

    const wsA1 = await openWs('clinic-demo-a', 'user_synth_attendant_a')
    const wsA2 = await openWs('clinic-demo-a', 'user_synth_owner_a')
    const wsB = await openWs('clinic-demo-b', 'user_synth_multi')

    const waitMsg = (
      socket: { addEventListener: typeof EventTarget.prototype.addEventListener },
      timeoutMs = 5_000,
    ) =>
      new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('ws message timeout')), timeoutMs)
        socket.addEventListener(
          'message',
          (event) => {
            clearTimeout(timer)
            resolve(String((event as MessageEvent).data))
          },
          { once: true },
        )
      })

    const revokedA1 = waitMsg(wsA1)
    const nextA2 = waitMsg(wsA2)
    const nextB = waitMsg(wsB)

    const revoke = await worker.fetch(
      'http://localhost/api/tenants/clinic-demo-a/members/user_synth_attendant_a/revoke',
      {
        method: 'POST',
        headers: { Authorization: 'Bearer synth:user_synth_owner_a' },
      },
    )
    expect(revoke.status).toBe(200)
    const revokeBody = (await revoke.json()) as { status: string; doNotified: boolean }
    expect(revokeBody.status).toBe('revoked')
    expect(revokeBody.doNotified).toBe(true)

    const revokedMsg = JSON.parse(await revokedA1) as { type: string; reason: string }
    expect(revokedMsg.type).toBe('access_revoked')
    expect(revokedMsg.reason).toBe('membership_revoked')

    // Fan-out após revoke: A2 recebe; B não; A1 já revogado.
    const ingest = await worker.fetch('http://localhost/api/f1/clinic/clinic-demo-a/ingest', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        providerEventKey: 'wa:rt:after-revoke',
        waId: '5511999000555',
        body: 'pós-revogação',
        drain: false,
      }),
    })
    expect(ingest.status).toBe(200)

    const eventA2 = JSON.parse(await nextA2) as { type: string; eventType?: string }
    expect(eventA2.type).toBe('event')

    // B não deve receber evento de A — timeout esperado.
    await expect(Promise.race([
      nextB.then(() => 'got'),
      new Promise((r) => setTimeout(() => r('timeout'), 400)),
    ])).resolves.toBe('timeout')

    // Reconexão A com credencial antiga → 403.
    const reOpen = await worker.fetch('http://localhost/api/tenants/clinic-demo-a/ws', {
      headers: {
        Authorization: 'Bearer synth:user_synth_attendant_a',
        Upgrade: 'websocket',
      },
    })
    expect(reOpen.status).toBe(403)

    // B continua válido; Clerk do revogado ainda autentica /api/me.
    const me = await worker.fetch('http://localhost/api/me', {
      headers: { Authorization: 'Bearer synth:user_synth_attendant_a' },
    })
    expect(me.status).toBe(200)

    const bStill = await worker.fetch('http://localhost/api/tenants/clinic-demo-b/context', {
      headers: { Authorization: 'Bearer synth:user_synth_multi' },
    })
    expect(bStill.status).toBe(200)

    const catchUp = await worker.fetch(
      'http://localhost/api/tenants/clinic-demo-a/realtime/events?after=0',
      { headers: { Authorization: 'Bearer synth:user_synth_owner_a' } },
    )
    expect(catchUp.status).toBe(200)
    const eventsBody = (await catchUp.json()) as { events: unknown[]; eventSeq: number }
    expect(eventsBody.eventSeq).toBeGreaterThan(0)
    expect(eventsBody.events.length).toBeGreaterThan(0)

    wsA2.close(1000, 'done')
    wsB.close(1000, 'done')
  })

  it('authority unavailable não entrega payload; revalidate corta socket hibernado (#23)', async () => {
    const ws = await (async () => {
      const response = await worker.fetch('http://localhost/api/tenants/clinic-demo-a/ws', {
        headers: {
          Authorization: 'Bearer synth:user_synth_attendant_a',
          Upgrade: 'websocket',
        },
      })
      expect(response.status).toBe(101)
      const socket = response.webSocket!
      socket.accept()
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('hello timeout')), 5_000)
        socket.addEventListener('message', () => {
          clearTimeout(timer)
          resolve()
        }, { once: true })
      })
      return socket
    })()

    // Simula cache positivo antigo / autoridade indisponível no caminho de entrega.
    await worker.fetch('http://localhost/api/f1/clinic/clinic-demo-a/authority-override', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        grants: {
          'clinic-demo-a:user_synth_attendant_a': 'unavailable',
          'clinic-demo-a:user_synth_owner_a': 'owner',
        },
      }),
    })

    const noMsg = new Promise<string | 'timeout'>((resolve) => {
      const timer = setTimeout(() => resolve('timeout'), 400)
      ws.addEventListener(
        'message',
        (event) => {
          clearTimeout(timer)
          resolve(String(event.data))
        },
        { once: true },
      )
    })

    await worker.fetch('http://localhost/api/f1/clinic/clinic-demo-a/ingest', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        providerEventKey: 'wa:rt:unavailable',
        waId: '5511999000666',
        body: 'não deve chegar',
        drain: false,
      }),
    })
    expect(await noMsg).toBe('timeout')

    // Restaura authority e simula revalidação pós-hibernação com membership ainda ativo.
    await worker.fetch('http://localhost/api/f1/clinic/clinic-demo-a/authority-override', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ clear: true }),
    })

    const revalidated = await worker.fetch(
      'http://localhost/api/f1/clinic/clinic-demo-a/revalidate-sockets',
      { method: 'POST' },
    )
    expect(revalidated.status).toBe(200)
    await expect(revalidated.json()).resolves.toMatchObject({
      live: expect.any(Number),
    })

    // Override deny → revalidate deve revogar.
    await worker.fetch('http://localhost/api/f1/clinic/clinic-demo-a/authority-override', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        grants: { 'clinic-demo-a:user_synth_attendant_a': 'deny' },
      }),
    })
    const revokedWait = new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('revoke timeout')), 5_000)
      ws.addEventListener(
        'message',
        (event) => {
          clearTimeout(timer)
          resolve(String(event.data))
        },
        { once: true },
      )
    })
    const afterDeny = await worker.fetch(
      'http://localhost/api/f1/clinic/clinic-demo-a/revalidate-sockets',
      { method: 'POST' },
    )
    expect(afterDeny.status).toBe(200)
    const body = (await afterDeny.json()) as { revoked: number }
    expect(body.revoked).toBeGreaterThanOrEqual(1)
    expect(JSON.parse(await revokedWait).type).toBe('access_revoked')

    await worker.fetch('http://localhost/api/f1/clinic/clinic-demo-a/authority-override', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ clear: true }),
    })
  })

  it('convite D1 + aceite + remoção com barreira; B preservado (#25)', async () => {
    const env = await worker.getEnv()
    const now = Date.now()
    const rawToken = 'synth_invite_harness_token_0001'
    const tokenHash = await hashToken(rawToken)
    const invId = 'inv_harness_001'

    await env.DB.prepare(
      `INSERT INTO tenant_invitations (
        id, tenant_id, normalized_email, role, issued_by_clerk_user_id, token_hash,
        status, issued_at, expires_at, accepted_at, accepted_by_clerk_user_id,
        cancelled_at, cancelled_by_clerk_user_id, last_resent_at
      ) VALUES (?, 'clinic-demo-a', 'harness.invitee@example.test', 'attendant',
        'user_synth_owner_a', ?, 'pending', ?, ?, NULL, NULL, NULL, NULL, NULL)`,
    )
      .bind(invId, tokenHash, now, now + 7 * 24 * 60 * 60 * 1000)
      .run()

    const createHttp = await worker.fetch(
      'http://localhost/api/tenants/clinic-demo-a/invitations',
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer synth:user_synth_owner_a',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email: 'harness.owner.flow@example.test' }),
      },
    )
    expect(createHttp.status).toBe(201)
    const created = (await createHttp.json()) as {
      invitation: { id: string; email: string }
      emailSent: boolean
    }
    expect(created.invitation.email).toBe('harness.owner.flow@example.test')
    expect(JSON.stringify(created)).not.toMatch(/rawToken|token_hash/i)

    const team = await worker.fetch('http://localhost/api/tenants/clinic-demo-a/team', {
      headers: { Authorization: 'Bearer synth:user_synth_owner_a' },
    })
    expect(team.status).toBe(200)

    const accept = await worker.fetch('http://localhost/api/invitations/accept', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer synth:user_synth_harness_invitee',
        'Content-Type': 'application/json',
        'X-Synth-Verified-Email': 'harness.invitee@example.test',
      },
      body: JSON.stringify({ token: rawToken, role: 'owner', tenantId: 'clinic-demo-b' }),
    })
    expect(accept.status).toBe(200)

    const membership = await env.DB.prepare(
      `SELECT role, status FROM tenant_memberships
       WHERE tenant_id = 'clinic-demo-a' AND clerk_user_id = 'user_synth_harness_invitee'`,
    ).first() as { role: string; status: string } | null
    expect(membership).toEqual({ role: 'attendant', status: 'active' })

    // Membership multi em B intacto antes/depois da remoção do invitee em A.
    const multiBBefore = await env.DB.prepare(
      `SELECT status FROM tenant_memberships
       WHERE tenant_id = 'clinic-demo-b' AND clerk_user_id = 'user_synth_multi'`,
    ).first() as { status: string } | null
    expect(multiBBefore?.status).toBe('active')

    const revoke = await worker.fetch(
      'http://localhost/api/tenants/clinic-demo-a/members/user_synth_harness_invitee/revoke',
      {
        method: 'POST',
        headers: { Authorization: 'Bearer synth:user_synth_owner_a' },
      },
    )
    expect(revoke.status).toBe(200)

    const multiBAfter = await env.DB.prepare(
      `SELECT status FROM tenant_memberships
       WHERE tenant_id = 'clinic-demo-b' AND clerk_user_id = 'user_synth_multi'`,
    ).first() as { status: string } | null
    expect(multiBAfter?.status).toBe('active')

    const revoked = await env.DB.prepare(
      `SELECT status FROM tenant_memberships
       WHERE tenant_id = 'clinic-demo-a' AND clerk_user_id = 'user_synth_harness_invitee'`,
    ).first() as { status: string } | null
    expect(revoked?.status).toBe('revoked')
  })
})
