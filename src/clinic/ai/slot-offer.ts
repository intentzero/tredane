/**
 * Oferta proativa e alternativas próximas (#413 / CF-15 / CF-19).
 * Ordena por proximidade da hora pedida e rola para o próximo dia com vaga.
 * Copy via catálogo M4 (#448): oferecer_horarios / sem_horario_* / sem_vaga_*.
 */
import type { Clock } from '../../db/clock'
import { quoteVisit } from '../config/zones'
import type { ServiceRow } from '../config/types'
import { clinicCivilDateFromUtc } from '../scheduling/timezone'
import { queryAutomaticAvailability } from '../tempo/automatic'
import { readOpenMeteo } from '../tempo/open-meteo'
import type { ForecastAdapter } from '../tempo/evaluate'
import type { ClinicDb } from '../store'
import { sayAct } from './dialogue-acts'

const WEEKDAY_LABEL = ['', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado', 'domingo']
const FEMININE_WEEKDAYS = new Set(['segunda', 'terça', 'quarta', 'quinta', 'sexta'])

export type DayPeriod = 'manha' | 'tarde' | 'noite'

export function addCivilDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number]
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10)
}

export function weekdayOfCivil(date: string): number {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number]
  const js = new Date(Date.UTC(y, m - 1, d)).getUTCDay()
  return js === 0 ? 7 : js
}

export function dayTextPt(date: string): string {
  const [, m, d] = date.split('-')
  return `${WEEKDAY_LABEL[weekdayOfCivil(date)]} ${d}/${m}`
}

/**
 * `{dia}` com preposição (DEC-123): «na sexta (06/11)», «no sábado (07/11)»,
 * ou «hoje» / «amanhã» quando `today` é o dia civil da clínica.
 */
export function dayWithPrepPt(date: string, today?: string | null): string {
  if (today) {
    if (date === today) return 'hoje'
    if (date === addCivilDays(today, 1)) return 'amanhã'
  }
  const wd = WEEKDAY_LABEL[weekdayOfCivil(date)]!
  const [, m, d] = date.split('-')
  const prep = FEMININE_WEEKDAYS.has(wd) ? 'na' : 'no'
  return `${prep} ${wd} (${d}/${m})`
}

export function periodWordPt(period: DayPeriod): string {
  if (period === 'manha') return 'de manhã'
  if (period === 'tarde') return 'à tarde'
  return 'à noite'
}

export function inPeriodHHMM(period: DayPeriod, hhmm: string): boolean {
  const hour = Number(hhmm.slice(0, 2))
  if (period === 'manha') return hour < 12
  if (period === 'tarde') return hour >= 12 && hour < 18
  return hour >= 18
}

/** Período implícito pela hora pedida (16:00 → tarde). */
export function periodFromHHMM(hhmm: string): DayPeriod {
  const hour = Number(hhmm.slice(0, 2))
  if (hour < 12) return 'manha'
  if (hour < 18) return 'tarde'
  return 'noite'
}

export function minutesOfHHMM(hhmm: string): number {
  return Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5))
}

export function localHHMM(tz: string, ms: number): string {
  const raw = new Intl.DateTimeFormat('pt-BR', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(ms))
  const match = raw.match(/(\d{1,2})\D(\d{2})/)
  if (!match) return raw
  return `${match[1]!.padStart(2, '0')}:${match[2]}`
}

function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? ''
  if (names.length === 2) return `${names[0]} e ${names[1]}`
  return `${names.slice(0, -1).join(', ')} e ${names[names.length - 1]}`
}

export type OfferedSlot = { date: string; time: string; startsAt: number }

function visitDuration(
  db: ClinicDb,
  tenantId: string,
  service: ServiceRow,
  zones: ServiceRow['zones'],
): number {
  if (zones.length === 0) return service.durationMinutes
  try {
    return quoteVisit(
      db,
      tenantId,
      service,
      zones.map((zone) => zone.id),
    ).durationMinutes
  } catch {
    return service.durationMinutes
  }
}

/**
 * Ordena slots do mesmo dia por proximidade à hora pedida, no mesmo período.
 * Exclui a hora pedida. Limite tipicamente 3.
 */
export function pickNearbySameDay(
  slots: Array<{ startsAt: number }>,
  requestedHHMM: string,
  tz: string,
  opts: { period?: DayPeriod | null; limit?: number; nowMs?: number } = {},
): string[] {
  const period = opts.period ?? periodFromHHMM(requestedHHMM)
  const limit = opts.limit ?? 3
  const target = minutesOfHHMM(requestedHHMM)
  const scored = slots
    .map((slot) => {
      const time = localHHMM(tz, slot.startsAt)
      return { time, startsAt: slot.startsAt, minute: minutesOfHHMM(time) }
    })
    .filter((s) => s.time !== requestedHHMM)
    .filter((s) => inPeriodHHMM(period, s.time))
    .filter((s) => (opts.nowMs == null ? true : s.startsAt > opts.nowMs))
    .map((s) => ({ ...s, dist: Math.abs(s.minute - target) }))
    .sort((a, b) => a.dist - b.dist || a.minute - b.minute)
  const out: string[] = []
  for (const s of scored) {
    if (out.includes(s.time)) continue
    out.push(s.time)
    if (out.length >= limit) break
  }
  return out
}

async function slotsOnDay(
  db: ClinicDb,
  tenantId: string,
  service: ServiceRow,
  zones: ServiceRow['zones'],
  date: string,
  clock: Clock,
  forecast: ForecastAdapter | undefined,
  professionalId?: string,
): Promise<{ schedulingAllowed: boolean; slots: Array<{ startsAt: number }> }> {
  const duration = visitDuration(db, tenantId, service, zones)
  try {
    const avail = await queryAutomaticAvailability(
      db,
      tenantId,
      {
        serviceId: service.id,
        date,
        durationMinutesOverride: duration,
        ...(professionalId ? { professionalId } : {}),
      },
      clock,
      forecast ?? { read: readOpenMeteo },
    )
    return { schedulingAllowed: avail.schedulingAllowed, slots: avail.slots }
  } catch {
    return { schedulingAllowed: false, slots: [] }
  }
}

/**
 * Próximos 2–3 horários reais (CF-19 / A-02 / A-06 / A-12 / F-08).
 * Sem período: qualquer vaga. Com período: filtra. Com data: só esse dia (e, se vazio, dias seguintes).
 */
export async function offerNearestSlots(input: {
  db: ClinicDb
  tenantId: string
  service: ServiceRow
  zones: ServiceRow['zones']
  tz: string
  clock: Clock
  forecast?: ForecastAdapter
  professionalId?: string
  date?: string | null
  period?: DayPeriod | null
  limit?: number
  /** Espaçamento mínimo entre ofertas no mesmo dia (minutos). */
  minGapMinutes?: number
  /** Id da conversa — escolhe a redação (hash estável / #448). */
  conversationId?: string
}): Promise<{ slots: OfferedSlot[]; replyText: string }> {
  const {
    db,
    tenantId,
    service,
    zones,
    tz,
    clock,
    forecast,
    professionalId,
    date = null,
    period = null,
    limit = 3,
    minGapMinutes = 30,
    conversationId = '',
  } = input
  const today = clinicCivilDateFromUtc(tz, clock.nowMs())
  const dates = date
    ? [date, ...[1, 2, 3, 4, 5, 6].map((n) => addCivilDays(date, n))]
    : [0, 1, 2, 3, 4, 5, 6].map((offset) => addCivilDays(today, offset))
  const picked: OfferedSlot[] = []
  const lastMinute = new Map<string, number>()

  for (const day of dates) {
    if (picked.length >= limit) break
    // Com data pedida: no 1.º dia só esse; nos seguintes só se o 1.º veio vazio.
    if (date && day !== date && picked.some((p) => p.date === date)) break
    const { schedulingAllowed, slots } = await slotsOnDay(
      db,
      tenantId,
      service,
      zones,
      day,
      clock,
      forecast,
      professionalId,
    )
    if (!schedulingAllowed && slots.length === 0) continue
    for (const slot of slots) {
      if (slot.startsAt <= clock.nowMs()) continue
      const time = localHHMM(tz, slot.startsAt)
      if (period && !inPeriodHHMM(period, time)) continue
      const minute = minutesOfHHMM(time)
      const prev = lastMinute.get(day)
      if (prev != null && minute - prev < minGapMinutes) continue
      lastMinute.set(day, minute)
      picked.push({ date: day, time, startsAt: slot.startsAt })
      if (picked.length >= limit) break
    }
  }

  const names: string[] = []
  for (const zone of zones) {
    if (!names.includes(zone.name)) names.push(zone.name)
  }
  const subject = joinNames(names) || service.name
  if (picked.length === 0) {
    if (period) {
      const período = periodWordPt(period)
      const fallback = `Para ${subject}, ${período} não tenho horário livre. Quer ver outro período?`
      return {
        slots: [],
        replyText: sayAct(
          'sem_horario_periodo',
          conversationId,
          { assunto: subject, período },
          fallback,
        ),
      }
    }
    if (date) {
      const dia = dayWithPrepPt(date, today)
      const fallback = `Para ${subject}, ${dia} não tenho horário livre. Quer ver outro dia?`
      return {
        slots: [],
        replyText: sayAct(
          'sem_horario_dia',
          conversationId,
          { assunto: subject, dia },
          fallback,
        ),
      }
    }
    const fallback = `Para ${subject}, no momento não tenho horário livre. Quer que eu veja outra data?`
    return {
      slots: [],
      replyText: sayAct(
        'sem_horario_semana',
        conversationId,
        { assunto: subject },
        fallback,
      ),
    }
  }

  const byDay = new Map<string, string[]>()
  for (const slot of picked) {
    const list = byDay.get(slot.date) ?? []
    list.push(slot.time)
    byDay.set(slot.date, list)
  }
  const bits = [...byDay.entries()].map(([day, times]) => `${dayTextPt(day)} às ${times.join(', ')}`)
  const listed = bits.length === 1 ? bits[0]! : `${bits.slice(0, -1).join(', ')} e ${bits[bits.length - 1]}`
  // `{quando}`: período com espaço final, ou vazio (opcional no motor do catálogo).
  const quando = period ? `${periodWordPt(period)} ` : ''
  const fallback = `Para ${subject}, ${quando}tenho ${listed}. Qual fica melhor?`
  return {
    slots: picked,
    replyText: sayAct(
      'oferecer_horarios',
      conversationId,
      { assunto: subject, quando, lista: listed },
      fallback,
    ),
  }
}

/**
 * Texto de alternativas quando a hora pedida está ocupada (CF-15 / D-01 / D-02).
 */
export async function occupiedSlotAlternativesReply(input: {
  db: ClinicDb
  tenantId: string
  service: ServiceRow
  zones: ServiceRow['zones']
  tz: string
  clock: Clock
  forecast?: ForecastAdapter
  professionalId?: string
  date: string
  time: string
  sameDaySlots: Array<{ startsAt: number }>
  conversationId?: string
}): Promise<string> {
  const conversationId = input.conversationId ?? ''
  const period = periodFromHHMM(input.time)
  const nearby = pickNearbySameDay(input.sameDaySlots, input.time, input.tz, {
    period,
    limit: 3,
    nowMs: input.clock.nowMs(),
  })
  if (nearby.length > 0) {
    const lista = nearby.join(', ')
    const fallback = `Nesse horário das ${input.time} já não tenho vaga. Tenho ${lista}. Qual fica melhor?`
    // Sem «próximo com vaga»: esse texto é só do rollover para o dia seguinte.
    return sayAct(
      'sem_vaga_alternativas',
      conversationId,
      { hora: input.time, lista },
      fallback,
      { avoidInTemplate: ['próximo com vaga'] },
    )
  }

  // Sem vaga no período do dia → próximo dia com vaga (D-02).
  const next = await offerNearestSlots({
    db: input.db,
    tenantId: input.tenantId,
    service: input.service,
    zones: input.zones,
    tz: input.tz,
    clock: input.clock,
    forecast: input.forecast,
    professionalId: input.professionalId,
    date: addCivilDays(input.date, 1),
    period,
    limit: 3,
    conversationId,
  })
  if (next.slots.length > 0) {
    const byDay = new Map<string, string[]>()
    for (const slot of next.slots) {
      const list = byDay.get(slot.date) ?? []
      list.push(slot.time)
      byDay.set(slot.date, list)
    }
    const bits = [...byDay.entries()].map(([day, times]) => `${dayTextPt(day)} às ${times.join(', ')}`)
    const listed = bits.length === 1 ? bits[0]! : `${bits.slice(0, -1).join(', ')} e ${bits[bits.length - 1]}`
    const fallback =
      `Nesse horário das ${input.time} já não tenho vaga e o dia está cheio nesse período. No próximo com vaga tenho ${listed}. Qual fica melhor?`
    return sayAct(
      'sem_vaga_alternativas',
      conversationId,
      { hora: input.time, lista: listed },
      fallback,
      { requireInTemplate: ['próximo com vaga'] },
    )
  }

  const fallback = `Nesse horário das ${input.time} já não tenho vaga. Quer que eu veja outro horário?`
  return sayAct(
    'sem_vaga_sem_alternativa',
    conversationId,
    { hora: input.time },
    fallback,
  )
}
