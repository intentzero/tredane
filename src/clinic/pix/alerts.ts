/**
 * Alertas duráveis «Pago sem horário» (M-32 / REQ-080 / #39).
 * Persistidos no SQLite do DO — falha WS não perde o alerta.
 * Resolução (outro horário / devolução) = #40.
 */
import type { Clock } from '../../db/clock'
import type { PixPaidWithoutSlotReason, PixPaymentAlertStatus } from '../constants'
import { newId } from '../ids'
import type { ClinicDb } from '../store'
import type { PixPaymentAlertRow } from './types'

type AlertSql = {
  id: string
  tenant_id: string
  charge_id: string
  conversation_id: string | null
  contact_id: string | null
  opportunity_id: string | null
  reason: string
  status: string
  created_at: number
  updated_at: number
  resolved_at: number | null
}

function mapRow(row: AlertSql): PixPaymentAlertRow {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    chargeId: row.charge_id,
    conversationId: row.conversation_id,
    contactId: row.contact_id,
    opportunityId: row.opportunity_id,
    reason: row.reason as PixPaidWithoutSlotReason,
    status: row.status as PixPaymentAlertStatus,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    resolvedAt: row.resolved_at,
  }
}

export function getPixPaymentAlert(
  db: ClinicDb,
  tenantId: string,
  alertId: string,
): PixPaymentAlertRow | null {
  const row = db.get<AlertSql>(
    `SELECT * FROM pix_payment_alerts WHERE tenant_id = ? AND id = ?`,
    tenantId,
    alertId,
  )
  return row ? mapRow(row) : null
}

export function getPixPaymentAlertByCharge(
  db: ClinicDb,
  tenantId: string,
  chargeId: string,
): PixPaymentAlertRow | null {
  const row = db.get<AlertSql>(
    `SELECT * FROM pix_payment_alerts WHERE tenant_id = ? AND charge_id = ?`,
    tenantId,
    chargeId,
  )
  return row ? mapRow(row) : null
}

export function listOpenPixPaymentAlerts(
  db: ClinicDb,
  tenantId: string,
): PixPaymentAlertRow[] {
  return db
    .all<AlertSql>(
      `SELECT * FROM pix_payment_alerts
       WHERE tenant_id = ? AND status = 'open'
       ORDER BY created_at DESC, id`,
      tenantId,
    )
    .map(mapRow)
}

export function listOpenPixPaymentAlertsForConversation(
  db: ClinicDb,
  tenantId: string,
  conversationId: string,
): PixPaymentAlertRow[] {
  return db
    .all<AlertSql>(
      `SELECT * FROM pix_payment_alerts
       WHERE tenant_id = ? AND conversation_id = ? AND status = 'open'
       ORDER BY created_at DESC, id`,
      tenantId,
      conversationId,
    )
    .map(mapRow)
}

export function upsertOpenPixPaymentAlert(
  db: ClinicDb,
  tenantId: string,
  input: {
    chargeId: string
    conversationId?: string | null
    contactId?: string | null
    opportunityId?: string | null
    reason: PixPaidWithoutSlotReason
  },
  clock: Clock,
): PixPaymentAlertRow {
  const existing = getPixPaymentAlertByCharge(db, tenantId, input.chargeId)
  const now = clock.nowMs()
  if (existing) {
    if (existing.status === 'open') return existing
    db.run(
      `UPDATE pix_payment_alerts SET
        status = 'open', reason = ?, resolved_at = NULL, updated_at = ?,
        conversation_id = COALESCE(?, conversation_id),
        contact_id = COALESCE(?, contact_id),
        opportunity_id = COALESCE(?, opportunity_id)
       WHERE tenant_id = ? AND id = ?`,
      input.reason,
      now,
      input.conversationId ?? null,
      input.contactId ?? null,
      input.opportunityId ?? null,
      tenantId,
      existing.id,
    )
    return getPixPaymentAlert(db, tenantId, existing.id)!
  }
  const id = newId('pixalrt')
  db.run(
    `INSERT INTO pix_payment_alerts (
      id, tenant_id, charge_id, conversation_id, contact_id, opportunity_id,
      reason, status, created_at, updated_at, resolved_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, NULL)`,
    id,
    tenantId,
    input.chargeId,
    input.conversationId ?? null,
    input.contactId ?? null,
    input.opportunityId ?? null,
    input.reason,
    now,
    now,
  )
  return getPixPaymentAlert(db, tenantId, id)!
}
