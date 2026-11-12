import { DEFAULT_BOOKING_LEAD_MINUTES } from '../constants'

/** Primeiro instante em que um horário ainda pode ser oferecido / marcado (ms UTC). */
export function earliestBookableStartsAt(asOfMs: number, leadMinutes: number): number {
  const lead = Number.isFinite(leadMinutes) ? Math.max(0, Math.trunc(leadMinutes)) : DEFAULT_BOOKING_LEAD_MINUTES
  return asOfMs + lead * 60_000
}
