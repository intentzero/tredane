import type { AgendaAppointmentItem, ScheduleHold } from '../../api'
import { civilDateInZone } from './format'

/**
 * Quantos compromissos confirmados e reservas por período («hora a definir»)
 * caem em cada dia civil. Canceladas, bloqueios e folgas não entram.
 * A reserva por período não tem sala: com filtro de sala ligado, não acende o dia.
 */
export function agendaMonthMarks(
  appointments: readonly AgendaAppointmentItem[],
  holds: readonly ScheduleHold[],
  timezone: string,
  selectedPros: readonly string[],
  selectedRooms: readonly string[],
): Map<string, number> {
  const counts = new Map<string, number>()
  const add = (iso: string) => counts.set(iso, (counts.get(iso) ?? 0) + 1)
  const proOk = (id: string) => selectedPros.length === 0 || selectedPros.includes(id)
  const roomOk = (id: string | null) =>
    selectedRooms.length === 0 || (id != null && selectedRooms.includes(id))

  for (const appointment of appointments) {
    if (appointment.status === 'cancelled') continue
    if (!proOk(appointment.professionalId) || !roomOk(appointment.roomResourceId)) continue
    add(civilDateInZone(appointment.startsAt, timezone))
  }

  if (selectedRooms.length === 0) {
    for (const hold of holds) {
      if (hold.status !== 'active') continue
      if (!proOk(hold.professionalId)) continue
      add(civilDateInZone(hold.windowStartsAt, timezone))
    }
  }

  return counts
}

/** Sufixo do nome acessível do dia. O ponto em si não é lido. */
export function agendaDayMarkLabel(count: number): string {
  if (count <= 0) return 'sem marcações'
  if (count === 1) return '1 marcação'
  return `${count} marcações`
}
