/**
 * Alertas duráveis «Pago sem horário» (M-32 / REQ-080 / #39/#40).
 * Persistidos no SQLite do DO — falha WS não perde o alerta.
 * Só resolve quando alt horário ou devolução efectivamente adequada.
 */
import type { Clock } from '../../db/clock'
import type {
  PixAlertResolutionKind,
  PixPaidWithoutSlotReason,
  PixPaymentAlertStatus,
} from '../constants'
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
  resolution_kind?: string | null
  resolved_by_clerk_user_id?: string | null
  resolved_appointment_id?: string | null
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
    resolutionKind:
      (row.resolution_kind as PixAlertResolutionKind | null | undefined) ?? null,
    resolvedByClerkUserId: row.resolved_by_clerk_user_id ?? null,
    resolvedAppointmentId: row.resolved_appointment_id ?? null,
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

/**
 * Resolve alerta só após sucesso efectivo (alt slot confirmado ou estorno confirmado).
 * Clique falhado / conflito não chama isto — alerta permanece aberto (AC #40).
 */
export function resolvePixPaymentAlert(
  db: ClinicDb,
  tenantId: string,
  alertId: string,
  input: {
    resolutionKind: PixAlertResolutionKind
    resolvedByClerkUserId: string
    resolvedAppointmentId?: string | null
  },
  clock: Clock,
): PixPaymentAlertRow {
  const now = clock.nowMs()
  db.run(
    `UPDATE pix_payment_alerts SET
      status = 'resolved',
      resolution_kind = ?,
      resolved_by_clerk_user_id = ?,
      resolved_appointment_id = ?,
      resolved_at = ?,
      updated_at = ?
     WHERE tenant_id = ? AND id = ? AND status = 'open'`,
    input.resolutionKind,
    input.resolvedByClerkUserId,
    input.resolvedAppointmentId ?? null,
    now,
    now,
    tenantId,
    alertId,
  )
  return getPixPaymentAlert(db, tenantId, alertId)!
}
