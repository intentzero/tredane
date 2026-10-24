/**
 * Limpeza D1 central no expurgo de tenant (#43).
 * Mantém auditoria central (sem PHI clínico) e linha purged_tenants.
 */
import type { Clock } from '../db/clock'
import { writeAudit } from '../db/admin/audit'
import type { AdminDb } from '../db/admin/store'
import { assertAdminSchemaReady } from '../db/admin/gate'
import { releaseBinding } from '../whatsapp/bindings'

export function deleteAllPushSubscriptionsForTenant(
  db: AdminDb,
  tenantId: string,
): number {
  assertAdminSchemaReady(db)
  const result = db.run(`DELETE FROM push_subscriptions WHERE tenant_id = ?`, tenantId)
  return result.changes ?? 0
}

export function revokeAllMembershipsForTenant(
  db: AdminDb,
  clock: Clock,
  tenantId: string,
  actorClerkUserId: string,
): number {
  assertAdminSchemaReady(db)
  const now = clock.nowMs()
  const result = db.run(
    `UPDATE tenant_memberships
     SET status = 'revoked', revoked_at = ?
     WHERE tenant_id = ? AND status = 'active'`,
    now,
    tenantId,
  )
  if ((result.changes ?? 0) > 0) {
    writeAudit(db, clock, {
      actorClerkUserId,
      tenantId,
      action: 'tenant.purge.memberships_revoked',
      objectType: 'tenant',
      objectId: tenantId,
      outcome: 'success',
      metadata: { revoked: result.changes },
    })
  }
  return result.changes ?? 0
}

export function cancelPendingInvitesForTenant(
  db: AdminDb,
  clock: Clock,
  tenantId: string,
): number {
  assertAdminSchemaReady(db)
  const now = clock.nowMs()
  const result = db.run(
    `UPDATE tenant_invitations
     SET status = 'cancelled', cancelled_at = ?
     WHERE tenant_id = ? AND status = 'pending'`,
    now,
    tenantId,
  )
  return result.changes ?? 0
}

/**
 * Scrub de receipts de webhook — remove payloads que possam ter preview;
 * mantém ids para anti-replay.
 */
export function scrubWebhookReceiptPayloads(
  db: AdminDb,
  tenantId: string,
): { whatsapp: number; pix: number } {
  assertAdminSchemaReady(db)
  let whatsapp = 0
  let pix = 0
  try {
    const w = db.run(
      `UPDATE whatsapp_webhook_receipts
       SET detail_json = NULL
       WHERE tenant_id = ? AND detail_json IS NOT NULL`,
      tenantId,
    )
    whatsapp = w.changes ?? 0
  } catch {
    /* ignore */
  }
  try {
    const p = db.run(
      `UPDATE pix_webhook_receipts
       SET detail_json = NULL
       WHERE tenant_id = ? AND detail_json IS NOT NULL`,
      tenantId,
    )
    pix = p.changes ?? 0
  } catch {
    /* ignore */
  }
  return { whatsapp, pix }
}

export function freezeIntegrationsForTenant(
  db: AdminDb,
  clock: Clock,
  tenantId: string,
  actorClerkUserId: string,
): { whatsappReleased: boolean } {
  const released = releaseBinding(db, clock, {
    tenantId,
    actorClerkUserId,
  })
  return { whatsappReleased: released != null }
}

export function markTenantPurgedStatus(
  db: AdminDb,
  clock: Clock,
  tenantId: string,
  actorClerkUserId: string,
): void {
  assertAdminSchemaReady(db)
  const now = clock.nowMs()
  db.run(
    `UPDATE tenants SET status = 'purged', updated_at = ? WHERE id = ?`,
    now,
    tenantId,
  )
  writeAudit(db, clock, {
    actorClerkUserId,
    tenantId,
    action: 'tenant.purged',
    objectType: 'tenant',
    objectId: tenantId,
    outcome: 'success',
    metadata: { to: 'purged' },
  })
}
