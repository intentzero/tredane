import type { Clock } from '../db/clock'
import { assertClinicSchemaReady } from './migrations'
import { TenantMismatchError } from './errors'
import type { ClinicDb } from './store'
import type { ClinicCaller } from './envelopes'
import { assertCallerTenant, assertSyntheticTenantId, assertValidCaller } from './envelopes'

export type ClinicMeta = {
  tenantId: string
  boundAt: number
}

export function getBoundTenant(db: ClinicDb): ClinicMeta | undefined {
  assertClinicSchemaReady(db)
  const row = db.get<{ tenant_id: string; bound_at: number }>(
    'SELECT tenant_id, bound_at FROM clinic_meta WHERE id = 1',
  )
  if (!row) return undefined
  return { tenantId: row.tenant_id, boundAt: row.bound_at }
}

/**
 * Vincula o DO ao tenant na primeira chamada autorizada.
 * Chamadas seguintes com tenant diferente são recusadas (REQ-001).
 */
export function bindOrAssertTenant(
  db: ClinicDb,
  caller: ClinicCaller,
  clock: Clock,
): ClinicMeta {
  assertClinicSchemaReady(db)
  assertValidCaller(caller)
  assertSyntheticTenantId(caller.tenantId)

  const existing = getBoundTenant(db)
  if (!existing) {
    const now = clock.nowMs()
    db.run(
      `INSERT INTO clinic_meta (id, tenant_id, bound_at) VALUES (1, ?, ?)`,
      caller.tenantId,
      now,
    )
    return { tenantId: caller.tenantId, boundAt: now }
  }

  assertCallerTenant(caller, existing.tenantId)
  return existing
}

/** Recusa tenant forjado mesmo que o schema esteja pronto. */
export function requireTenantMatch(
  db: ClinicDb,
  caller: ClinicCaller,
  clock: Clock,
): ClinicMeta {
  const meta = bindOrAssertTenant(db, caller, clock)
  if (meta.tenantId !== caller.tenantId) {
    throw new TenantMismatchError(`bound=${meta.tenantId} caller=${caller.tenantId}`)
  }
  return meta
}
