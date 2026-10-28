/**
 * Horário da clínica, folgas e fechamentos (Proposto, ux-ui.md TEL-09).
 * Puro, sem React. O escopo `__clinic__` guarda o horário e os fechamentos
 * da clínica inteira nas mesmas tabelas de horários e bloqueios.
 */
import type { ClinicBlock, ClinicConfigSnapshot, ClinicWeeklyWindow } from '../../api'
import { civilMinuteToEpoch } from '../holds/holdFormat'
import { formatMinutes } from './format'

export const CLINIC_SCOPE_ID = '__clinic__'

export type DayWindows = Array<{ startMinute: number; endMinute: number }>
/** Faixas por dia da semana (1 = segunda … 7 = domingo). */
export type WeekDraft = Record<number, DayWindows>

export function windowsOf(snap: ClinicConfigSnapshot, resourceId: string): ClinicWeeklyWindow[] {
  return snap.weeklyWindows.filter((w) => w.resourceId === resourceId)
}

export function blocksOf(snap: ClinicConfigSnapshot, resourceId: string): ClinicBlock[] {
  return snap.blocks.filter((b) => b.resourceId === resourceId)
}

export function toWeekDraft(windows: ClinicWeeklyWindow[]): WeekDraft {
  const out: WeekDraft = { 1: [], 2: [], 3: [], 4: [], 5: [], 6: [], 7: [] }
  for (const w of windows) out[w.dayOfWeek]?.push({ startMinute: w.startMinute, endMinute: w.endMinute })
  for (const d of Object.keys(out)) out[Number(d)]!.sort((a, b) => a.startMinute - b.startMinute)
  return out
}

export function fromWeekDraft(draft: WeekDraft): Array<{ dayOfWeek: number; startMinute: number; endMinute: number }> {
  const out: Array<{ dayOfWeek: number; startMinute: number; endMinute: number }> = []
  for (let d = 1; d <= 7; d++) for (const w of draft[d] ?? []) out.push({ dayOfWeek: d, ...w })
  return out
}

const SHORT = ['', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb', 'dom']

function dayKey(list: DayWindows): string {
  return list.map((w) => `${w.startMinute}-${w.endMinute}`).join('+')
}

/** «Seg–sex 08:00–18:00 · sáb 08:00–13:00»; «Sem horário» quando vazio. */
export function describeWeek(draft: WeekDraft): string {
  const parts: string[] = []
  let d = 1
  while (d <= 7) {
    const list = draft[d] ?? []
    if (list.length === 0) {
      d += 1
      continue
    }
    let end = d
    while (end + 1 <= 7 && dayKey(draft[end + 1] ?? []) === dayKey(list)) end += 1
    const label = end === d ? SHORT[d]! : `${SHORT[d]}–${SHORT[end]}`
    parts.push(`${label} ${list.map((w) => `${formatMinutes(w.startMinute)}–${formatMinutes(w.endMinute)}`).join(' e ')}`)
    d = end + 1
  }
  if (parts.length === 0) return 'Sem horário'
  const first = parts[0]!
  parts[0] = first.charAt(0).toUpperCase() + first.slice(1)
  return parts.join(' · ')
}

function civilOf(ms: number, tz: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms))
}

function dm(iso: string): string {
  const [, m, d] = iso.split('-')
  return `${Number(d)}/${Number(m)}`
}

/** «15/11» para um dia; «10/11 – 20/11» para período; fim exclusivo à meia-noite não conta. */
export function formatPeriod(startsAt: number, endsAt: number, tz: string): string {
  const a = civilOf(startsAt, tz)
  const b = civilOf(endsAt - 1, tz)
  return a === b ? dm(a) : `${dm(a)} – ${dm(b)}`
}

export function countDays(startsAt: number, endsAt: number, tz: string): number {
  const a = civilOf(startsAt, tz)
  const b = civilOf(endsAt - 1, tz)
  const [ya, ma, da] = a.split('-').map(Number)
  const [yb, mb, db] = b.split('-').map(Number)
  return Math.round((Date.UTC(yb!, mb! - 1, db!) - Date.UTC(ya!, ma! - 1, da!)) / 86_400_000) + 1
}

/** Início e fim (epoch) de «de … até» no fuso da clínica; dia inteiro ou faixa de horas no primeiro/último dia. */
export function blockRange(
  fromDate: string,
  toDate: string,
  allDay: boolean,
  startMinute: number,
  endMinute: number,
  tz: string,
): { startsAt: number; endsAt: number } | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fromDate) || !/^\d{4}-\d{2}-\d{2}$/.test(toDate)) return null
  if (toDate < fromDate) return null
  if (allDay) {
    return { startsAt: civilMinuteToEpoch(fromDate, 0, tz), endsAt: civilMinuteToEpoch(toDate, 24 * 60, tz) }
  }
  if (endMinute <= startMinute) return null
  return { startsAt: civilMinuteToEpoch(fromDate, startMinute, tz), endsAt: civilMinuteToEpoch(toDate, endMinute, tz) }
}
