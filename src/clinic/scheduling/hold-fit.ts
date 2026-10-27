/**
 * Reserva por bloco — viabilidade (leitura pura, sem dependência de booking).
 *
 * Um bloco activo segura `durationMinutes` da agenda de UMA profissional
 * algures dentro do período [windowStartsAt, windowEndsAt). Não ocupa o
 * período inteiro: um novo compromisso só é recusado quando faria um bloco
 * que hoje cabe deixar de caber (`hold_conflict`).
 *
 * Algoritmo: EDF guloso (prazo mais cedo primeiro) sobre a grelha de 15 min,
 * respeitando janelas semanais, bloqueios, compromissos confirmados e o
 * relógio. Para blocos de uma só profissional com períodos dentro do mesmo
 * dia é uma heurística conservadora e determinística — suficiente para os
 * poucos blocos simultâneos de uma clínica.
 */
import { SCHEDULE_GRID_MINUTES } from '../constants'
import type { WeeklyWindowRow } from '../config/types'
import type { ClinicDb } from '../store'
import {
  intervalsOverlap,
  listBlocksOverlapping,
  listConfirmedOccupyingResource,
  weeklyCovers,
  type Interval,
} from './occupancy'
import { clinicDayOfWeek, clinicMinuteOfDay } from './timezone'

const GRID_MS = SCHEDULE_GRID_MINUTES * 60_000

export type HoldNeed = {
  id: string
  windowStartsAt: number
  windowEndsAt: number
  durationMinutes: number
}

export type FitContext = {
  timezone: string
  windows: WeeklyWindowRow[]
  nowMs: number
}

function firstGridStart(need: HoldNeed, nowMs: number): number {
  let s = need.windowStartsAt
  if (nowMs > s) {
    s += Math.ceil((nowMs - s) / GRID_MS) * GRID_MS
  }
  return s
}

/** Primeiro início na grelha onde o bloco cabe, ou null. */
export function earliestFit(
  need: HoldNeed,
  busy: Interval[],
  ctx: FitContext,
): number | null {
  const durMs = need.durationMinutes * 60_000
  for (
    let s = firstGridStart(need, ctx.nowMs);
    s + durMs <= need.windowEndsAt;
    s += GRID_MS
  ) {
    const minute = clinicMinuteOfDay(ctx.timezone, s)
    if (minute % SCHEDULE_GRID_MINUTES !== 0) continue
    const dow = clinicDayOfWeek(ctx.timezone, s)
    if (!weeklyCovers(ctx.windows, dow, minute, need.durationMinutes)) continue
    const candidate = { startsAt: s, endsAt: s + durMs }
    if (busy.some((b) => intervalsOverlap(b, candidate))) continue
    return s
  }
  return null
}

/** Todos os blocos cabem em simultâneo? */
export function holdsFeasible(
  needs: HoldNeed[],
  busy: Interval[],
  ctx: FitContext,
): boolean {
  const sorted = [...needs].sort(
    (a, b) =>
      a.windowEndsAt - b.windowEndsAt
      || a.windowStartsAt - b.windowStartsAt
      || a.id.localeCompare(b.id),
  )
  const acc = [...busy]
  for (const need of sorted) {
    const s = earliestFit(need, acc, ctx)
    if (s == null) return false
    acc.push({ startsAt: s, endsAt: s + need.durationMinutes * 60_000 })
  }
  return true
}

/**
 * Minutos livres (na grelha, dentro das janelas semanais) num período,
 * descontando compromissos, bloqueios e os outros blocos já reservados.
 */
export function freeMinutesInWindow(
  window: Interval,
  busy: Interval[],
  ctx: FitContext,
): number {
  let free = 0
  for (
    let s = firstGridStart(
      { id: '', windowStartsAt: window.startsAt, windowEndsAt: window.endsAt, durationMinutes: 0 },
      ctx.nowMs,
    );
    s + GRID_MS <= window.endsAt;
    s += GRID_MS
  ) {
    const minute = clinicMinuteOfDay(ctx.timezone, s)
    const dow = clinicDayOfWeek(ctx.timezone, s)
    if (!weeklyCovers(ctx.windows, dow, minute, SCHEDULE_GRID_MINUTES)) continue
    const cell = { startsAt: s, endsAt: s + GRID_MS }
    if (busy.some((b) => intervalsOverlap(b, cell))) continue
    free += SCHEDULE_GRID_MINUTES
  }
  return free
}

type HoldSql = {
  id: string
  window_starts_at: number
  window_ends_at: number
  duration_minutes: number
}

/** Blocos activos (ainda não vencidos) da profissional que tocam `range`. */
export function listActiveHoldNeeds(
  db: ClinicDb,
  tenantId: string,
  professionalId: string,
  range: Interval,
  nowMs: number,
  excludeHoldId?: string | null,
): HoldNeed[] {
  const rows = db.all<HoldSql>(
    `SELECT id, window_starts_at, window_ends_at, duration_minutes
     FROM schedule_holds
     WHERE tenant_id = ? AND professional_id = ? AND status = 'active'
       AND window_starts_at < ? AND window_ends_at > ? AND window_ends_at > ?
     ORDER BY window_starts_at, id`,
    tenantId,
    professionalId,
    range.endsAt,
    range.startsAt,
    nowMs,
  )
  return rows
    .filter((r) => r.id !== excludeHoldId)
    .map((r) => ({
      id: r.id,
      windowStartsAt: r.window_starts_at,
      windowEndsAt: r.window_ends_at,
      durationMinutes: r.duration_minutes,
    }))
}

/** Ocupação firme (compromissos + bloqueios) da profissional em `range`. */
export function listFirmBusy(
  db: ClinicDb,
  tenantId: string,
  professionalId: string,
  range: Interval,
  excludeAppointmentId?: string | null,
): Interval[] {
  const busy: Interval[] = []
  for (const a of listConfirmedOccupyingResource(
    db,
    tenantId,
    professionalId,
    range,
    excludeAppointmentId,
  )) {
    busy.push({ startsAt: a.startsAt, endsAt: a.occupiesUntil })
  }
  for (const b of listBlocksOverlapping(db, tenantId, professionalId, range)) {
    busy.push({ startsAt: b.starts_at, endsAt: b.ends_at })
  }
  return busy
}

/** Fecho transitivo dos blocos que se sobrepõem a `range` (mesma profissional). */
export function collectHoldCluster(
  db: ClinicDb,
  tenantId: string,
  professionalId: string,
  range: Interval,
  nowMs: number,
  excludeHoldId?: string | null,
): { needs: HoldNeed[]; span: Interval } {
  let span = { ...range }
  let needs: HoldNeed[] = []
  for (let i = 0; i < 8; i += 1) {
    needs = listActiveHoldNeeds(db, tenantId, professionalId, span, nowMs, excludeHoldId)
    const next = needs.reduce(
      (acc, n) => ({
        startsAt: Math.min(acc.startsAt, n.windowStartsAt),
        endsAt: Math.max(acc.endsAt, n.windowEndsAt),
      }),
      span,
    )
    if (next.startsAt === span.startsAt && next.endsAt === span.endsAt) break
    span = next
  }
  return { needs, span }
}

/**
 * O candidato faria algum bloco activo deixar de caber?
 * Se os blocos já não cabem sem o candidato, não bloqueia (não piora o que
 * já está partido — o alerta de «A definir» cobre esse caso).
 */
export function candidateBreaksHolds(
  db: ClinicDb,
  tenantId: string,
  professionalId: string,
  candidate: Interval,
  ctx: FitContext,
  opts: { excludeAppointmentId?: string | null; excludeHoldId?: string | null } = {},
): boolean {
  const { needs, span } = collectHoldCluster(
    db,
    tenantId,
    professionalId,
    candidate,
    ctx.nowMs,
    opts.excludeHoldId,
  )
  if (needs.length === 0) return false
  const busy = listFirmBusy(db, tenantId, professionalId, span, opts.excludeAppointmentId)
  if (!holdsFeasible(needs, busy, ctx)) return false
  return !holdsFeasible(needs, [...busy, candidate], ctx)
}
