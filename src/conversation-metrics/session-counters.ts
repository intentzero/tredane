/**
 * Incrementos locais na booking_session (DO SQLite).
 */
import type { BookingSessionStep } from '../clinic/ai/booking-session'
import type { AttendantRequestSource } from './types'
import type { ClinicDb } from '../clinic/store'

function failSoft(fn: () => void): void {
  try {
    fn()
  } catch {
    /* migração 0072 ainda não aplicada em harnesses legados */
  }
}

export function incrementMisunderstandingTurn(
  db: ClinicDb,
  sessionId: string,
): void {
  failSoft(() => {
    db.run(
      `UPDATE booking_sessions SET misunderstanding_turns = misunderstanding_turns + 1
       WHERE session_id = ? AND closed_at IS NULL`,
      sessionId,
    )
  })
}

export function recordAttendantRequest(
  db: ClinicDb,
  sessionId: string,
  input: {
    source: AttendantRequestSource
    recognized: boolean
    registered: boolean
    step: BookingSessionStep | null
  },
): void {
  const spontaneous = input.source === 'spontaneous' ? 1 : 0
  const offered = input.source === 'offered_misunderstanding_rule' ? 1 : 0
  failSoft(() => {
    db.run(
      `UPDATE booking_sessions SET
         attendant_spontaneous = attendant_spontaneous + ?,
         attendant_offered_rule = attendant_offered_rule + ?,
         attendant_recognized = attendant_recognized + ?,
         attendant_registered = attendant_registered + ?,
         attendant_last_step = COALESCE(?, attendant_last_step)
       WHERE session_id = ? AND closed_at IS NULL`,
      spontaneous,
      offered,
      input.recognized ? 1 : 0,
      input.registered ? 1 : 0,
      input.step,
      sessionId,
    )
  })
}

export function setSessionConfirmedAppointment(
  db: ClinicDb,
  sessionId: string,
  appointmentId: string,
): void {
  failSoft(() => {
    db.run(
      `UPDATE booking_sessions SET confirmed_appointment_id = ? WHERE session_id = ?`,
      appointmentId,
      sessionId,
    )
  })
}