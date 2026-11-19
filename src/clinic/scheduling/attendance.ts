/**
 * DEC-205 / REQ-119 — comparecimento no compromisso confirmado.
 */
import type { Clock } from '../../db/clock'
import type { ClinicCaller } from '../envelopes'
import { assertValidCaller } from '../envelopes'
import { ConflictError, NotFoundError, ValidationError } from '../errors'
import { assertClinicSchemaReady } from '../migrations'
import type { ClinicDb } from '../store'
import { bindOrAssertTenant } from '../tenant'
import { ensureClinicSettings } from '../config/settings'
export type AppointmentAttendance = 'arrived' | 'no_show' | null

export type SetAttendanceInput = {
  appointmentId: string
  attendance: AppointmentAttendance
  /** Quando a profissional marca: só a coluna dela. */
  restrictToProfessionalId?: string | null
}

export type SetAttendanceResult = {
  appointmentId: string
  attendance: AppointmentAttendance
  version: number
  professionalId: string
}

export function setAppointmentAttendanceOp(
  db: ClinicDb,
  caller: ClinicCaller,
  input: SetAttendanceInput,
  clock: Clock,
): SetAttendanceResult {
  assertClinicSchemaReady(db)
  assertValidCaller(caller)
  const meta = bindOrAssertTenant(db, caller, clock)
  ensureClinicSettings(db, meta.tenantId, clock)

  if (
    input.attendance !== null
    && input.attendance !== 'arrived'
    && input.attendance !== 'no_show'
  ) {
    throw new ValidationError('invalid_attendance', 'Comparecimento inválido')
  }

  return db.transactionSync(() => {
    const row = db.get<{
      id: string
      status: string
      professional_id: string
      version: number
      attendance: string | null
    }>(
      `SELECT id, status, professional_id, version, attendance
       FROM appointments WHERE tenant_id = ? AND id = ?`,
      meta.tenantId,
      input.appointmentId,
    )
    if (!row) {
      throw new NotFoundError('appointment_not_found', `compromisso ${input.appointmentId}`)
    }
    if (row.status !== 'confirmed') {
      throw new ConflictError(
        'appointment_not_confirmed',
        'Só dá para marcar chegada em horário confirmado',
      )
    }
    if (
      input.restrictToProfessionalId
      && row.professional_id !== input.restrictToProfessionalId
    ) {
      throw new ConflictError(
        'attendance_not_own',
        'Só marca chegada nos horários da sua coluna',
      )
    }

    const next = input.attendance
    const prev = row.attendance === 'arrived' || row.attendance === 'no_show' ? row.attendance : null
    if (prev === next) {
      return {
        appointmentId: row.id,
        attendance: next,
        version: row.version,
        professionalId: row.professional_id,
      }
    }

    const version = row.version + 1
    const now = clock.nowMs()
    const updated = db.run(
      `UPDATE appointments
       SET attendance = ?, version = ?, updated_at = ?
       WHERE tenant_id = ? AND id = ? AND version = ?`,
      next,
      version,
      now,
      meta.tenantId,
      row.id,
      row.version,
    )
    if (Number(updated.changes ?? 0) !== 1) {
      throw new ConflictError('version_conflict', 'O compromisso mudou; atualize a agenda')
    }

    return {
      appointmentId: row.id,
      attendance: next,
      version,
      professionalId: row.professional_id,
    }
  })
}
