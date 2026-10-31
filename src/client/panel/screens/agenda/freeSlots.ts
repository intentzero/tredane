/**
 * Livres e ocupação do expediente (TEL-04), a partir do que a API da Agenda
 * devolve. Puro, sem React: o servidor continua a decidir o conflito.
 */
import type { AgendaProfessionalAvailability } from '../../api'

export type FreeSlot = {
  key: string
  professionalId: string
  professionalName: string
  startsAt: number
  endsAt: number
}

/** Quantos livres o dia sem horários mostra (canvas «Dia sem horários»). */
export const EMPTY_DAY_FREE_PREVIEW = 3

/** Blocos livres do dia, em ordem de hora, só das profissionais escolhidas (vazio = todas). */
export function freeSlotsOfDay(
  availability: AgendaProfessionalAvailability[] | undefined,
  date: string,
  professionalIds: readonly string[] = [],
): FreeSlot[] {
  const out: FreeSlot[] = []
  for (const pro of availability ?? []) {
    if (professionalIds.length > 0 && !professionalIds.includes(pro.professionalId)) continue
    const day = pro.days.find((d) => d.date === date)
    for (const f of day?.free ?? []) {
      out.push({
        key: `${pro.professionalId}:${f.startsAt}`,
        professionalId: pro.professionalId,
        professionalName: pro.professionalName,
        startsAt: f.startsAt,
        endsAt: f.endsAt,
      })
    }
  }
  return out.sort((a, b) => a.startsAt - b.startsAt || a.key.localeCompare(b.key))
}

export type DayOccupancy = {
  professionalId: string
  professionalName: string
  openMinutes: number
  busyMinutes: number
  /** 0–100, arredondado; 0 com expediente fechado. */
  percent: number
}

/** Ocupação do expediente do dia por profissional com expediente aberto. */
export function occupancyOfDay(
  availability: AgendaProfessionalAvailability[] | undefined,
  date: string,
  professionalIds: readonly string[] = [],
): DayOccupancy[] {
  const out: DayOccupancy[] = []
  for (const pro of availability ?? []) {
    if (professionalIds.length > 0 && !professionalIds.includes(pro.professionalId)) continue
    const day = pro.days.find((d) => d.date === date)
    if (!day || day.openMinutes <= 0) continue
    out.push({
      professionalId: pro.professionalId,
      professionalName: pro.professionalName,
      openMinutes: day.openMinutes,
      busyMinutes: day.busyMinutes,
      percent: Math.min(100, Math.round((day.busyMinutes / day.openMinutes) * 100)),
    })
  }
  return out
}
