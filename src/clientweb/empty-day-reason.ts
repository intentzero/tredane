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
import { localHHMM, weekdayOfCivil } from '../clinic/ai/slot-offer'
import type { ClinicDb } from '../clinic/store'

/**
 * `closed` = sem expediente / fechamento da clínica; `ended` = hoje, já depois do fim do expediente
 * (DEC-227, revisão 25/11/2026: não é «cheio»); `full` = aberta sem vagas livres.
 */
export type ClientWebEmptyDayReason = 'closed' | 'ended' | 'full'

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
  const now = clock.nowMs()
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
  const hhmm = localHHMM(tz, now)
  const nowMinute = Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3))
  return datesWithoutSlots.map((date) => {
    const reason = classifyEmptyDayReason(db, tenantId, date, tz, windows)
    if (reason === 'full' && date === today) {
      const dow = weekdayOfCivil(date)
      const lastEnd = Math.max(...windows.filter((w) => w.dayOfWeek === dow).map((w) => w.endMinute))
      if (nowMinute >= lastEnd) return { date, reason: 'ended' as const }
    }
    return { date, reason }
  })
}
