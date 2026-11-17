/**
 * STAGING-ONLY (Paulo, 2026-10-28 / 2026-11-16): ferramentas de reset do painel.
 * - POST /api/tenants/:tenantId/staging/reset-operational-data  { confirm: true }
 * - POST /api/tenants/:tenantId/staging/clear-appointments  { confirm: true }
 *
 * Guardas (servidor, nesta ordem):
 *  1. ENVIRONMENT === 'staging' estrito; qualquer outro valor ou ausente → 404 (antes da auth).
 *  2. Membership activo + papel owner (clinic.config.write); atendente → 403.
 *  3. Corpo deve incluir confirm: true (confirmação no modal do painel) → senão 400.
 * Apaga só dados do tenant no Clinic DO (uma transação) e audita
 * no DO (operational_audit) e no D1 (central_audit_events).
 */
import { Hono } from 'hono'
import type { Context } from 'hono'
import { requireClinicPermission } from '../auth/authorize'
import {
  authErrorResponse,
  requireAuth,
  requireTenantAccess,
  type AuthEnv,
} from '../auth/middleware'
import { isAuthError } from '../auth/errors'
import { workerCaller, type ClinicCaller } from '../clinic'
import type { ClearAppointmentsResult, OperationalResetResult } from '../clinic/retention'
import { newId } from '../db/admin/ids'
import { systemClock } from '../db/clock'
import { isStagingEnv } from '../security/env-gate'
import type { WorkerBindings } from '../worker/bindings'

import { clinicDurableObjectName } from '../clinic/demo/do-name'
type ResetEnv = {
  Bindings: WorkerBindings
  Variables: AuthEnv['Variables']
}

export type ClinicResetGateway = {
  reset(caller: ClinicCaller): Promise<OperationalResetResult>
  clearAppointments(caller: ClinicCaller): Promise<ClearAppointmentsResult>
}

export type CentralResetAudit = (input: {
  actorClerkUserId: string
  tenantId: string
  action: 'clinic.operational_reset' | 'clinic.appointments_cleared'
  result: OperationalResetResult | ClearAppointmentsResult
}) => Promise<void>

export type ClinicResetRouteOptions = {
  gatewayFactory?: (env: WorkerBindings, tenantId: string) => ClinicResetGateway
  centralAuditFactory?: (env: WorkerBindings) => CentralResetAudit
}

export const RESET_PATH = '/api/tenants/:tenantId/staging/reset-operational-data'
export const CLEAR_APPOINTMENTS_PATH = '/api/tenants/:tenantId/staging/clear-appointments'

function doGateway(env: WorkerBindings, tenantId: string): ClinicResetGateway {
  const stub = env.CLINIC.get(env.CLINIC.idFromName(clinicDurableObjectName(tenantId)))
  return {
    reset: (caller) => stub.resetClinicOperationalData(caller),
    clearAppointments: (caller) => stub.clearClinicAppointments(caller),
  }
}

function d1CentralAudit(env: WorkerBindings): CentralResetAudit {
  return async ({ actorClerkUserId, tenantId, action, result }) => {
    await env.DB.prepare(
      `INSERT INTO central_audit_events (
        id, occurred_at, actor_clerk_user_id, subject_clerk_user_id, tenant_id,
        action, object_type, object_id, outcome, support_session_id, metadata_json
      ) VALUES (?, ?, ?, NULL, ?, ?, 'tenant', ?, 'success', NULL, ?)`,
    )
      .bind(
        newId('aud'),
        systemClock.nowMs(),
        actorClerkUserId,
        tenantId,
        action,
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

type OwnerGateOk = {
  ok: true
  tenantId: string
  clerkUserId: string
}
type OwnerGateFail = { ok: false; response: Response }

async function gateOwnerConfirmed(c: Context<ResetEnv>): Promise<OwnerGateOk | OwnerGateFail> {
  const ctx = c.get('tenantContext')!
  requireClinicPermission(ctx, 'clinic.config.write')
  const principal = c.get('principal')!
  if (principal.kind !== 'human' || ctx.role !== 'owner') {
    return { ok: false, response: c.json({ error: 'permission_denied' }, 403) }
  }
  const body = (await c.req.json().catch(() => ({}))) as { confirm?: unknown }
  if (body.confirm !== true) {
    return {
      ok: false,
      response: c.json(
        { error: 'confirm_required', message: 'Envie confirm: true após confirmação no painel.' },
        400,
      ),
    }
  }
  return { ok: true, tenantId: ctx.tenantId, clerkUserId: principal.clerkUserId }
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
        const gate = await gateOwnerConfirmed(c)
        if (!gate.ok) return gate.response
        const gw = opts.gatewayFactory?.(c.env, gate.tenantId) ?? doGateway(c.env, gate.tenantId)
        const result = await gw.reset(workerCaller(gate.tenantId, gate.clerkUserId))
        const audit = opts.centralAuditFactory?.(c.env) ?? d1CentralAudit(c.env)
        let centralAudit: 'ok' | 'failed' = 'ok'
        try {
          await audit({
            actorClerkUserId: gate.clerkUserId,
            tenantId: gate.tenantId,
            action: 'clinic.operational_reset',
            result,
          })
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

  app.post(
    CLEAR_APPOINTMENTS_PATH,
    async (c, next) => {
      if (!isStagingEnv(c.env)) return c.json({ error: 'not_found' }, 404)
      await next()
    },
    requireAuth(),
    requireTenantAccess({ param: 'tenantId' }),
    async (c) => {
      try {
        const gate = await gateOwnerConfirmed(c)
        if (!gate.ok) return gate.response
        const gw = opts.gatewayFactory?.(c.env, gate.tenantId) ?? doGateway(c.env, gate.tenantId)
        const result = await gw.clearAppointments(workerCaller(gate.tenantId, gate.clerkUserId))
        const audit = opts.centralAuditFactory?.(c.env) ?? d1CentralAudit(c.env)
        let centralAudit: 'ok' | 'failed' = 'ok'
        try {
          await audit({
            actorClerkUserId: gate.clerkUserId,
            tenantId: gate.tenantId,
            action: 'clinic.appointments_cleared',
            result,
          })
        } catch {
          centralAudit = 'failed'
        }
        c.header('Cache-Control', 'no-store')
        return c.json({ ok: true, ...result, centralAudit })
      } catch (err) {
        if (isAuthError(err)) return authErrorResponse(c, err)
        return c.json({ error: 'clear_appointments_failed' }, 500)
      }
    },
  )

  return app
}
