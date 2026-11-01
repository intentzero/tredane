/**
 * Parser temporal único (#408 / CF-06–CF-11).
 * Substitui extractDates/extractTimes. Sem chrono-node: a tabela de testes
 * do módulo é a fonte de verdade (núcleo conversacional §3.2).
 */
import { formatCivilDate, parseCivilDate } from '../../scheduling/timezone'

export type Period = 'manha' | 'tarde' | 'noite'

export type ClinicNow = {
  /** YYYY-MM-DD no fuso da clínica. */
  civilDate: string
}

export type TemporalParse = {
  dates: string[]
  times: string[]
  periods: Period[]
  relative: string[]
  /** «às N» (1–7) sem manhã/tarde/noite → pergunta «Às N da tarde seria 1N:00?». */
  ambiguousAfternoonHour: number | null
  /** Dia da semana e data explícita divergem. */
  dateConflict: boolean
  /** Menção a data civil impossível (ex.: 31/11). */
  invalidDateMention: boolean
}

const WEEKDAY_NAMES: Array<[RegExp, number, string]> = [
  [/\bsegunda(?:\s*-?\s*feira)?\b/, 1, 'segunda'],
  [/\bterca(?:\s*-?\s*feira)?\b/, 2, 'terca'],
  [/\bquarta(?:\s*-?\s*feira)?\b/, 3, 'quarta'],
  [/\bquinta(?:\s*-?\s*feira)?\b/, 4, 'quinta'],
  [/\bsexta(?:\s*-?\s*feira)?\b/, 5, 'sexta'],
  [/\bsabado\b/, 6, 'sabado'],
  [/\bdomingo\b/, 7, 'domingo'],
]

const MONTH_NAMES: Array<[RegExp, number]> = [
  [/\bjaneiro\b/, 1],
  [/\bfevereiro\b/, 2],
  [/\bmarco\b/, 3],
  [/\babril\b/, 4],
  [/\bmaio\b/, 5],
  [/\bjunho\b/, 6],
  [/\bjulho\b/, 7],
  [/\bagosto\b/, 8],
  [/\bsetembro\b/, 9],
  [/\boutubro\b/, 10],
  [/\bnovembro\b/, 11],
  [/\bdezembro\b/, 12],
]

/**
 * Apaga trechos em que um número é preço ou duração (CF-10), para não
 * virar HH:MM. Mantém horários reais noutros pontos da frase
 * («às 15:00, dura 1 hora»). Não mascara «10h»/«15h» de relógio.
 */
const NON_CLOCK_SPAN =
  /(?:(?:r\$\s*)\d[\d.,]*|\d[\d.,]*\s*reais?|(?:custa|custam|pagar|pago|paguei|vale)\s+\d[\d.,]*|(?:dura|duram|duracao)\s+\d+\s*(?:h(?:oras?)?|min(?:utos?)?)?|(?<![:\d])\b\d+\s+(?:horas?|minutos?|mins?)(?:\s+de\s+dur(?:acao)?)?\b)/gi

export function norm(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
}

function maskNonClockSpans(folded: string): string {
  return folded.replace(NON_CLOCK_SPAN, (m) => ' '.repeat(m.length))
}

function addDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number]
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10)
}

function weekdayOf(date: string): number {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number]
  const js = new Date(Date.UTC(y, m - 1, d)).getUTCDay()
  return js === 0 ? 7 : js
}

function tryCivil(y: number, mo: number, d: number): string | null {
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null
  const iso = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`
  try {
    parseCivilDate(iso)
    return formatCivilDate({ year: y, month: mo, day: d })
  } catch {
    return null
  }
}

function monthAfterDia(folded: string, afterIdx: number): number | undefined {
  const after = folded.slice(afterIdx, afterIdx + 28)
  const deMonth = after.match(/^\s*de\s+([a-z]+)/)
  if (!deMonth) return undefined
  for (const [re, mo] of MONTH_NAMES) {
    if (re.test(deMonth[1]!)) return mo
  }
  return undefined
}

function collectExplicitDates(
  folded: string,
  today: string,
): { dates: string[]; invalid: boolean } {
  const [ty, tm] = today.split('-').map(Number) as [number, number, number]
  const dates: string[] = []
  let invalid = false

  for (const m of folded.matchAll(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/g)) {
    const d = Number(m[1])
    const mo = Number(m[2])
    let y = m[3] ? Number(m[3]) : ty
    if (y < 100) y += 2000
    let iso = tryCivil(y, mo, d)
    if (!iso) {
      invalid = true
      continue
    }
    if (!m[3] && iso < today) {
      const next = tryCivil(y + 1, mo, d)
      if (next) iso = next
    }
    dates.push(iso)
  }

  for (const m of folded.matchAll(/\bdia\s+(\d{1,2})\b(?!\s*\/)/g)) {
    const d = Number(m[1])
    if (d < 1 || d > 31) continue
    const month = monthAfterDia(folded, m.index! + m[0].length)
    if (month != null) {
      let iso = tryCivil(ty, month, d)
      if (!iso) {
        invalid = true
        continue
      }
      if (iso < today) {
        const next = tryCivil(ty + 1, month, d)
        if (!next) {
          invalid = true
          continue
        }
        iso = next
      }
      dates.push(iso)
      continue
    }
    let iso = tryCivil(ty, tm, d)
    if (!iso) {
      const nm = tm === 12 ? 1 : tm + 1
      const ny = tm === 12 ? ty + 1 : ty
      iso = tryCivil(ny, nm, d)
      if (!iso) {
        invalid = true
        continue
      }
    } else if (iso < today) {
      const nm = tm === 12 ? 1 : tm + 1
      const ny = tm === 12 ? ty + 1 : ty
      const next = tryCivil(ny, nm, d)
      if (!next) {
        invalid = true
        continue
      }
      iso = next
    }
    dates.push(iso)
  }

  return { dates, invalid }
}

function collectWeekdays(
  folded: string,
  today: string,
): { dates: string[]; relative: string[]; hits: Array<{ dow: number; iso: string }> } {
  const dates: string[] = []
  const relative: string[] = []
  const hits: Array<{ dow: number; iso: string }> = []

  for (const [re, dow, label] of WEEKDAY_NAMES) {
    if (!re.test(folded)) continue
    const forcedNext =
      new RegExp(`\\bproxima\\s+${label}\\b`).test(folded)
      || new RegExp(`\\b${label}\\s+que\\s+vem\\b`).test(folded)
    let diff = (dow - weekdayOf(today) + 7) % 7
    if (forcedNext && diff === 0) diff = 7
    const iso = addDays(today, diff)
    dates.push(iso)
    hits.push({ dow, iso })
    if (forcedNext) relative.push(`proxima_${label}`)
  }
  return { dates, relative, hits }
}

function collectRelativeDays(folded: string, today: string): { dates: string[]; relative: string[] } {
  const dates: string[] = []
  const relative: string[] = []
  if (/\bdepois de amanha\b/.test(folded)) dates.push(addDays(today, 2))
  else if (/\bamanha\b/.test(folded)) dates.push(addDays(today, 1))
  if (/\bhoje\b/.test(folded)) dates.push(today)
  if (/\bsemana que vem\b/.test(folded)) {
    relative.push('semana_que_vem')
    const dow = weekdayOf(today)
    const daysToNextMonday = ((1 - dow + 7) % 7) || 7
    dates.push(addDays(today, daysToNextMonday))
  }
  return { dates, relative }
}

function mergeDates(
  explicit: string[],
  weekdays: { dates: string[]; hits: Array<{ dow: number; iso: string }> },
  relative: string[],
): { dates: string[]; dateConflict: boolean } {
  if (weekdays.hits.length > 0 && explicit.length > 0) {
    const matched = explicit.filter((iso) => weekdays.hits.some((h) => h.dow === weekdayOf(iso)))
    if (matched.length > 0) {
      return { dates: [...new Set([...matched, ...relative])].sort(), dateConflict: false }
    }
    // Weekday e data explícita divergem → pergunta (CF-06 inverso).
    return { dates: [...new Set(relative)].sort(), dateConflict: true }
  }
  return { dates: [...new Set([...explicit, ...weekdays.dates, ...relative])].sort(), dateConflict: false }
}

function parsePeriods(folded: string): Period[] {
  const out: Period[] = []
  if (/\bmanha\b/.test(folded)) out.push('manha')
  if (/\btarde\b/.test(folded)) out.push('tarde')
  if (/\bnoite\b/.test(folded)) out.push('noite')
  return out
}

function parseTimes(
  foldedRaw: string,
  periods: Period[],
): { times: string[]; ambiguousAfternoonHour: number | null } {
  const folded = maskNonClockSpans(foldedRaw)
  const out = new Set<string>()
  const add = (h: number, m: number) => {
    if (h > 23 || m > 59) return
    out.add(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`)
  }

  if (/\bmeio[\s-]?dia\b/.test(folded)) add(12, 0)

  for (const m of folded.matchAll(/\b([01]?\d|2[0-3])\s+e\s+(?:([0-5]\d)|meia)\b/g)) {
    const min = m[0].includes('meia') ? 30 : Number(m[2])
    add(Number(m[1]), min)
  }

  for (const m of folded.matchAll(/\b(?:as\s+)?([1-9]|1[0-2])\s+da\s+(manha|tarde|noite)\b/g)) {
    let h = Number(m[1])
    const per = m[2]!
    if (per === 'tarde' && h >= 1 && h <= 7) h += 12
    else if (per === 'noite' && h >= 1 && h <= 11) h += 12
    else if (per === 'manha' && h === 12) h = 0
    add(h, 0)
  }

  for (const m of folded.matchAll(/\b(?:la\s+pelas|por\s+volta\s+das)\s+([01]?\d|2[0-3])\b/g)) {
    add(Number(m[1]), 0)
  }

  for (const m of folded.matchAll(
    /\b([01]?\d|2[0-3])(?::([0-5]\d)|\s?h(?:rs|s)?(?:\s?([0-5]\d))?)(?![\d/a-z])/g,
  )) {
    add(Number(m[1]), Number(m[2] ?? m[3] ?? 0))
  }

  let ambiguousAfternoonHour: number | null = null
  const hasPeriodWord = periods.length > 0
  for (const m of folded.matchAll(/\bas\s+([01]?\d|2[0-3])\b(?![:h\d/])/g)) {
    const hour = Number(m[1])
    const after = folded.slice(m.index! + m[0].length, m.index! + m[0].length + 16)
    if (/^\s+da\s+(manha|tarde|noite)\b/.test(after)) continue
    if (!hasPeriodWord && hour >= 1 && hour <= 7) {
      ambiguousAfternoonHour = hour
      continue
    }
    if (hasPeriodWord && periods.includes('tarde') && hour >= 1 && hour <= 7) add(hour + 12, 0)
    else add(hour, 0)
  }

  for (const m of folded.matchAll(/(?<![\d/])(?<!r\$\s*)\b([01]\d|2[0-3])([0-5]\d)\b(?![\d/,])/g)) {
    add(Number(m[1]), Number(m[2]))
  }

  return { times: [...out].sort(), ambiguousAfternoonHour }
}

export function parseTemporal(text: string, now: ClinicNow | string): TemporalParse {
  const today = typeof now === 'string' ? now : now.civilDate
  const folded = norm(text)
  const periods = parsePeriods(folded)

  const explicit = collectExplicitDates(folded, today)
  const weekdays = collectWeekdays(folded, today)
  const relative = collectRelativeDays(folded, today)
  const merged = mergeDates(explicit.dates, weekdays, relative.dates)
  const { times, ambiguousAfternoonHour } = parseTimes(folded, periods)

  return {
    dates: merged.dates,
    times,
    periods,
    relative: [...new Set([...weekdays.relative, ...relative.relative])],
    ambiguousAfternoonHour,
    dateConflict: merged.dateConflict,
    invalidDateMention: explicit.invalid,
  }
}

/** Compat: datas civis citadas no texto. */
export function extractDates(text: string, today: string): Set<string> {
  const parsed = parseTemporal(text, { civilDate: today })
  if (parsed.dateConflict || parsed.invalidDateMention) return new Set()
  return new Set(parsed.dates)
}

/** Compat: horários HH:MM citados. */
export function extractTimes(text: string): Set<string> {
  return new Set(parseTemporal(text, { civilDate: '1970-01-01' }).times)
}
