/**
 * Marcações confirmadas de um dia que «atraem» as seguintes (DEC-227, Proposto).
 * Só `confirmed`: holds e cobranças Pix pendentes não reservam nem atraem.
 */
import type { ClinicDb } from '../store'
import { appointmentOccupiesUntil } from './occupancy'
import type { Attractor } from './pick-slots'

export function listDayAttractors(
  db: ClinicDb,
  tenantId: string,
  day: { dayStartsAt: number; dayEndsAt: number },
  excludeAppointmentId?: string | null,
): Attractor[] {
  const rows = db.all<{
    id: string
    service_id: string
    professional_id: string
    room_resource_id: string | null
    starts_at: number
    ends_at: number
    occupies_until: number | null
  }>(
    `SELECT id, service_id, professional_id, room_resource_id, starts_at, ends_at, occupies_until
       FROM appointments
      WHERE tenant_id = ? AND status = 'confirmed' AND starts_at < ? AND ends_at > ?
      ORDER BY starts_at, id`,
    tenantId,
    day.dayEndsAt,
    day.dayStartsAt,
  )
  const buffers = new Map<string, number>()
  const out: Attractor[] = []
  for (const row of rows) {
    if (excludeAppointmentId && row.id === excludeAppointmentId) continue
    out.push({
      professionalId: row.professional_id || null,
      startsAt: row.starts_at,
      occupiesUntil: appointmentOccupiesUntil(db, tenantId, row, buffers),
    })
  }
  return out
}
