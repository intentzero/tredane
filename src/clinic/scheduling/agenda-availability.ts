/**
 * Expediente, horários livres e bloqueios por profissional e dia, para a
 * Agenda (TEL-04). Leitura pura: a mesma base de dados que o Agendar usa
 * (janelas efetivas, bloqueios do recurso e da clínica, ocupação confirmada),
 * mas sem escolher serviço. Não decide conflito: o servidor revalida ao
 * reservar (DEC-008, DEC-059, DEC-075, DEC-082).
 */
import type { Clock } from '../../db/clock'
import { SCHEDULE_GRID_MINUTES } from '../constants'
import { listEffectiveWeeklyWindows } from '../config/availability'
import { listResources } from '../config/resources'
import { CLINIC_SCOPE_ID } from '../config/types'
import type { ClinicDb } from '../store'
import { listConfirmedOccupyingResource, type Interval } from './occupancy'
import { clinicDayBounds, clinicDayOfWeek, slotStartUtc } from './timezone'
import type {
  AgendaBlockView,
  AgendaDayAvailability,
  AgendaProfessionalAvailability,
} from './booking-types'

const STEP_MS = SCHEDULE_GRID_MINUTES * 60_000

type BlockSql = {
  id: string
  resource_id: string
  starts_at: number
  ends_at: number
  reason: string
}

function merge(list: Interval[]): Interval[] {
  const sorted = [...list]
    .filter((i) => i.endsAt > i.startsAt)
    .sort((a, b) => a.startsAt - b.startsAt || a.endsAt - b.endsAt)
  const out: Interval[] = []
  for (const iv of sorted) {
    const last = out[out.length - 1]
    if (last && iv.startsAt <= last.endsAt) last.endsAt = Math.max(last.endsAt, iv.endsAt)
    else out.push({ ...iv })
  }
  return out
}

function subtract(from: Interval[], minus: Interval[]): Interval[] {
  const out: Interval[] = []
  for (const w of from) {
    let cursor = w.startsAt
    for (const m of minus) {
      if (m.endsAt <= cursor) continue
      if (m.startsAt >= w.endsAt) break
      if (m.startsAt > cursor) out.push({ startsAt: cursor, endsAt: m.startsAt })
      cursor = Math.max(cursor, m.endsAt)
    }
    if (cursor < w.endsAt) out.push({ startsAt: cursor, endsAt: w.endsAt })
  }
  return out
}

function totalMinutes(list: Interval[]): number {
  return Math.round(list.reduce((n, i) => n + (i.endsAt - i.startsAt), 0) / 60_000)
}

function clip(list: Interval[], range: Interval): Interval[] {
  return list
    .map((i) => ({ startsAt: Math.max(i.startsAt, range.startsAt), endsAt: Math.min(i.endsAt, range.endsAt) }))
    .filter((i) => i.endsAt > i.startsAt)
}

/**
 * `civilDates`: dias do intervalo consultado (1 no dia, 7 na semana).
 * `professionalId`: filtro opcional (`any`/vazio = todas as ativas).
 */
export function buildAgendaAvailability(
  db: ClinicDb,
  tenantId: string,
  timezone: string,
  civilDates: string[],
  professionalId: string | null | undefined,
  asOf: number,
  clock: Clock,
): AgendaProfessionalAvailability[] {
  if (civilDates.length === 0) return []
  const pros = listResources(db, tenantId, clock)
    .filter((r) => r.kind === 'professional' && r.active)
    .filter((r) => !professionalId || professionalId === 'any' || r.id === professionalId)
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR') || a.id.localeCompare(b.id))
  if (pros.length === 0) return []

  const allWindows = listEffectiveWeeklyWindows(db, tenantId)
  const days = civilDates.map((date) => {
    const { dayStartsAt, dayEndsAt, civil } = clinicDayBounds(timezone, date)
    return { date, dayStartsAt, dayEndsAt, civil, dow: clinicDayOfWeek(timezone, dayStartsAt) }
  })
  const rangeStartsAt = days[0]!.dayStartsAt
  const rangeEndsAt = days[days.length - 1]!.dayEndsAt
  const minuteToUtc = (day: (typeof days)[number], minute: number) =>
    minute >= 24 * 60 ? day.dayEndsAt : slotStartUtc(timezone, day.civil, minute)

  const blocks = db.all<BlockSql>(
    `SELECT id, resource_id, starts_at, ends_at, reason FROM resource_blocks
     WHERE tenant_id = ? AND starts_at < ? AND ends_at > ?
     ORDER BY starts_at, id`,
    tenantId,
    rangeEndsAt,
    rangeStartsAt,
  )

  return pros.map((pro) => {
    const windows = allWindows.filter((w) => w.resourceId === pro.id)
    const proBlocks = blocks.filter(
      (b) => b.resource_id === pro.id || b.resource_id === CLINIC_SCOPE_ID,
    )
    const occupying = listConfirmedOccupyingResource(db, tenantId, pro.id, {
      startsAt: rangeStartsAt,
      endsAt: rangeEndsAt,
    })
    const daily: AgendaDayAvailability[] = days.map((day) => {
      const dayRange = { startsAt: day.dayStartsAt, endsAt: day.dayEndsAt }
      const open = merge(
        windows
          .filter((w) => w.dayOfWeek === day.dow)
          .map((w) => ({
            startsAt: minuteToUtc(day, w.startMinute),
            endsAt: minuteToUtc(day, w.endMinute),
          })),
      )
      const dayBlocks: AgendaBlockView[] = proBlocks
        .filter((b) => b.starts_at < day.dayEndsAt && b.ends_at > day.dayStartsAt)
        .map((b) => ({
          id: b.id,
          startsAt: Math.max(b.starts_at, day.dayStartsAt),
          endsAt: Math.min(b.ends_at, day.dayEndsAt),
          reason: b.reason,
          scope: b.resource_id === CLINIC_SCOPE_ID ? 'clinic' : 'professional',
        }))
      const taken = merge([
        ...clip(
          occupying.map((a) => ({ startsAt: a.startsAt, endsAt: a.occupiesUntil })),
          dayRange,
        ),
        ...dayBlocks,
      ])
      const free = subtract(open, taken)
        .map((i) => ({
          startsAt: Math.max(i.startsAt, Math.ceil(asOf / STEP_MS) * STEP_MS),
          endsAt: i.endsAt,
        }))
        .filter((i) => i.endsAt - i.startsAt >= STEP_MS)
      return {
        date: day.date,
        openMinutes: totalMinutes(open),
        busyMinutes: totalMinutes(open) - totalMinutes(subtract(open, taken)),
        windows: open,
        free,
        blocks: dayBlocks,
      }
    })
    return { professionalId: pro.id, professionalName: pro.name, days: daily }
  })
}
