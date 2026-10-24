import type { ClinicDb } from '../store'

type CmdSql = {
  tenant_id: string
  client_request_id: string
  command: string
  scheduling_intent_id: string | null
  charge_id: string | null
  appointment_id: string | null
  result_json: string
  created_at: number
}

export type PixChargeCommandKind =
  | 'create_and_send'
  | 'confirm_without_signal'
  | 'cancel_charge'
  | 'reconcile_create'

export type PixChargeCommandRow = {
  clientRequestId: string
  command: PixChargeCommandKind
  schedulingIntentId: string | null
  chargeId: string | null
  appointmentId: string | null
  resultJson: string
  createdAt: number
}

export function findPixChargeCommand(
  db: ClinicDb,
  tenantId: string,
  clientRequestId: string,
): PixChargeCommandRow | null {
  const row = db.get<CmdSql>(
    `SELECT * FROM pix_charge_commands
     WHERE tenant_id = ? AND client_request_id = ?`,
    tenantId,
    clientRequestId,
  )
  if (!row) return null
  return {
    clientRequestId: row.client_request_id,
    command: row.command as PixChargeCommandKind,
    schedulingIntentId: row.scheduling_intent_id,
    chargeId: row.charge_id,
    appointmentId: row.appointment_id,
    resultJson: row.result_json,
    createdAt: row.created_at,
  }
}

export function savePixChargeCommand(
  db: ClinicDb,
  input: {
    tenantId: string
    clientRequestId: string
    command: PixChargeCommandKind
    schedulingIntentId?: string | null
    chargeId?: string | null
    appointmentId?: string | null
    result: unknown
    createdAt: number
  },
): void {
  db.run(
    `INSERT INTO pix_charge_commands (
      tenant_id, client_request_id, command, scheduling_intent_id,
      charge_id, appointment_id, result_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    input.tenantId,
    input.clientRequestId,
    input.command,
    input.schedulingIntentId ?? null,
    input.chargeId ?? null,
    input.appointmentId ?? null,
    JSON.stringify(input.result),
    input.createdAt,
  )
}
