import { ValidationError } from '../errors'
import { SCHEDULE_GRID_MINUTES } from '../constants'

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/

export type CivilDate = { year: number; month: number; day: number }

/**
 * Offset TZ em ms: (hora local interpretada como UTC) − instante UTC real.
 * Positivo a oeste de Greenwich (ex.: America/Sao_Paulo ≈ +3h).
 */
export function getTimeZoneOffsetMs(timeZone: string, utcMs: number): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  })
  const parts = dtf.formatToParts(new Date(utcMs))
  const get = (type: Intl.DateTimeFormatPartTypes): number => {
    const v = parts.find((p) => p.type === type)?.value
    if (v === undefined) {
      throw new ValidationError('invalid_timezone', `falha a ler ${type} em ${timeZone}`)
    }
    return Number(v)
  }
  const asUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second'),
  )
  return asUtc - utcMs
}

/** Converte data/hora civil no fuso da clínica → epoch ms UTC. */
export function zonedCivilToUtc(
  timeZone: string,
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second = 0,
): number {
  const guess = Date.UTC(year, month - 1, day, hour, minute, second)
  const offset1 = getTimeZoneOffsetMs(timeZone, guess)
  let utc = guess - offset1
  const offset2 = getTimeZoneOffsetMs(timeZone, utc)
  if (offset2 !== offset1) {
    utc = guess - offset2
  }
  return utc
}

export function parseCivilDate(date: string): CivilDate {
  const m = DATE_RE.exec(date.trim())
  if (!m) {
    throw new ValidationError(
      'invalid_date',
      'date deve ser YYYY-MM-DD no fuso da clínica',
      { date },
    )
  }
  const year = Number(m[1])
  const month = Number(m[2])
  const day = Number(m[3])
  // Valida calendário rejeitando overflow (ex. 2026-02-30).
  const probe = new Date(Date.UTC(year, month - 1, day))
  if (
    probe.getUTCFullYear() !== year
    || probe.getUTCMonth() !== month - 1
    || probe.getUTCDate() !== day
  ) {
    throw new ValidationError('invalid_date', 'data civil inválida', { date })
  }
  return { year, month, day }
}

export function formatCivilDate(d: CivilDate): string {
  const mm = String(d.month).padStart(2, '0')
  const dd = String(d.day).padStart(2, '0')
  return `${d.year}-${mm}-${dd}`
}

/** Limites [dayStartsAt, dayEndsAt) do dia civil no fuso. */
export function clinicDayBounds(
  timeZone: string,
  date: string,
): { dayStartsAt: number; dayEndsAt: number; civil: CivilDate } {
  const civil = parseCivilDate(date)
  const dayStartsAt = zonedCivilToUtc(
    timeZone,
    civil.year,
    civil.month,
    civil.day,
    0,
    0,
    0,
  )
  // Dia seguinte civil (trata virada / DST).
  const next = new Date(Date.UTC(civil.year, civil.month - 1, civil.day + 1))
  const dayEndsAt = zonedCivilToUtc(
    timeZone,
    next.getUTCFullYear(),
    next.getUTCMonth() + 1,
    next.getUTCDate(),
    0,
    0,
    0,
  )
  return { dayStartsAt, dayEndsAt, civil }
}

/**
 * Dia da semana no fuso: 1 = segunda … 7 = domingo (alinhado a weekly_windows).
 */
export function clinicDayOfWeek(timeZone: string, utcMs: number): number {
  const wd = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
  }).format(new Date(utcMs))
  const map: Record<string, number> = {
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
    Sun: 7,
  }
  const n = map[wd]
  if (!n) {
    throw new ValidationError('invalid_weekday', `weekday inesperado: ${wd}`)
  }
  return n
}

/** Minutos desde meia-noite local no fuso. */
export function clinicMinuteOfDay(timeZone: string, utcMs: number): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })
  const parts = dtf.formatToParts(new Date(utcMs))
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? 'NaN')
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? 'NaN')
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) {
    throw new ValidationError('invalid_local_time', 'falha a ler hora local')
  }
  return hour * 60 + minute
}

export function slotStartUtc(
  timeZone: string,
  civil: CivilDate,
  startMinute: number,
): number {
  if (
    !Number.isInteger(startMinute)
    || startMinute < 0
    || startMinute % SCHEDULE_GRID_MINUTES !== 0
  ) {
    throw new ValidationError(
      'invalid_grid',
      `início deve ser múltiplo de ${SCHEDULE_GRID_MINUTES} min`,
      { startMinute },
    )
  }
  const hour = Math.floor(startMinute / 60)
  const minute = startMinute % 60
  return zonedCivilToUtc(timeZone, civil.year, civil.month, civil.day, hour, minute, 0)
}

/** Data civil YYYY-MM-DD no fuso a partir de um instante UTC. */
export function clinicCivilDateFromUtc(timeZone: string, utcMs: number): string {
  const dtf = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  // en-CA → YYYY-MM-DD
  return dtf.format(new Date(utcMs))
}
