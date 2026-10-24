import type { ClinicDb } from '../store'

type CmdSql = {
  tenant_id: string
  client_request_id: string
  command: string
  charge_id: string | null
  alert_id: string | null
  appointment_id: string | null
  result_json: string
  created_at: number
}

export type PixExceptionCommandKind =
  | 'cancel_unpaid_charge'
  | 'expire_charge'
  | 'resolve_alert_alt_slot'
  | 'resolve_alert_refund'
  | 'request_refund'
  | 'retry_refund'
  | 'cancel_paid_with_signal'

export type PixExceptionCommandRow = {
  clientRequestId: string
  command: PixExceptionCommandKind
  chargeId: string | null
  alertId: string | null
  appointmentId: string | null
  resultJson: string
  createdAt: number
}

export function findPixExceptionCommand(
  db: ClinicDb,
  tenantId: string,
  clientRequestId: string,
): PixExceptionCommandRow | null {
  const row = db.get<CmdSql>(
    `SELECT * FROM pix_exception_commands
     WHERE tenant_id = ? AND client_request_id = ?`,
    tenantId,
    clientRequestId,
  )
  if (!row) return null
  return {
    clientRequestId: row.client_request_id,
    command: row.command as PixExceptionCommandKind,
    chargeId: row.charge_id,
    alertId: row.alert_id,
    appointmentId: row.appointment_id,
    resultJson: row.result_json,
    createdAt: row.created_at,
  }
}

export function savePixExceptionCommand(
  db: ClinicDb,
  input: {
    tenantId: string
    clientRequestId: string
    command: PixExceptionCommandKind
    chargeId?: string | null
    alertId?: string | null
    appointmentId?: string | null
    result: unknown
    createdAt: number
  },
): void {
  db.run(
    `INSERT INTO pix_exception_commands (
      tenant_id, client_request_id, command, charge_id, alert_id,
      appointment_id, result_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    input.tenantId,
    input.clientRequestId,
    input.command,
    input.chargeId ?? null,
    input.alertId ?? null,
    input.appointmentId ?? null,
    JSON.stringify(input.result),
    input.createdAt,
  )
}
