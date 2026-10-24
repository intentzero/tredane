/**
 * Rotas de observabilidade / ensaio F6 (#44).
 * Harness sintético + leitura superadmin; sem PII.
 */
import { Hono } from 'hono'
import {
  authErrorResponse,
  requireAuth,
  requireSuperadmin,
  type AuthEnv,
} from '../auth/middleware'
import { isAuthError } from '../auth/errors'
import { SYNTHETIC_TENANT_PREFIX, workerCaller } from '../clinic'
import { ADMIN_SCHEMA_VERSION } from '../db/admin/constants'
import type { AdminDb } from '../db/admin/store'
import type { WorkerBindings } from '../worker/bindings'
import {
  emitOpsAlert,
  evaluateOpsSignals,
  OPS_ALERT_KINDS,
  type OpsSignalSnapshot,
} from './alerts'
import { PROPOSED_OPS_BUDGETS } from './budgets'
import {
  buildSyntheticLoadReport,
  measureDurationsMs,
  type OpsClinicSnapshot,
} from './metrics'
import {
  assertLogLineSafe,
  createChannelLogger,
  emitOpsLog,
  formatOpsLogLine,
  newCorrelationId,
  scrubLogDetail,
} from './log'
import {
  buildRecoveryRehearsalReport,
  RECOVERY_POLICY,
} from './recovery'
import { SECRETS_INVENTORY } from './secrets'

type OpsEnv = {
  Bindings: WorkerBindings
  Variables: AuthEnv['Variables']
}

export type OpsClinicStub = {
  getOpsSnapshot: (
    caller: ReturnType<typeof workerCaller>,
  ) => Promise<OpsClinicSnapshot & { eventSeq?: number }>
  ping: (
    tenantId: string,
  ) => Promise<{ ok: true; tenantId: string; value: string }>
}

export type OpsRouteOptions = {
  syncAdminDbFactory?: (env: WorkerBindings) => AdminDb | null
  clinicStubFactory?: (
    env: WorkerBindings,
    tenantId: string,
  ) => OpsClinicStub
  attachmentsBucketFactory?: (env: WorkerBindings) => R2Bucket | null
}

function opsError(
  c: { json: (body: unknown, status?: number) => Response },
  err: unknown,
): Response {
  if (isAuthError(err)) return authErrorResponse(c, err)
  return c.json(
    { error: err instanceof Error ? err.message : 'ops_error' },
    400,
  )
}

function defaultClinicStub(
  env: WorkerBindings,
  tenantId: string,
): OpsClinicStub {
  const id = env.CLINIC.idFromName(tenantId)
  const stub = env.CLINIC.get(id)
  return {
    getOpsSnapshot: (caller) => stub.getOpsSnapshot(caller),
    ping: (tid) => stub.ping(tid),
  }
}

async function readAdminSchemaVersion(
  env: WorkerBindings,
  syncAdminDbFactory?: OpsRouteOptions['syncAdminDbFactory'],
): Promise<number | null> {
  if (syncAdminDbFactory) {
    const db = syncAdminDbFactory(env)
    if (!db) return null
    return (
      db.get<{ version: number }>(
        'SELECT version FROM admin_schema_state WHERE id = 1',
      )?.version ?? null
    )
  }
  const row = await env.DB.prepare(
    'SELECT version FROM admin_schema_state WHERE id = 1',
  ).first<{ version: number }>()
  return row?.version ?? null
}

async function r2PrefixCoherent(
  bucket: R2Bucket | null,
  tenantId: string,
): Promise<boolean> {
  if (!bucket) return true
  try {
    const listed = await bucket.list({
      prefix: `tenants/${tenantId}/attachments/`,
      limit: 1,
    })
    return Array.isArray(listed.objects)
  } catch {
    return false
  }
}

export function createOpsRoutes(opts: OpsRouteOptions = {}) {
  const app = new Hono<OpsEnv>()
  const clinicFactory = opts.clinicStubFactory ?? defaultClinicStub

  /** Catálogo público de budgets Propostos + kinds de alerta (sem auth). */
  app.get('/api/f6/ops/catalog', (c) => {
    c.header('Cache-Control', 'no-store')
    return c.json({
      budgets: PROPOSED_OPS_BUDGETS,
      alertKinds: OPS_ALERT_KINDS,
      recoveryPolicy: RECOVERY_POLICY,
      adminSchemaExpected: ADMIN_SCHEMA_VERSION,
      logRetention: {
        status: 'em_aberto',
        policy:
          'Logs técnicos sem PII; retenção/acesso Cloudflare a acordar (REQ-070 / GATE logs)',
      },
    })
  })

  /** Inventário de secrets (nomes apenas) — superadmin. */
  app.get(
    '/api/f6/ops/secrets-inventory',
    requireSuperadmin(),
    (c) => {
      return c.json({
        items: SECRETS_INVENTORY,
        note: 'Sem valores; configurar via wrangler secret / dashboard',
      })
    },
  )

  /** Snapshot + avaliação de alertas para clínica sintética. */
  app.get(
    '/api/f6/ops/tenants/:tenantId/snapshot',
    requireAuth(),
    async (c) => {
      try {
        const principal = c.get('principal')
        const tenantId = c.req.param('tenantId')
        if (
          !tenantId.startsWith(SYNTHETIC_TENANT_PREFIX) &&
          !principal.isSuperadmin
        ) {
          return c.json({ error: 'forbidden' }, 403)
        }
        const stub = clinicFactory(c.env, tenantId)
        const snap = await stub.getOpsSnapshot(workerCaller(tenantId))
        const signals: OpsSignalSnapshot = {
          staleOutboxCount: snap.pendingOutbox,
          uncertainOutboundCount: snap.uncertainOutbound,
          schemaMismatch: !snap.schemaReady,
        }
        const alerts = evaluateOpsSignals(signals)
        const correlationId = newCorrelationId('snap')
        emitOpsLog({
          level: 'info',
          channel: 'ops',
          event: 'ops.snapshot',
          correlationId,
          tenantId,
          operation: 'ops.snapshot',
          outcome: 'ok',
          detail: {
            pendingOutbox: snap.pendingOutbox,
            uncertainOutbound: snap.uncertainOutbound,
            alertCount: alerts.length,
          },
        })
        return c.json({ correlationId, snapshot: snap, alerts })
      } catch (err) {
        return opsError(c, err)
      }
    },
  )

  /** Injecta alerta sintético (harness) — só clinic-demo-*. */
  app.post('/api/f6/ops/alerts/inject', requireAuth(), async (c) => {
    try {
      const body = await c.req.json<{
        kind: (typeof OPS_ALERT_KINDS)[number]
        tenantId?: string
        fields?: Record<string, unknown>
      }>()
      const tenantId = body.tenantId ?? 'clinic-demo-a'
      if (!tenantId.startsWith(SYNTHETIC_TENANT_PREFIX)) {
        return c.json({ error: 'synthetic_tenants_only' }, 400)
      }
      if (!OPS_ALERT_KINDS.includes(body.kind)) {
        return c.json({ error: 'unknown_alert_kind' }, 400)
      }
      const emitted = emitOpsAlert({
        kind: body.kind,
        tenantId,
        operation: 'ops.alert.inject',
        fields: scrubLogDetail(body.fields),
      })
      return c.json({ ok: true, ...emitted, kind: body.kind })
    } catch (err) {
      return opsError(c, err)
    }
  })

  /** Prova que o formatter remove PII (AC-15). */
  app.post('/api/f6/ops/log/scrub-check', requireAuth(), async (c) => {
    try {
      const body = await c.req.json<{
        detail?: Record<string, unknown>
      }>()
      const unsafe = {
        tenantId: 'clinic-demo-a',
        body: 'mensagem pessoal fictícia',
        waId: '5511999999999',
        token: 'sk_test_fake',
        stage: 'reconcile',
        ...(body.detail ?? {}),
      }
      const line = formatOpsLogLine({
        level: 'info',
        channel: 'ops',
        event: 'ops.scrub_check',
        detail: unsafe,
      })
      const check = assertLogLineSafe(line)
      return c.json({
        line,
        scrubbed: scrubLogDetail(unsafe),
        safe: check.ok,
        reasons: check.reasons,
      })
    } catch (err) {
      return opsError(c, err)
    }
  })

  /** Carga sintética: ping DO N vezes + snapshots A/B. */
  app.post('/api/f6/ops/load', requireAuth(), async (c) => {
    try {
      let iterations = 8
      try {
        const body = await c.req.json<{ iterations?: number }>()
        if (typeof body.iterations === 'number') {
          iterations = Math.min(Math.max(body.iterations, 3), 40)
        }
      } catch {
        /* body vazio */
      }
      const tenants = ['clinic-demo-a', 'clinic-demo-b'] as const
      const samples = []
      for (const tenantId of tenants) {
        const stub = clinicFactory(c.env, tenantId)
        samples.push(
          await measureDurationsMs(`do.ping`, iterations, async () => {
            await stub.ping(tenantId)
          }),
        )
      }
      const clinicSnapshots: OpsClinicSnapshot[] = []
      for (const tenantId of tenants) {
        const stub = clinicFactory(c.env, tenantId)
        const snap = await stub.getOpsSnapshot(workerCaller(tenantId))
        clinicSnapshots.push({
          tenantId: snap.tenantId,
          schemaVersion: snap.schemaVersion,
          schemaReady: snap.schemaReady,
          pendingOutbox: snap.pendingOutbox,
          failedOutbox: snap.failedOutbox,
          uncertainOutbound: snap.uncertainOutbound,
          contactCount: snap.contactCount,
          messageCount: snap.messageCount,
          appointmentCount: snap.appointmentCount,
          attachmentMetaCount: snap.attachmentMetaCount,
        })
      }
      const report = buildSyntheticLoadReport({ samples, clinicSnapshots })
      emitOpsLog({
        level: 'info',
        channel: 'ops',
        event: 'ops.synthetic_load',
        operation: 'ops.load',
        outcome: report.withinProposedBudgets ? 'within_budget' : 'over_budget',
        detail: {
          iterations,
          sampleCount: samples.length,
          withinProposedBudgets: report.withinProposedBudgets,
        },
      })
      return c.json(report)
    } catch (err) {
      return opsError(c, err)
    }
  })

  /**
   * Ensaio de recuperação: lê snapshots A/B, confirma schema + isolamento
   * (sem PITR live — documentado Em aberto).
   */
  app.post('/api/f6/ops/recovery/rehearse', requireAuth(), async (c) => {
    try {
      const tenantA = 'clinic-demo-a'
      const tenantB = 'clinic-demo-b'
      const stubA = clinicFactory(c.env, tenantA)
      const stubB = clinicFactory(c.env, tenantB)
      const beforeB = await stubB.getOpsSnapshot(workerCaller(tenantB))
      const snapA = await stubA.getOpsSnapshot(workerCaller(tenantA))
      await stubA.ping(tenantA)
      const afterB = await stubB.getOpsSnapshot(workerCaller(tenantB))
      const adminVersion = await readAdminSchemaVersion(
        c.env,
        opts.syncAdminDbFactory,
      )
      const bucket =
        opts.attachmentsBucketFactory?.(c.env) ?? c.env.ATTACHMENTS ?? null
      const r2Ok = await r2PrefixCoherent(bucket, tenantA)
      const counts = (s: OpsClinicSnapshot & { eventSeq?: number }) => ({
        contacts: s.contactCount,
        messages: s.messageCount,
        appointments: s.appointmentCount,
        pendingOutbox: s.pendingOutbox,
        attachments: s.attachmentMetaCount,
      })
      const report = buildRecoveryRehearsalReport({
        tenantA,
        tenantB,
        adminSchemaVersion: adminVersion,
        clinicSchemaVersionA: snapA.schemaVersion,
        r2PrefixOk: r2Ok,
        tenantBBefore: counts(beforeB),
        tenantBAfter: counts(afterB),
        emitAlertOnBreach: true,
      })
      return c.json({
        ok: report.isolationOk && report.schema.compatible,
        report,
        policy: RECOVERY_POLICY,
      })
    } catch (err) {
      return opsError(c, err)
    }
  })

  /** Smoke técnico pós-migrate (sintético). */
  app.get('/api/f6/ops/smoke', requireAuth(), async (c) => {
    try {
      const adminVersion = await readAdminSchemaVersion(
        c.env,
        opts.syncAdminDbFactory,
      )
      const a = await clinicFactory(c.env, 'clinic-demo-a').getOpsSnapshot(
        workerCaller('clinic-demo-a'),
      )
      const b = await clinicFactory(c.env, 'clinic-demo-b').getOpsSnapshot(
        workerCaller('clinic-demo-b'),
      )
      const checks = [
        {
          id: 'admin_schema',
          ok: adminVersion === ADMIN_SCHEMA_VERSION,
          detail: { adminVersion, expected: ADMIN_SCHEMA_VERSION },
        },
        {
          id: 'clinic_a_schema',
          ok: a.schemaReady,
          detail: { version: a.schemaVersion },
        },
        {
          id: 'clinic_b_schema',
          ok: b.schemaReady,
          detail: { version: b.schemaVersion },
        },
        {
          id: 'isolation_distinct_tenants',
          ok: a.tenantId !== b.tenantId,
          detail: { a: a.tenantId, b: b.tenantId },
        },
        {
          id: 'deploy_guard_documented',
          ok: true,
          detail: {
            environment: c.env.ENVIRONMENT ?? 'development',
            note:
              'Staging/prod: `npm run check:env -- staging|production` recusa D1 placeholder antes do deploy',
          },
        },
      ]
      const ok = checks.every((ch) => ch.ok)
      return c.json({ ok, checks, correlationId: newCorrelationId('smoke') })
    } catch (err) {
      return opsError(c, err)
    }
  })

  return app
}

/** Reexport helper para testes que montam logger de canal. */
export { createChannelLogger }
