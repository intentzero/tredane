import type { Clock } from '../db/clock'
import type { ClinicDb } from '../clinic/store'
import type { FenceSource } from './protocol'

export type RealtimeFence = {
  authEpoch: number
  tenantSuspended: boolean
  lastEventSeq: number
  updatedAt: number
}

export type AccessDenial = {
  clerkUserId: string
  reason: string
  deniedAt: number
  authEpoch: number
  source: FenceSource
}

export function ensureRealtimeFence(db: ClinicDb, clock: Clock): RealtimeFence {
  const existing = readFence(db)
  if (existing) return existing
  const now = clock.nowMs()
  db.run(
    `INSERT INTO realtime_fence (id, auth_epoch, tenant_suspended, last_event_seq, updated_at)
     VALUES (1, 0, 0, 0, ?)`,
    now,
  )
  return {
    authEpoch: 0,
    tenantSuspended: false,
    lastEventSeq: 0,
    updatedAt: now,
  }
}

export function readFence(db: ClinicDb): RealtimeFence | undefined {
  const row = db.get<{
    auth_epoch: number
    tenant_suspended: number
    last_event_seq: number
    updated_at: number
  }>(
    `SELECT auth_epoch, tenant_suspended, last_event_seq, updated_at
     FROM realtime_fence WHERE id = 1`,
  )
  if (!row) return undefined
  return {
    authEpoch: row.auth_epoch,
    tenantSuspended: row.tenant_suspended === 1,
    lastEventSeq: row.last_event_seq,
    updatedAt: row.updated_at,
  }
}

export function bumpAuthEpoch(db: ClinicDb, clock: Clock): RealtimeFence {
  ensureRealtimeFence(db, clock)
  const now = clock.nowMs()
  db.run(
    `UPDATE realtime_fence
     SET auth_epoch = auth_epoch + 1, updated_at = ?
     WHERE id = 1`,
    now,
  )
  return readFence(db)!
}

export function setTenantSuspendedFence(
  db: ClinicDb,
  clock: Clock,
  suspended: boolean,
): RealtimeFence {
  ensureRealtimeFence(db, clock)
  const now = clock.nowMs()
  db.run(
    `UPDATE realtime_fence
     SET tenant_suspended = ?, auth_epoch = auth_epoch + 1, updated_at = ?
     WHERE id = 1`,
    suspended ? 1 : 0,
    now,
  )
  return readFence(db)!
}

export function denyUserAccess(
  db: ClinicDb,
  clock: Clock,
  input: {
    clerkUserId: string
    reason: string
    source: FenceSource
  },
): AccessDenial {
  const fence = bumpAuthEpoch(db, clock)
  const now = clock.nowMs()
  db.run(
    `INSERT INTO access_denials (clerk_user_id, reason, denied_at, auth_epoch, source)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(clerk_user_id) DO UPDATE SET
       reason = excluded.reason,
       denied_at = excluded.denied_at,
       auth_epoch = excluded.auth_epoch,
       source = excluded.source`,
    input.clerkUserId,
    input.reason,
    now,
    fence.authEpoch,
    input.source,
  )
  return {
    clerkUserId: input.clerkUserId,
    reason: input.reason,
    deniedAt: now,
    authEpoch: fence.authEpoch,
    source: input.source,
  }
}

export function getAccessDenial(
  db: ClinicDb,
  clerkUserId: string,
): AccessDenial | undefined {
  const row = db.get<{
    clerk_user_id: string
    reason: string
    denied_at: number
    auth_epoch: number
    source: string
  }>(
    `SELECT clerk_user_id, reason, denied_at, auth_epoch, source
     FROM access_denials WHERE clerk_user_id = ?`,
    clerkUserId,
  )
  if (!row) return undefined
  return {
    clerkUserId: row.clerk_user_id,
    reason: row.reason,
    deniedAt: row.denied_at,
    authEpoch: row.auth_epoch,
    source: row.source as FenceSource,
  }
}

/**
 * Corte rápido local: denial do user OU tenant suspenso.
 * Nunca interpreta ausência de denial como autorização positiva.
 */
export function localFenceBlocks(
  db: ClinicDb,
  clerkUserId: string,
): { blocked: true; reason: string } | { blocked: false } {
  const fence = readFence(db)
  if (fence?.tenantSuspended) {
    return { blocked: true, reason: 'tenant_not_active' }
  }
  const denial = getAccessDenial(db, clerkUserId)
  if (denial) {
    return { blocked: true, reason: denial.reason }
  }
  return { blocked: false }
}
