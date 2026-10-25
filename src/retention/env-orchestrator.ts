/**
 * Avanço de expurgo via bindings do Worker (D1 async + DO + R2).
 * Usado pelo Cloudflare Workflow; a máquina sync (`tickTenantPurge`) permanece
 * para CI/unit com node:sqlite.
 */
import { newId } from '../db/admin/ids'
import { systemClock } from '../db/clock'
import { workerCaller } from '../clinic'
import { purgeAlertAt, purgeDeadlineAt } from './policy'
import { purgeTenantR2Prefix } from './r2-purge'
import {
  isTerminalPurgeStep,
  nextPurgeStep,
  TENANT_PURGE_STEPS,
  type TenantPurgeStep,
} from './steps'
import type { TenantPurgeWorkflowParams } from './workflow-params'
import type { WorkerBindings } from '../worker/bindings'

type PurgeCmd = {
  id: string
  tenant_id: string
  status: string
  requested_by_clerk_user_id: string
  requested_at: number
  updated_at: number
  payload_json: string | null
  deadline_at: number | null
  started_at: number | null
  completed_at: number | null
  last_step: string | null
  last_error: string | null
  alert_sent_at: number | null
}

const SELECT_COLS = `id, tenant_id, status, requested_by_clerk_user_id, requested_at, updated_at,
  payload_json, deadline_at, started_at, completed_at, last_step, last_error, alert_sent_at`

async function writeAuditD1(
  db: D1Database,
  input: {
    actorClerkUserId: string
    tenantId: string
    action: string
    objectType: string
    objectId: string
    outcome: 'success' | 'error'
    metadata?: Record<string, unknown>
  },
): Promise<void> {
  const now = systemClock.nowMs()
  await db
    .prepare(
      `INSERT INTO central_audit_events (
        id, occurred_at, actor_clerk_user_id, subject_clerk_user_id, tenant_id,
        action, object_type, object_id, outcome, support_session_id, metadata_json
      ) VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, NULL, ?)`,
    )
    .bind(
      newId('aud'),
      now,
      input.actorClerkUserId,
      input.tenantId,
      input.action,
      input.objectType,
      input.objectId,
      input.outcome,
      input.metadata ? JSON.stringify(input.metadata) : null,
    )
    .run()
}

async function getCommand(
  db: D1Database,
  commandId: string,
): Promise<PurgeCmd | null> {
  return (
    (await db
      .prepare(`SELECT ${SELECT_COLS} FROM tenant_deletion_commands WHERE id = ?`)
      .bind(commandId)
      .first<PurgeCmd>()) ?? null
  )
}

async function ensureDeadline(db: D1Database, cmd: PurgeCmd): Promise<PurgeCmd> {
  if (cmd.deadline_at != null) return cmd
  const tenant = await db
    .prepare(`SELECT pending_deletion_at FROM tenants WHERE id = ?`)
    .bind(cmd.tenant_id)
    .first<{ pending_deletion_at: number | null }>()
  const base = tenant?.pending_deletion_at ?? cmd.requested_at
  const deadline = purgeDeadlineAt(base)
  const now = systemClock.nowMs()
  await db
    .prepare(
      `UPDATE tenant_deletion_commands
       SET deadline_at = ?, updated_at = ?
       WHERE id = ? AND deadline_at IS NULL`,
    )
    .bind(deadline, now, cmd.id)
    .run()
  return (await getCommand(db, cmd.id))!
}

async function markStep(
  db: D1Database,
  cmd: PurgeCmd,
  step: TenantPurgeStep,
  actorClerkUserId: string,
  extra?: Record<string, unknown>,
  error?: string | null,
): Promise<PurgeCmd> {
  const now = systemClock.nowMs()
  let payload: Record<string, unknown> = cmd.payload_json
    ? (JSON.parse(cmd.payload_json) as Record<string, unknown>)
    : {}
  if (extra) payload = { ...payload, ...extra }
  const status =
    step === 'completed'
      ? 'completed'
      : cmd.status === 'queued'
        ? 'in_progress'
        : cmd.status
  const startedAt =
    cmd.started_at ?? (status === 'in_progress' || status === 'completed' ? now : null)
  const completedAt = step === 'completed' ? now : cmd.completed_at
  await db
    .prepare(
      `UPDATE tenant_deletion_commands
       SET status = ?, last_step = ?, last_error = ?, updated_at = ?,
           started_at = COALESCE(started_at, ?), completed_at = ?,
           payload_json = ?
       WHERE id = ?`,
    )
    .bind(
      status,
      step,
      error ?? null,
      now,
      startedAt,
      completedAt,
      JSON.stringify(payload),
      cmd.id,
    )
    .run()
  await writeAuditD1(db, {
    actorClerkUserId,
    tenantId: cmd.tenant_id,
    action: 'tenant.purge.step',
    objectType: 'tenant_deletion_command',
    objectId: cmd.id,
    outcome: error ? 'error' : 'success',
    metadata: { step, status },
  })
  return (await getCommand(db, cmd.id))!
}

async function maybeAlert(
  db: D1Database,
  cmd: PurgeCmd,
  actorClerkUserId: string,
): Promise<{ alerted: boolean; overdue: boolean }> {
  const withDeadline = await ensureDeadline(db, cmd)
  if (!withDeadline.deadline_at || isTerminalPurgeStep(withDeadline.last_step)) {
    return { alerted: false, overdue: false }
  }
  const now = systemClock.nowMs()
  const overdue = now > withDeadline.deadline_at
  const shouldAlert = overdue || now >= purgeAlertAt(withDeadline.deadline_at)
  if (!shouldAlert || withDeadline.alert_sent_at != null) {
    return { alerted: false, overdue }
  }
  await db
    .prepare(
      `UPDATE tenant_deletion_commands SET alert_sent_at = ?, updated_at = ? WHERE id = ?`,
    )
    .bind(now, now, withDeadline.id)
    .run()
  await writeAuditD1(db, {
    actorClerkUserId,
    tenantId: withDeadline.tenant_id,
    action: 'tenant.purge.deadline_alert',
    objectType: 'tenant_deletion_command',
    objectId: withDeadline.id,
    outcome: 'success',
    metadata: {
      deadlineAt: withDeadline.deadline_at,
      overdue,
      lastStep: withDeadline.last_step,
    },
  })
  return { alerted: true, overdue }
}

function resolveStep(cmd: PurgeCmd): TenantPurgeStep | null {
  if (cmd.status === 'completed' || cmd.status === 'cancelled') return null
  return nextPurgeStep(cmd.last_step ?? (cmd.status === 'queued' ? 'queued' : null))
}

export type EnvPurgeTickResult = {
  stepped: TenantPurgeStep | null
  done: boolean
  alerted: boolean
  overdue: boolean
  lastStep: string | null
  status: string
  detail: Record<string, unknown>
}

/**
 * Um tick (= um passo) usando D1/DO/R2 do env.
 * Idempotente: se o passo já foi aplicado, devolve o estado actual.
 */
export async function tickTenantPurgeOnEnv(
  env: WorkerBindings,
  params: TenantPurgeWorkflowParams,
): Promise<EnvPurgeTickResult> {
  const db = env.DB
  let cmd = await getCommand(db, params.commandId)
  if (!cmd) {
    throw new Error('deletion_command_not_found')
  }
  if (cmd.tenant_id !== params.tenantId) {
    throw new Error('tenant_mismatch')
  }

  cmd = await ensureDeadline(db, cmd)
  const alert = await maybeAlert(db, cmd, params.actorClerkUserId)
  const step = resolveStep(cmd)
  if (!step) {
    return {
      stepped: null,
      done: cmd.status === 'completed',
      alerted: alert.alerted,
      overdue: alert.overdue,
      lastStep: cmd.last_step,
      status: cmd.status,
      detail: {},
    }
  }

  try {
    const detail = await runEnvStep(env, cmd, step, params.actorClerkUserId)
    const next = await getCommand(db, params.commandId)
    return {
      stepped: step,
      done: step === 'completed',
      alerted: alert.alerted,
      overdue: alert.overdue,
      lastStep: next?.last_step ?? step,
      status: next?.status ?? cmd.status,
      detail,
    }
  } catch (err) {
    // Não avançar last_step — o Workflow faz retry do mesmo passo.
    const message = err instanceof Error ? err.message : 'purge_step_failed'
    const now = systemClock.nowMs()
    await db
      .prepare(
        `UPDATE tenant_deletion_commands
         SET last_error = ?, updated_at = ?, status = 'in_progress'
         WHERE id = ?`,
      )
      .bind(message, now, cmd.id)
      .run()
    await writeAuditD1(db, {
      actorClerkUserId: params.actorClerkUserId,
      tenantId: params.tenantId,
      action: 'tenant.purge.step',
      objectType: 'tenant_deletion_command',
      objectId: cmd.id,
      outcome: 'error',
      metadata: { step, status: 'in_progress' },
    })
    throw err
  }
}

async function runEnvStep(
  env: WorkerBindings,
  cmd: PurgeCmd,
  step: TenantPurgeStep,
  actorClerkUserId: string,
): Promise<Record<string, unknown>> {
  const db = env.DB
  const tenantId = cmd.tenant_id

  switch (step) {
    case 'claim': {
      const ensured = await ensureDeadline(db, cmd)
      await markStep(
        db,
        ensured,
        'claim',
        actorClerkUserId,
        { deadlineAt: ensured.deadline_at },
      )
      // Forçar status in_progress no claim
      await db
        .prepare(
          `UPDATE tenant_deletion_commands SET status = 'in_progress' WHERE id = ? AND status = 'queued'`,
        )
        .bind(cmd.id)
        .run()
      return { claimed: true }
    }
    case 'integrations_frozen': {
      const binding = await db
        .prepare(
          `SELECT id, phone_number_id FROM whatsapp_phone_bindings
           WHERE tenant_id = ? AND status IN ('active', 'interrupted') LIMIT 1`,
        )
        .bind(tenantId)
        .first<{ id: string; phone_number_id: string }>()
      let whatsappReleased = false
      if (binding) {
        const now = systemClock.nowMs()
        await db
          .prepare(
            `UPDATE whatsapp_phone_bindings
             SET status = 'released', released_at = ?, released_by_clerk_user_id = ?, updated_at = ?
             WHERE id = ? AND status IN ('active', 'interrupted')`,
          )
          .bind(now, actorClerkUserId, now, binding.id)
          .run()
        await db
          .prepare(`DELETE FROM whatsapp_credentials WHERE binding_id = ?`)
          .bind(binding.id)
          .run()
        whatsappReleased = true
        await writeAuditD1(db, {
          actorClerkUserId,
          tenantId,
          action: 'whatsapp.disconnected',
          objectType: 'whatsapp_binding',
          objectId: binding.id,
          outcome: 'success',
          metadata: { phoneNumberId: binding.phone_number_id, source: 'tenant_purge' },
        })
      }
      await markStep(db, cmd, step, actorClerkUserId, { whatsappReleased })
      return { whatsappReleased }
    }
    case 'push_cleared': {
      const result = await db
        .prepare(`DELETE FROM push_subscriptions WHERE tenant_id = ?`)
        .bind(tenantId)
        .run()
      const pushDeleted = result.meta.changes ?? 0
      await markStep(db, cmd, step, actorClerkUserId, { pushDeleted })
      return { pushDeleted }
    }
    case 'r2_prefix_cleared': {
      let r2DeletedKeys = 0
      if (env.ATTACHMENTS) {
        const r = await purgeTenantR2Prefix(env.ATTACHMENTS, tenantId)
        r2DeletedKeys = r.deletedKeys
      }
      await markStep(db, cmd, step, actorClerkUserId, { r2DeletedKeys })
      return { r2DeletedKeys }
    }
    case 'clinic_sqlite_wiped': {
      const stub = env.CLINIC.get(env.CLINIC.idFromName(tenantId))
      const wipe = await stub.wipeClinicOperationalData(
        workerCaller(tenantId, actorClerkUserId),
      )
      await markStep(db, cmd, step, actorClerkUserId, {
        alreadyWiped: wipe.alreadyWiped ?? false,
        openFinancialBeforeWipe: wipe.openFinancialBeforeWipe ?? 0,
      })
      return {
        alreadyWiped: wipe.alreadyWiped ?? false,
        openFinancialBeforeWipe: wipe.openFinancialBeforeWipe ?? 0,
      }
    }
    case 'd1_scrubbed': {
      const now = systemClock.nowMs()
      const memberships = await db
        .prepare(
          `UPDATE tenant_memberships
           SET status = 'revoked', revoked_at = ?
           WHERE tenant_id = ? AND status = 'active'`,
        )
        .bind(now, tenantId)
        .run()
      const invites = await db
        .prepare(
          `UPDATE tenant_invitations
           SET status = 'cancelled', cancelled_at = ?
           WHERE tenant_id = ? AND status = 'pending'`,
        )
        .bind(now, tenantId)
        .run()
      let whatsapp = 0
      let pix = 0
      try {
        const w = await db
          .prepare(
            `UPDATE whatsapp_webhook_receipts
             SET detail_json = NULL
             WHERE tenant_id = ? AND detail_json IS NOT NULL`,
          )
          .bind(tenantId)
          .run()
        whatsapp = w.meta.changes ?? 0
      } catch {
        /* tabela pode não existir em schemas antigos */
      }
      try {
        const p = await db
          .prepare(
            `UPDATE pix_webhook_receipts
             SET detail_json = NULL
             WHERE tenant_id = ? AND detail_json IS NOT NULL`,
          )
          .bind(tenantId)
          .run()
        pix = p.meta.changes ?? 0
      } catch {
        /* ignore */
      }
      const detail = {
        memberships: memberships.meta.changes ?? 0,
        invites: invites.meta.changes ?? 0,
        scrubbed: { whatsapp, pix },
      }
      await markStep(db, cmd, step, actorClerkUserId, detail)
      return detail
    }
    case 'financial_noted': {
      const payload = cmd.payload_json
        ? (JSON.parse(cmd.payload_json) as Record<string, unknown>)
        : {}
      await markStep(db, cmd, step, actorClerkUserId, {
        financialPolicy: 'em_aberto',
        openFinancialBeforeWipe: payload.openFinancialBeforeWipe ?? 0,
        note: 'Registos financeiros no DO já apagados; provedor externo Em aberto',
      })
      return { financialPolicy: 'em_aberto' }
    }
    case 'completed': {
      const ensured = await ensureDeadline(db, cmd)
      const purgedAt = systemClock.nowMs()
      const tenant = await db
        .prepare(`SELECT pending_deletion_at FROM tenants WHERE id = ?`)
        .bind(tenantId)
        .first<{ pending_deletion_at: number | null }>()
      await db
        .prepare(
          `INSERT OR REPLACE INTO purged_tenants (
            tenant_id, purged_at, deletion_command_id, pending_deletion_at, deadline_at
          ) VALUES (?, ?, ?, ?, ?)`,
        )
        .bind(
          tenantId,
          purgedAt,
          cmd.id,
          tenant?.pending_deletion_at ?? null,
          ensured.deadline_at,
        )
        .run()
      await db
        .prepare(`UPDATE tenants SET status = 'purged', updated_at = ? WHERE id = ?`)
        .bind(purgedAt, tenantId)
        .run()
      await writeAuditD1(db, {
        actorClerkUserId,
        tenantId,
        action: 'tenant.purged',
        objectType: 'tenant',
        objectId: tenantId,
        outcome: 'success',
        metadata: { to: 'purged' },
      })
      await markStep(db, ensured, 'completed', actorClerkUserId)
      return { purgedAt }
    }
    default: {
      const _exhaustive: never = step
      throw new Error(`unknown_purge_step:${String(_exhaustive)}`)
    }
  }
}

/** Lista de passos (para o Workflow mapear step.do 1:1). */
export const ENV_PURGE_STEP_NAMES: readonly TenantPurgeStep[] = TENANT_PURGE_STEPS
