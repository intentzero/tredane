/**
 * Orquestrador idempotente do expurgo de clínica (#43).
 * Um tick avança no máximo um passo; retries seguros.
 */
import type { Clock } from '../db/clock'
import type { AdminDb } from '../db/admin/store'
import { getTenant } from '../db/admin/tenants'
import {
  ensurePurgeDeadline,
  getOpenPurgeCommand,
  getPurgeCommand,
  listPurgeCommandsForTenant,
  markPurgeStep,
  maybeSendPurgeDeadlineAlert,
  resolveNextStep,
  type PurgeCommandRow,
} from './commands'
import {
  cancelPendingInvitesForTenant,
  deleteAllPushSubscriptionsForTenant,
  freezeIntegrationsForTenant,
  markTenantPurgedStatus,
  revokeAllMembershipsForTenant,
  scrubWebhookReceiptPayloads,
} from './d1-purge'
import { recordPurgedTenant } from './guards'
import { purgeTenantR2Prefix } from './r2-purge'
import type { TenantPurgeStep } from './steps'

export type ClinicWipeResult = {
  alreadyWiped?: boolean
  openFinancialBeforeWipe?: number
  purgedAt?: number
  deletedCounts?: Record<string, number>
}

export type PurgeTickDeps = {
  adminDb: AdminDb
  clock: Clock
  actorClerkUserId: string
  attachmentsBucket?: R2Bucket | null
  /** Wipe SQLite do Clinic DO (RPC ou in-memory). */
  wipeClinic?: (tenantId: string) => Promise<ClinicWipeResult> | ClinicWipeResult
}

export type PurgeTickResult = {
  command: PurgeCommandRow
  stepped: TenantPurgeStep | null
  done: boolean
  alerted: boolean
  overdue: boolean
  detail: Record<string, unknown>
}

async function runStep(
  deps: PurgeTickDeps,
  command: PurgeCommandRow,
  step: TenantPurgeStep,
): Promise<{ command: PurgeCommandRow; detail: Record<string, unknown> }> {
  const { adminDb, clock, actorClerkUserId } = deps
  const tenantId = command.tenantId

  switch (step) {
    case 'claim': {
      const ensured = ensurePurgeDeadline(adminDb, clock, command)
      const next = markPurgeStep(adminDb, clock, {
        commandId: ensured.id,
        step: 'claim',
        actorClerkUserId,
        status: 'in_progress',
        extraPayload: { deadlineAt: ensured.deadlineAt },
      })
      return { command: next, detail: { claimed: true } }
    }
    case 'integrations_frozen': {
      const frozen = freezeIntegrationsForTenant(
        adminDb,
        clock,
        tenantId,
        actorClerkUserId,
      )
      const next = markPurgeStep(adminDb, clock, {
        commandId: command.id,
        step,
        actorClerkUserId,
        extraPayload: frozen,
      })
      return { command: next, detail: frozen }
    }
    case 'push_cleared': {
      const deleted = deleteAllPushSubscriptionsForTenant(adminDb, tenantId)
      const next = markPurgeStep(adminDb, clock, {
        commandId: command.id,
        step,
        actorClerkUserId,
        extraPayload: { pushDeleted: deleted },
      })
      return { command: next, detail: { pushDeleted: deleted } }
    }
    case 'r2_prefix_cleared': {
      let deletedKeys = 0
      if (deps.attachmentsBucket) {
        const r = await purgeTenantR2Prefix(deps.attachmentsBucket, tenantId)
        deletedKeys = r.deletedKeys
      }
      const next = markPurgeStep(adminDb, clock, {
        commandId: command.id,
        step,
        actorClerkUserId,
        extraPayload: { r2DeletedKeys: deletedKeys },
      })
      return { command: next, detail: { r2DeletedKeys: deletedKeys } }
    }
    case 'clinic_sqlite_wiped': {
      if (!deps.wipeClinic) {
        throw new Error('wipe_clinic_required')
      }
      const wipe = await deps.wipeClinic(tenantId)
      const next = markPurgeStep(adminDb, clock, {
        commandId: command.id,
        step,
        actorClerkUserId,
        extraPayload: {
          alreadyWiped: wipe.alreadyWiped ?? false,
          openFinancialBeforeWipe: wipe.openFinancialBeforeWipe ?? 0,
        },
      })
      return {
        command: next,
        detail: {
          alreadyWiped: wipe.alreadyWiped ?? false,
          openFinancialBeforeWipe: wipe.openFinancialBeforeWipe ?? 0,
        },
      }
    }
    case 'd1_scrubbed': {
      const memberships = revokeAllMembershipsForTenant(
        adminDb,
        clock,
        tenantId,
        actorClerkUserId,
      )
      const invites = cancelPendingInvitesForTenant(adminDb, clock, tenantId)
      const scrubbed = scrubWebhookReceiptPayloads(adminDb, tenantId)
      const next = markPurgeStep(adminDb, clock, {
        commandId: command.id,
        step,
        actorClerkUserId,
        extraPayload: { memberships, invites, scrubbed },
      })
      return { command: next, detail: { memberships, invites, scrubbed } }
    }
    case 'financial_noted': {
      const payload = command.payloadJson
        ? (JSON.parse(command.payloadJson) as Record<string, unknown>)
        : {}
      const next = markPurgeStep(adminDb, clock, {
        commandId: command.id,
        step,
        actorClerkUserId,
        extraPayload: {
          financialPolicy: 'em_aberto',
          openFinancialBeforeWipe: payload.openFinancialBeforeWipe ?? 0,
          note: 'Registos financeiros no DO já apagados; provedor externo Em aberto',
        },
      })
      return { command: next, detail: { financialPolicy: 'em_aberto' } }
    }
    case 'completed': {
      const tenant = getTenant(adminDb, tenantId)
      const ensured = ensurePurgeDeadline(adminDb, clock, command)
      const purgedAt = clock.nowMs()
      recordPurgedTenant(adminDb, {
        tenantId,
        deletionCommandId: command.id,
        pendingDeletionAt: tenant?.pendingDeletionAt ?? null,
        deadlineAt: ensured.deadlineAt,
        purgedAt,
      })
      markTenantPurgedStatus(adminDb, clock, tenantId, actorClerkUserId)
      const next = markPurgeStep(adminDb, clock, {
        commandId: command.id,
        step: 'completed',
        actorClerkUserId,
        status: 'completed',
      })
      return { command: next, detail: { purgedAt } }
    }
    default: {
      const _exhaustive: never = step
      throw new Error(`unknown_purge_step:${String(_exhaustive)}`)
    }
  }
}

export async function tickTenantPurge(
  deps: PurgeTickDeps,
  input: { tenantId: string; commandId?: string },
): Promise<PurgeTickResult> {
  let command = input.commandId
    ? getPurgeCommand(deps.adminDb, input.commandId)
    : getOpenPurgeCommand(deps.adminDb, input.tenantId)

  if (!command) {
    const listed = listPurgeCommandsForTenant(deps.adminDb, input.tenantId).filter(
      (c) => c.status === 'completed',
    )
    if (listed[0]) {
      return {
        command: listed[0],
        stepped: null,
        done: true,
        alerted: false,
        overdue: false,
        detail: { alreadyCompleted: true },
      }
    }
    throw new Error('deletion_command_not_found')
  }

  command = ensurePurgeDeadline(deps.adminDb, deps.clock, command)
  const alert = maybeSendPurgeDeadlineAlert(
    deps.adminDb,
    deps.clock,
    command,
    deps.actorClerkUserId,
  )

  const step = resolveNextStep(command)
  if (!step) {
    return {
      command,
      stepped: null,
      done: command.status === 'completed',
      alerted: alert.alerted,
      overdue: alert.overdue,
      detail: {},
    }
  }

  try {
    const result = await runStep(deps, command, step)
    return {
      command: result.command,
      stepped: step,
      done: step === 'completed',
      alerted: alert.alerted,
      overdue: alert.overdue,
      detail: result.detail,
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'purge_step_failed'
    const failed = markPurgeStep(deps.adminDb, deps.clock, {
      commandId: command.id,
      step,
      actorClerkUserId: deps.actorClerkUserId,
      error: message,
      status: 'in_progress',
    })
    return {
      command: failed,
      stepped: step,
      done: false,
      alerted: alert.alerted,
      overdue: alert.overdue,
      detail: { error: message },
    }
  }
}

export async function runTenantPurgeUntilDone(
  deps: PurgeTickDeps,
  input: { tenantId: string; maxSteps?: number },
): Promise<PurgeTickResult> {
  const maxSteps = input.maxSteps ?? 20
  let last: PurgeTickResult | null = null
  for (let i = 0; i < maxSteps; i++) {
    last = await tickTenantPurge(deps, { tenantId: input.tenantId })
    if (last.done || last.stepped == null) return last
    if (last.detail.error) return last
  }
  return last!
}
