/**
 * Resolve qual compromisso futuro o turno de cancelar/remarcar aponta (serviço, dia).
 */
import { listServices } from '../config/services'
import { clinicCivilDateFromUtc } from '../scheduling/timezone'
import type { ClinicDb } from '../store'
import { extractDates, extractTimes } from './autobook'
import type { UpcomingApt } from './reschedule'
import { minutesOfHHMM } from './slot-offer'

function localTimeHHMM(tz: string, startsAt: number): string {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(startsAt))
}

/** Várias marcações no mesmo dia: hora citada («às 1645», «16h45») desambigua. */
export function pickUpcomingByCitedClock(
  candidates: UpcomingApt[],
  inboundText: string,
  tz: string,
): UpcomingApt | null {
  if (candidates.length <= 1) return candidates[0] ?? null
  const times = [...extractTimes(inboundText)]
  const cited = times.length === 1 ? times[0]! : times.length > 1 ? times[times.length - 1]! : null
  if (!cited) return null
  const matches = candidates.filter((a) => localTimeHHMM(tz, a.startsAt) === cited)
  return matches.length === 1 ? matches[0]! : null
}

const PARA_DEST_DAY =
  /\b(para|pra)\s+(a\s+)?(proxima\s+)?(segunda|ter[cç]a|quarta|quinta|sexta|s[aá]bado|domingo|amanh[aã]|hoje)\b/i

export const CANCEL_MISMATCH_DATE_PREFIX = 'cancel-mismatch:'

export function isCancelMismatchPending(frameDate: string | null | undefined): boolean {
  return Boolean(frameDate?.startsWith(CANCEL_MISMATCH_DATE_PREFIX))
}

export function cancelMismatchNamedDate(frameDate: string | null | undefined): string | null {
  if (!frameDate?.startsWith(CANCEL_MISMATCH_DATE_PREFIX)) return null
  return frameDate.slice(CANCEL_MISMATCH_DATE_PREFIX.length) || null
}

function fold(text: string): string {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
}

/** Uma menção clara ao nome do serviço no texto → filtra a lista de compromissos. */
export function filterUpcomingByServiceMention(
  upcoming: UpcomingApt[],
  inboundText: string,
  db: ClinicDb,
  tenantId: string,
): UpcomingApt[] {
  if (upcoming.length <= 1) return upcoming
  const body = fold(inboundText)
  const services = listServices(db, tenantId).filter((s) => s.active)
  const matched = services.filter((s) => {
    const name = fold(s.name)
    return name.length >= 4 && body.includes(name)
  })
  if (matched.length !== 1) return upcoming
  const id = matched[0]!.id
  const filtered = upcoming.filter((a) => a.serviceId === id)
  return filtered.length > 0 ? filtered : upcoming
}

export function resolveUpcomingByServiceAndDay(
  upcoming: UpcomingApt[],
  inboundText: string,
  db: ClinicDb,
  tenantId: string,
  tz: string,
  today: string,
): UpcomingApt | null {
  const pool = filterUpcomingByServiceMention(upcoming, inboundText, db, tenantId)
  if (pool.length === 0) return null
  if (pool.length === 1) return pool[0]!
  const namedDates = [...extractDates(inboundText, today)]
  const namedDate =
    namedDates.length === 1 ? namedDates[0] : namedDates.length > 1 ? namedDates[namedDates.length - 1] : null
  if (namedDate) {
    const onDay = pool.filter((a) => clinicCivilDateFromUtc(tz, a.startsAt) === namedDate)
    if (onDay.length === 1) return onDay[0]!
    const byTime = pickUpcomingByCitedClock(onDay, inboundText, tz)
    if (byTime) return byTime
  }
  const byTimeAny = pickUpcomingByCitedClock(pool, inboundText, tz)
  if (byTimeAny) return byTimeAny
  return pool[0] ?? null
}

/** O dia citado é destino novo (para sexta), não qual compromisso mover. */
export function rescheduleDayIsNewDestination(inboundText: string): boolean {
  return PARA_DEST_DAY.test(fold(inboundText))
}

/** Grade de oferta alinhada à marcação (30 min entre opções; nunca o horário actual). */
export function thinRescheduleSlotOffers<T extends { startsAt: number }>(
  slots: T[],
  tz: string,
  apt: UpcomingApt,
  opts: { minGapMinutes?: number; limit?: number } = {},
): T[] {
  const minGapMinutes = opts.minGapMinutes ?? 30
  const limit = opts.limit ?? 5
  const sorted = [...slots]
    .filter((s) => s.startsAt !== apt.startsAt)
    .sort((a, b) => a.startsAt - b.startsAt)
  const out: T[] = []
  let lastMinute: number | null = null
  for (const s of sorted) {
    const minute = minutesOfHHMM(
      new Intl.DateTimeFormat('pt-BR', {
        timeZone: tz,
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      }).format(new Date(s.startsAt)),
    )
    if (lastMinute != null && minute - lastMinute < minGapMinutes) continue
    lastMinute = minute
    out.push(s)
    if (out.length >= limit) break
  }
  return out
}