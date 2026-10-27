/**
 * STAGING-ONLY: cria/atualiza a clínica demo (backlog item 3).
 *
 *   POST /api/ops/demo-clinic/seed
 *   Authorization: Bearer <DEMO_SEED_TOKEN>
 *   { "ownerClerkUserId": "user_…", "ownerDisplayName"?: "…" }
 *
 * Gate triplo: ENVIRONMENT=staging, DEMO_SEED_ENABLED=true e secret
 * DEMO_SEED_TOKEN definido; fora disso responde 404. Só toca o tenant demo
 * fixo (`DEMO_CLINIC_TENANT_ID`) — nunca outro tenant. Idempotente.
 */
import { Hono } from 'hono'
import { workerCaller } from '../clinic'
import { DEMO_CLINIC_NAME, DEMO_CLINIC_TENANT_ID } from '../clinic/demo/ids'
import { d1CreateTenantWithOwner, d1GetTenant } from '../platform/d1-ops'
import type { WorkerBindings } from '../worker/bindings'

export function isDemoSeedEnabled(
  env: Pick<WorkerBindings, 'ENVIRONMENT' | 'DEMO_SEED_ENABLED' | 'DEMO_SEED_TOKEN'> | undefined,
): boolean {
  if (!env) return false
  if (env.ENVIRONMENT !== 'staging') return false
  if ((env.DEMO_SEED_ENABLED ?? '').trim().toLowerCase() !== 'true') return false
  return typeof env.DEMO_SEED_TOKEN === 'string' && env.DEMO_SEED_TOKEN.length >= 32
}

function safeEqual(a: string, b: string): boolean {
  const ae = new TextEncoder().encode(a)
  const be = new TextEncoder().encode(b)
  let diff = ae.length ^ be.length
  for (let i = 0; i < Math.max(ae.length, be.length); i++) diff |= (ae[i] ?? 0) ^ (be[i] ?? 0)
  return diff === 0
}

export function createDemoSeedRoutes() {
  const app = new Hono<{ Bindings: WorkerBindings }>()
  app.post('/api/ops/demo-clinic/seed', async (c) => {
    if (!isDemoSeedEnabled(c.env)) return c.json({ error: 'not_found' }, 404)
    const auth = c.req.header('Authorization') ?? ''
    const token = /^Bearer\s+(\S+)$/i.exec(auth.trim())?.[1] ?? ''
    if (!token || !safeEqual(token, c.env.DEMO_SEED_TOKEN!)) {
      return c.json({ error: 'unauthorized' }, 401)
    }
    const body = (await c.req.json().catch(() => ({}))) as {
      ownerClerkUserId?: string
      ownerDisplayName?: string
    }
    const ownerId = body.ownerClerkUserId?.trim() ?? ''
    if (!/^user_[A-Za-z0-9_]+$/.test(ownerId)) {
      return c.json({ error: 'owner_required' }, 400)
    }
    c.header('Cache-Control', 'no-store')
    try {
      let tenantCreated = false
      const existing = await d1GetTenant(c.env.DB, DEMO_CLINIC_TENANT_ID)
      if (!existing) {
        await d1CreateTenantWithOwner(c.env.DB, {
          id: DEMO_CLINIC_TENANT_ID,
          name: DEMO_CLINIC_NAME,
          timezone: 'America/Sao_Paulo',
          ownerClerkUserId: ownerId,
          actorClerkUserId: 'ops:demo-seed',
        })
        tenantCreated = true
      } else {
        await c.env.DB.prepare(
          `INSERT OR IGNORE INTO tenant_memberships (tenant_id, clerk_user_id, role, status, created_at, revoked_at)
           VALUES (?, ?, 'owner', 'active', ?, NULL)`,
        )
          .bind(DEMO_CLINIC_TENANT_ID, ownerId, Date.now())
          .run()
      }
      const stub = c.env.CLINIC.get(c.env.CLINIC.idFromName(DEMO_CLINIC_TENANT_ID))
      const seeded = await stub.seedDemoClinic(workerCaller(DEMO_CLINIC_TENANT_ID, ownerId), {
        ownerClerkUserId: ownerId,
        ownerDisplayName: body.ownerDisplayName?.trim() || undefined,
      })
      return c.json({ ok: true, tenantCreated, ...seeded })
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message.slice(0, 200) : 'seed_failed' }, 500)
    }
  })
  return app
}
