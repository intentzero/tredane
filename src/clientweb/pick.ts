/**
 * «Quando prefere?» na página da cliente (DEC-227, Proposto).
 *
 * Em vez da grade do dia, devolve até 3 horas escolhidas pelo servidor para a conveniência
 * pedida (Agora, Hoje de manhã, Hoje à tarde, Amanhã ou uma data), mais «Outros horários».
 * Usa o mesmo motor da agenda (`queryAvailability`, grade de 15 min); a escolha é do
 * `pickSlots`: marcações confirmadas atraem as seguintes e a hora pedida sai primeiro.
 * Nada aqui marca.
 */
import type { Clock } from '../db/clock'
import { ensureClinicSettings } from '../clinic/config/settings'
import { addCivilDays, localHHMM } from '../clinic/ai/slot-offer'
import { clinicDayBounds, zonedCivilToUtc } from '../clinic/scheduling/timezone'
import { queryAvailability } from '../clinic/scheduling/query'
import { listDayAttractors } from '../clinic/scheduling/attractors'
import { pickSlots, type PickCandidate } from '../clinic/scheduling/pick-slots'
import type { ClinicDb } from '../clinic/store'
import { emptyDaysForRange } from './empty-day-reason'
import { readRrLastProfessional } from './round-robin'
import { getService } from '../clinic/config/services'
import {
  CLIENT_WEB_HORIZON_DAYS,
  clampDateRange,
  readClientWebCatalog,
  visitDurationMinutes,
  type ClientWebSlot,
} from './booking'

export type ClientWebDayPart = 'manha' | 'tarde' | 'noite'
export type ClientWebWhen =
  | 'agora'
  | 'hoje_manha'
  | 'hoje_tarde'
  | 'amanha'
  | { date: string; dayPart?: ClientWebDayPart | null }

/** Janela de «Agora»: do instante actual até daqui a 2 h (DEC-227). */
export const NOW_WINDOW_MINUTES = 120

const PART_HOURS: Record<ClientWebDayPart, [number, number]> = {
  manha: [0, 12],
  tarde: [12, 18],
  noite: [18, 24],
}

export type ClientWebChips = { agora: boolean; hojeManha: boolean; hojeTarde: boolean }

export type ClientWebPickResult =
  | {
      ok: true
      /** Dia civil pedido. */
      date: string
      slots: ClientWebSlot[]
      hasMore: boolean
      /** Só quando a antecedência mínima cortou a primeira hora: «O mais cedo possível é às HH:MM.» */
      earliestPossible: string | null
      /** Sem horas na conveniência: porquê. */
      emptyReason: 'closed' | 'full' | 'past' | null
      /** Sem horas na conveniência: a primeira vaga depois dela, dentro do horizonte. */
      nextAvailable: ClientWebSlot | null
      /** Só com `wantChips`: que chips de hoje têm vaga. */
      chips: ClientWebChips | null
    }
  | { ok: false; error: 'range_invalid' | 'professional_invalid' | 'service_unavailable' | 'variants_invalid' }

export type PickContext = {
  serviceId: string
  durationMinutes: number
  /** Profissionais que podem atender, na ordem do catálogo (anel do rodízio). */
  professionalIds: string[]
  /** Preferência da cliente; null = Sem preferência. */
  preferredId: string | null
  /** Remarcar: a própria marcação não ocupa a vaga e a hora actual não é oferecida. */
  excludeAppointmentId?: string | null
  excludeStartsAt?: number | null
  timezone: string
  today: string
}

export type PickRequest = {
  when: ClientWebWhen
  /** `HH:MM` pedida pela cliente (chat ou calendário). */
  requestedTime?: string | null
  /** Múltiplo de 3: 0 = primeira página. */
  offset?: number
  wantChips?: boolean
}

const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/

function civilParts(date: string): [number, number, number] {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number]
  return [y, m, d]
}

function dayHourMs(tz: string, date: string, hour: number): number {
  if (hour >= 24) return dayHourMs(tz, addCivilDays(date, 1), 0)
  const [y, m, d] = civilParts(date)
  return zonedCivilToUtc(tz, y, m, d, hour, 0)
}

/** Converte a conveniência num dia civil e numa janela [de, até) em ms UTC. */
export function resolveWhen(
  when: ClientWebWhen,
  ctx: { timezone: string; today: string },
  nowMs: number,
): { date: string; fromMs: number; toMs: number } {
  const { timezone: tz, today } = ctx
  const part = (date: string, p: ClientWebDayPart) => ({
    date,
    fromMs: dayHourMs(tz, date, PART_HOURS[p][0]),
    toMs: dayHourMs(tz, date, PART_HOURS[p][1]),
  })
  if (when === 'agora') {
    return { date: today, fromMs: nowMs, toMs: Math.min(nowMs + NOW_WINDOW_MINUTES * 60_000, dayHourMs(tz, today, 24)) }
  }
  if (when === 'hoje_manha') return part(today, 'manha')
  if (when === 'hoje_tarde') return part(today, 'tarde')
  if (when === 'amanha') {
    const date = addCivilDays(today, 1)
    return { date, fromMs: dayHourMs(tz, date, 0), toMs: dayHourMs(tz, date, 24) }
  }
  if (when.dayPart) return part(when.date, when.dayPart)
  return { date: when.date, fromMs: dayHourMs(tz, when.date, 0), toMs: dayHourMs(tz, when.date, 24) }
}

/**
 * Horas livres de um dia, com as profissionais livres em cada início. Uma consulta por
 * profissional (o motor devolve só a primeira livre por hora, e a gravidade precisa de todas).
 */
function dayCandidates(
  db: ClinicDb,
  tenantId: string,
  clock: Clock,
  ctx: PickContext,
  date: string,
  applyBookingLead: boolean,
): PickCandidate[] {
  const now = clock.nowMs()
  // Anel do rodízio (DEC-218) como desempate: começa na profissional seguinte à última atribuída.
  const ring = ctx.professionalIds
  const last = readRrLastProfessional(db, tenantId, ctx.serviceId)
  const start = last ? ring.indexOf(last) : -1
  const rotated = ring.length > 0 ? [...ring.slice(start + 1), ...ring.slice(0, start + 1)] : []
  const pros = ctx.preferredId ? [ctx.preferredId] : rotated

  const byStart = new Map<number, PickCandidate>()
  for (const proId of pros) {
    let avail: { slots: Array<{ startsAt: number; occupiesUntil: number }> }
    try {
      avail = queryAvailability(
        db,
        tenantId,
        {
          serviceId: ctx.serviceId,
          date,
          durationMinutesOverride: ctx.durationMinutes,
          professionalId: proId,
          ...(ctx.excludeAppointmentId ? { excludeAppointmentId: ctx.excludeAppointmentId } : {}),
          ...(applyBookingLead ? {} : { applyBookingLead: false }),
        },
        clock,
      )
    } catch {
      continue
    }
    for (const s of avail.slots) {
      if (s.startsAt <= now) continue
      if (ctx.excludeStartsAt != null && s.startsAt === ctx.excludeStartsAt) continue
      const hit = byStart.get(s.startsAt)
      if (hit) hit.professionalIds.push(proId)
      else byStart.set(s.startsAt, { startsAt: s.startsAt, occupiesUntil: s.occupiesUntil, professionalIds: [proId] })
    }
  }
  return [...byStart.values()].sort((a, b) => a.startsAt - b.startsAt)
}

function toSlot(tz: string, date: string, startsAt: number): ClientWebSlot {
  const time = localHHMM(tz, startsAt)
  return { id: `${date}T${time}`, date, time }
}

export function pickWebSlots(
  db: ClinicDb,
  tenantId: string,
  clock: Clock,
  ctx: PickContext,
  req: PickRequest,
): ClientWebPickResult {
  const now = clock.nowMs()
  const win = resolveWhen(req.when, ctx, now)
  if (!clampDateRange(ctx.today, win.date, win.date)) return { ok: false, error: 'range_invalid' }
  const settings = ensureClinicSettings(db, tenantId, clock)
  const lead = settings.bookingLeadMinutes

  const all = dayCandidates(db, tenantId, clock, ctx, win.date, true)
  const inWindow = all.filter((c) => c.startsAt >= win.fromMs && c.startsAt < win.toMs)
  const day = clinicDayBounds(ctx.timezone, win.date)
  const attractors = listDayAttractors(db, tenantId, day, ctx.excludeAppointmentId)

  const requested =
    req.requestedTime && TIME.test(req.requestedTime)
      ? dayHourMs(ctx.timezone, win.date, 0) +
        (Number(req.requestedTime.slice(0, 2)) * 60 + Number(req.requestedTime.slice(3))) * 60_000
      : null
  const picked = pickSlots(inWindow, attractors, {
    anchorMs: Math.max(win.fromMs, now),
    requestedStartMs: requested,
    offset: req.offset ?? 0,
  })
  const slots = picked.slots.map((s) => toSlot(ctx.timezone, win.date, s.startsAt))

  // Antecedência: só explica quando cortou a primeira hora que haveria sem ela.
  let earliestPossible: string | null = null
  if (lead > 0 && (req.offset ?? 0) === 0 && win.date === ctx.today) {
    const noLead = dayCandidates(db, tenantId, clock, ctx, win.date, false).filter(
      (c) => c.startsAt >= win.fromMs && c.startsAt < win.toMs,
    )
    const firstNoLead = noLead[0]?.startsAt
    const firstWithLead = inWindow[0]?.startsAt
    if (firstNoLead != null && (firstWithLead == null || firstWithLead > firstNoLead)) {
      const nextAfter = all.find((c) => c.startsAt >= firstNoLead)
      if (nextAfter) earliestPossible = localHHMM(ctx.timezone, nextAfter.startsAt)
    }
  }

  let emptyReason: 'closed' | 'full' | 'past' | null = null
  let nextAvailable: ClientWebSlot | null = null
  if (slots.length === 0 && (req.offset ?? 0) === 0) {
    if (win.toMs <= now) emptyReason = 'past'
    else if (all.length === 0) {
      emptyReason = emptyDaysForRange(db, tenantId, clock, ctx.timezone, [win.date])[0]?.reason ?? 'full'
    } else emptyReason = 'full'
    nextAvailable = findNextAvailable(db, tenantId, clock, ctx, win.date, win.toMs, all)
  }

  let chips: ClientWebChips | null = null
  if (req.wantChips) {
    const todayAll = win.date === ctx.today ? all : dayCandidates(db, tenantId, clock, ctx, ctx.today, true)
    const agora = resolveWhen('agora', ctx, now)
    const manha = resolveWhen('hoje_manha', ctx, now)
    const tarde = resolveWhen('hoje_tarde', ctx, now)
    const has = (w: { fromMs: number; toMs: number }) => todayAll.some((c) => c.startsAt >= w.fromMs && c.startsAt < w.toMs)
    chips = { agora: has(agora), hojeManha: has(manha), hojeTarde: has(tarde) }
  }

  return { ok: true, date: win.date, slots, hasMore: picked.hasMore, earliestPossible, emptyReason, nextAvailable, chips }
}

/** Primeira vaga depois da conveniência pedida, até ao fim do horizonte. */
function findNextAvailable(
  db: ClinicDb,
  tenantId: string,
  clock: Clock,
  ctx: PickContext,
  date: string,
  afterMs: number,
  dayAll: PickCandidate[],
): ClientWebSlot | null {
  const last = addCivilDays(ctx.today, CLIENT_WEB_HORIZON_DAYS - 1)
  for (let d = date; d <= last; d = addCivilDays(d, 1)) {
    const cands = (d === date ? dayAll : dayCandidates(db, tenantId, clock, ctx, d, true)).filter(
      (c) => c.startsAt >= afterMs,
    )
    if (cands.length === 0) continue
    const attractors = listDayAttractors(db, tenantId, clinicDayBounds(ctx.timezone, d), ctx.excludeAppointmentId)
    const first = pickSlots(cands, attractors, { anchorMs: afterMs, limit: 1 }).slots[0]
    if (first) return toSlot(ctx.timezone, d, first.startsAt)
  }
  return null
}

/** Agendar: valida serviço, zonas e preferência como a lista de horas e escolhe as horas. */
export function pickClientWebSlots(
  db: ClinicDb,
  tenantId: string,
  clock: Clock,
  input: {
    serviceId: string
    variantIds: string[]
    professionalId?: string | null
  } & PickRequest,
): ClientWebPickResult {
  const service = getService(db, tenantId, input.serviceId)
  const catalog = readClientWebCatalog(db, tenantId, clock)
  const catalogSvc = catalog.services.find((s) => s.id === service?.id)
  if (!service || !catalogSvc) return { ok: false, error: 'service_unavailable' }
  const preferredId = input.professionalId?.trim() || null
  if (preferredId && !catalogSvc.professionals.some((p) => p.id === preferredId)) {
    return { ok: false, error: 'professional_invalid' }
  }
  let durationMinutes: number
  try {
    durationMinutes = visitDurationMinutes(db, tenantId, service, input.variantIds)
  } catch {
    return { ok: false, error: 'variants_invalid' }
  }
  return pickWebSlots(
    db,
    tenantId,
    clock,
    {
      serviceId: service.id,
      durationMinutes,
      professionalIds: catalogSvc.professionals.map((p) => p.id),
      preferredId,
      timezone: catalog.timezone,
      today: catalog.today,
    },
    input,
  )
}
