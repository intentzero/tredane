/**
 * STAGING-ONLY (Paulo, 2026-10-28): «Repor clínica ao estado inicial».
 * POST /api/tenants/:tenantId/staging/reset-operational-data  { confirmName }
 *
 * Guardas (servidor, nesta ordem):
 *  1. ENVIRONMENT === 'staging' estrito; qualquer outro valor ou ausente → 404 (antes da auth).
 *  2. Membership activo + papel owner (clinic.config.write); atendente → 403.
 *  3. confirmName tem de ser igual ao nome da clínica no D1 (tenantContext) → senão 400.
 * Apaga só dados operacionais do tenant no Clinic DO (uma transação) e audita
 * no DO (operational_audit) e no D1 (central_audit_events).
 */
import { Hono } from 'hono'
import { requireClinicPermission } from '../auth/authorize'
import {
  authErrorResponse,
  requireAuth,
  requireTenantAccess,
  type AuthEnv,
} from '../auth/middleware'
import { isAuthError } from '../auth/errors'
import { workerCaller, type ClinicCaller } from '../clinic'
import type { OperationalResetResult } from '../clinic/retention'
import { newId } from '../db/admin/ids'
import { systemClock } from '../db/clock'
import { isStagingEnv } from '../security/env-gate'
import type { WorkerBindings } from '../worker/bindings'

type ResetEnv = {
  Bindings: WorkerBindings
  Variables: AuthEnv['Variables']
}

export type ClinicResetGateway = {
  reset(caller: ClinicCaller): Promise<OperationalResetResult>
}

export type CentralResetAudit = (input: {
  actorClerkUserId: string
  tenantId: string
  result: OperationalResetResult
}) => Promise<void>

export type ClinicResetRouteOptions = {
  gatewayFactory?: (env: WorkerBindings, tenantId: string) => ClinicResetGateway
  centralAuditFactory?: (env: WorkerBindings) => CentralResetAudit
}

export const RESET_PATH = '/api/tenants/:tenantId/staging/reset-operational-data'

function doGateway(env: WorkerBindings, tenantId: string): ClinicResetGateway {
  const stub = env.CLINIC.get(env.CLINIC.idFromName(tenantId))
  return { reset: (caller) => stub.resetClinicOperationalData(caller) }
}

function d1CentralAudit(env: WorkerBindings): CentralResetAudit {
  return async ({ actorClerkUserId, tenantId, result }) => {
    await env.DB.prepare(
      `INSERT INTO central_audit_events (
        id, occurred_at, actor_clerk_user_id, subject_clerk_user_id, tenant_id,
        action, object_type, object_id, outcome, support_session_id, metadata_json
      ) VALUES (?, ?, ?, NULL, ?, 'clinic.operational_reset', 'tenant', ?, 'success', NULL, ?)`,
    )
      .bind(
        newId('aud'),
        systemClock.nowMs(),
        actorClerkUserId,
        tenantId,
        tenantId,
        JSON.stringify({
          environment: 'staging',
          deletedCounts: result.deletedCounts,
          totalDeleted: result.totalDeleted,
          clinicAuditId: result.auditId,
        }),
      )
      .run()
  }
}

export function createClinicResetRoutes(opts: ClinicResetRouteOptions = {}) {
  const app = new Hono<ResetEnv>()

  app.post(
    RESET_PATH,
    async (c, next) => {
      if (!isStagingEnv(c.env)) return c.json({ error: 'not_found' }, 404)
      await next()
    },
    requireAuth(),
    requireTenantAccess({ param: 'tenantId' }),
    async (c) => {
      try {
        const ctx = c.get('tenantContext')!
        requireClinicPermission(ctx, 'clinic.config.write')
        const principal = c.get('principal')!
        if (principal.kind !== 'human' || ctx.role !== 'owner') {
          return c.json({ error: 'permission_denied' }, 403)
        }
        const body = (await c.req.json().catch(() => ({}))) as { confirmName?: unknown }
        const confirmName = typeof body.confirmName === 'string' ? body.confirmName.trim() : ''
        if (!confirmName || confirmName !== ctx.tenantName.trim()) {
          return c.json(
            { error: 'confirm_name_mismatch', message: 'Escreva o nome exato da clínica.' },
            400,
          )
        }
        const gw = opts.gatewayFactory?.(c.env, ctx.tenantId) ?? doGateway(c.env, ctx.tenantId)
        const result = await gw.reset(workerCaller(ctx.tenantId, principal.clerkUserId))
        const audit = opts.centralAuditFactory?.(c.env) ?? d1CentralAudit(c.env)
        let centralAudit: 'ok' | 'failed' = 'ok'
        try {
          await audit({ actorClerkUserId: principal.clerkUserId, tenantId: ctx.tenantId, result })
        } catch {
          // A auditoria do DO já foi gravada na mesma transação do apagamento.
          centralAudit = 'failed'
        }
        c.header('Cache-Control', 'no-store')
        return c.json({ ok: true, ...result, centralAudit })
      } catch (err) {
        if (isAuthError(err)) return authErrorResponse(c, err)
        return c.json({ error: 'reset_failed' }, 500)
      }
    },
  )

  return app
}
