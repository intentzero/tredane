/**
 * Motivo de um dia sem slots na página da cliente (TRE-33 / mock aprovado 2026-11-21).
 * Distingue clínica fechada vs aberta sem vagas — sem nome de feriado (Proposto).
 */
import type { Clock } from '../db/clock'
import {
  clinicWideClosureOnCivilDay,
  listProfessionalOpeningWindows,
  type OpeningWindow,
} from '../clinic/ai/opening-source'
import { weekdayOfCivil } from '../clinic/ai/slot-offer'
import type { ClinicDb } from '../clinic/store'

/** `closed` = sem expediente / fechamento da clínica; `full` = aberta sem vagas livres. */
export type ClientWebEmptyDayReason = 'closed' | 'full'

export type ClientWebEmptyDay = { date: string; reason: ClientWebEmptyDayReason }

export function classifyEmptyDayReason(
  db: ClinicDb,
  tenantId: string,
  date: string,
  tz: string,
  windows: readonly OpeningWindow[],
): ClientWebEmptyDayReason {
  const dow = weekdayOfCivil(date)
  if (!windows.some((w) => w.dayOfWeek === dow)) return 'closed'
  if (clinicWideClosureOnCivilDay(db, tenantId, date, tz, windows).closed) return 'closed'
  return 'full'
}

/** Motivos dos dias do intervalo que já foram consultados e não têm hora livre. */
export function emptyDaysForRange(
  db: ClinicDb,
  tenantId: string,
  clock: Clock,
  tz: string,
  datesWithoutSlots: readonly string[],
): ClientWebEmptyDay[] {
  if (datesWithoutSlots.length === 0) return []
  const windows = listProfessionalOpeningWindows(db, tenantId, clock)
  return datesWithoutSlots.map((date) => ({
    date,
    reason: classifyEmptyDayReason(db, tenantId, date, tz, windows),
  }))
}
