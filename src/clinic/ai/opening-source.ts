/**
 * Expediente que o handoff, a resposta determinística e o contexto da IA leem.
 * União das janelas dos profissionais (salas não contam) e fechamento `__clinic__`.
 * Dia da semana: 1 = segunda … 7 = domingo, a partir da data civil (não do instante UTC).
 */
import type { Clock } from '../../db/clock'
import { listEffectiveWeeklyWindows } from '../config/availability'
import { listBlocks } from '../config/blocks'
import { listResources } from '../config/resources'
import { CLINIC_SCOPE_ID } from '../config/types'
import { clinicDayBounds, zonedCivilToUtc } from '../scheduling/timezone'
import type { ClinicDb } from '../store'
import { addCivilDays, weekdayOfCivil } from './slot-offer'

export type OpeningWindow = {
  dayOfWeek: number
  startMinute: number
  endMinute: number
}

export function listProfessionalOpeningWindows(
  db: ClinicDb,
  tenantId: string,
  clock: Clock,
): OpeningWindow[] {
  const pros = new Set(
    listResources(db, tenantId, clock)
      .filter((r) => r.kind === 'professional')
      .map((r) => r.id),
  )
  return listEffectiveWeeklyWindows(db, tenantId)
    .filter((w) => pros.has(w.resourceId))
    .map((w) => ({ dayOfWeek: w.dayOfWeek, startMinute: w.startMinute, endMinute: w.endMinute }))
}

/** Instante coberto por bloqueio da clínica inteira (feriado, recesso). */
export function clinicClosureCoversInstant(
  db: ClinicDb,
  tenantId: string,
  instantMs: number,
): boolean {
  return listBlocks(db, tenantId, CLINIC_SCOPE_ID).some(
    (b) => b.startsAt <= instantMs && instantMs < b.endsAt,
  )
}

/**
 * Fechamento da clínica inteira no dia civil: feriado/all-day, ou todas as
 * faixas do expediente cobertas por bloqueio `__clinic__`.
 */
export function clinicWideClosureOnCivilDay(
  db: ClinicDb,
  tenantId: string,
  date: string,
  tz: string,
  windows: readonly OpeningWindow[],
): { closed: boolean; note: string | null } {
  const { dayStartsAt, dayEndsAt } = clinicDayBounds(tz, date)
  const blocks = listBlocks(db, tenantId, CLINIC_SCOPE_ID).filter(
    (b) => b.startsAt < dayEndsAt && b.endsAt > dayStartsAt,
  )
  if (blocks.length === 0) return { closed: false, note: null }

  const fullDay = blocks.find((b) => b.startsAt <= dayStartsAt && b.endsAt >= dayEndsAt)
  if (fullDay) return { closed: true, note: fullDay.note?.trim() || null }

  const dow = weekdayOfCivil(date)
  const dayWindows = windows.filter((w) => w.dayOfWeek === dow)
  if (dayWindows.length === 0) return { closed: false, note: null }

  const [y, mo, d] = date.split('-').map(Number) as [number, number, number]
  const allBlocked = dayWindows.every((w) => {
    const hh = Math.floor(w.startMinute / 60)
    const mm = w.startMinute % 60
    const startsAt = zonedCivilToUtc(tz, y, mo, d, hh, mm)
    return blocks.some((b) => b.startsAt <= startsAt && startsAt < b.endsAt)
  })
  if (!allBlocked) return { closed: false, note: null }
  const note = blocks.find((b) => b.note?.trim())?.note?.trim() ?? null
  return { closed: true, note }
}

/**
 * Linhas de fechamento dos próximos 8 dias civis, para o mesmo expediente
 * que a resposta determinística. Prevalecem sobre o dia da semana habitual.
 */
export function clinicClosureLinesForAi(
  db: ClinicDb,
  tenantId: string,
  today: string,
  tz: string,
  windows: readonly OpeningWindow[],
): string[] {
  const lines: string[] = []
  for (let i = 0; i < 8; i++) {
    const date = addCivilDays(today, i)
    const closure = clinicWideClosureOnCivilDay(db, tenantId, date, tz, windows)
    if (!closure.closed) continue
    const [, m, d] = date.split('-')
    const when = i === 0 ? 'hoje ' : i === 1 ? 'amanhã ' : ''
    const note = closure.note ? ` (${closure.note})` : ''
    lines.push(`Fechamento ${when}${d}/${m}: fechado${note}`)
  }
  return lines
}
