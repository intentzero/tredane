import type { ClinicDb } from '../store'

type CmdSql = {
  tenant_id: string
  client_request_id: string
  command: string
  appointment_id: string
  result_json: string
  created_at: number
}

export function findAppointmentCommand(
  db: ClinicDb,
  tenantId: string,
  clientRequestId: string,
): { appointmentId: string; command: string; resultJson: string } | null {
  const row = db.get<CmdSql>(
    `SELECT * FROM appointment_commands
     WHERE tenant_id = ? AND client_request_id = ?`,
    tenantId,
    clientRequestId,
  )
  if (!row) return null
  return {
    appointmentId: row.appointment_id,
    command: row.command,
    resultJson: row.result_json,
  }
}

export function rememberAppointmentNotice(
  db: ClinicDb,
  tenantId: string,
  clientRequestId: string,
  key: 'cancelNotice' | 'rescheduleNotice',
  status: 'sent' | 'window_closed' | 'failed' | 'skipped',
): void {
  const existing = findAppointmentCommand(db, tenantId, clientRequestId)
  if (!existing) return
  const parsed = JSON.parse(existing.resultJson) as Record<string, unknown>
  db.run(
    `UPDATE appointment_commands SET result_json = ?
     WHERE tenant_id = ? AND client_request_id = ?`,
    JSON.stringify({ ...parsed, [key]: status }),
    tenantId,
    clientRequestId,
  )
}

export function savedAppointmentNotice(
  resultJson: string,
  key: 'cancelNotice' | 'rescheduleNotice',
): 'sent' | 'window_closed' | 'failed' | 'skipped' {
  try {
    const value = (JSON.parse(resultJson) as Record<string, unknown>)[key]
    if (value === 'sent' || value === 'window_closed' || value === 'failed' || value === 'skipped') {
      return value
    }
  } catch {
    /* comando antigo, sem o aviso gravado */
  }
  return 'skipped'
}

export function saveAppointmentCommand(
  db: ClinicDb,
  input: {
    tenantId: string
    clientRequestId: string
    command: 'confirm' | 'cancel' | 'reschedule'
    appointmentId: string
    result: unknown
    createdAt: number
  },
): void {
  db.run(
    `INSERT INTO appointment_commands (
      tenant_id, client_request_id, command, appointment_id, result_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?)`,
    input.tenantId,
    input.clientRequestId,
    input.command,
    input.appointmentId,
    JSON.stringify(input.result),
    input.createdAt,
  )
}
