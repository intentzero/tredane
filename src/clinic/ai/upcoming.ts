/**
 * Marcações futuras confirmadas de um contacto (DEC-202: a página web mostra-as e o chat usa-as
 * para decidir o alvo do link de remarcar ou cancelar).
 */
import type { ClinicDb } from '../store'

export type UpcomingApt = {
  id: string
  serviceId: string
  professionalId: string
  startsAt: number
  endsAt: number
  serviceName: string
}

function mapUpcomingRow(row: {
  id: string
  service_id: string
  professional_id: string
  starts_at: number
  ends_at: number
  service_name: string | null
}): UpcomingApt {
  return {
    id: row.id,
    serviceId: row.service_id,
    professionalId: row.professional_id,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    serviceName: row.service_name ?? 'Atendimento',
  }
}

export function loadUpcomingAppointments(
  db: ClinicDb,
  tenantId: string,
  contactId: string,
  now: number,
  limit = 5,
): UpcomingApt[] {
  const rows = db.all<{
    id: string
    service_id: string
    professional_id: string
    starts_at: number
    ends_at: number
    service_name: string | null
  }>(
    `SELECT a.id, a.service_id, a.professional_id, a.starts_at, a.ends_at, s.name AS service_name
     FROM appointments a
     LEFT JOIN services s ON s.tenant_id = a.tenant_id AND s.id = a.service_id
     WHERE a.tenant_id = ? AND a.contact_id = ? AND a.status = 'confirmed' AND a.starts_at > ?
     ORDER BY a.starts_at ASC LIMIT ?`,
    tenantId,
    contactId,
    now,
    limit,
  )
  return rows.map(mapUpcomingRow)
}

export function loadUpcomingAppointment(
  db: ClinicDb,
  tenantId: string,
  contactId: string,
  now: number,
): UpcomingApt | null {
  return loadUpcomingAppointments(db, tenantId, contactId, now, 1)[0] ?? null
}

/**
 * Alvo do deep-link de remarcar/cancelar.
 * - Dia nomeado e exactamente uma marcação nesse dia → essa.
 * - Dia nomeado sem correspondência única → null (a página lista; não abre outra data).
 * - Sem dia e uma só marcação futura → essa.
 * - Sem dia e várias → null.
 */
export function pickRescheduleAppointment(
  upcoming: readonly UpcomingApt[],
  namedDate: string | null,
  civilDateOf: (startsAt: number) => string,
): UpcomingApt | null {
  if (namedDate) {
    const onDay = upcoming.filter((apt) => civilDateOf(apt.startsAt) === namedDate)
    return onDay.length === 1 ? onDay[0]! : null
  }
  return upcoming.length === 1 ? upcoming[0]! : null
}
