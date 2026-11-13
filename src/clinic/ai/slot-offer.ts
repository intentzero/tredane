/**
 * Oferta proativa e alternativas próximas (#413 / CF-15 / CF-19).
 * Ordena por proximidade da hora pedida e rola para o próximo dia com vaga.
 * Copy via catálogo M4 (#448): oferecer_horarios / sem_horario_* / sem_vaga_*.
 */
import type { Clock } from '../../db/clock'
import { quoteVisit } from '../config/zones'
import type { ServiceRow } from '../config/types'
import { clinicCivilDateFromUtc } from '../scheduling/timezone'
import { ensureClinicSettings } from '../config/settings'
import { earliestBookableStartsAt } from '../scheduling/booking-lead'
import { queryAutomaticAvailability } from '../tempo/automatic'
import { readOpenMeteo } from '../tempo/open-meteo'
import type { ForecastAdapter } from '../tempo/evaluate'
import type { ClinicDb } from '../store'
import { sayAct, serviceNameInProse } from './dialogue-acts'

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

/**
 * Rótulo de dia civil à cliente (relógio da clínica).
 * Paulo 09/11/2026: «hoje» / «amanhã» quando o dia ofertado é o civil atual
 * ou o seguinte; a partir de depois de amanhã mantém «segunda 09/11».
 * Lista Horários same-day: só HH:MM (Paulo 13/11/2026); multi-dia: weekday+DD/MM+hora.
 */
export function dayTextPt(date: string, today?: string | null): string {
  if (today) {
    if (date === today) return 'hoje'
    if (date === addCivilDays(today, 1)) return 'amanhã'
  }
  const [, m, d] = date.split('-')
  return `${WEEKDAY_LABEL[weekdayOfCivil(date)]} ${d}/${m}`
}

/** Limite Meta do título da linha da lista (DEC-134 A / Cloud API). */
const SLOT_LIST_ROW_TITLE_MAX = 24

/** True when every offered slot shares the same civil YYYY-MM-DD. */
export function slotOfferSameCivilDay(slots: Array<{ date: string }>): boolean {
  if (slots.length === 0) return false
  const day = slots[0]!.date
  return slots.every((s) => s.date === day)
}

/**
 * Linha da lista Horários (DEC-138 / #507; Paulo 13/11/2026):
 * - same-day (`timeOnly`): só `HH:MM` — o dia já vai no corpo («disponíveis para terça 17/11»).
 * - multi-dia: `terça 03/11 17:00` no relógio da clínica, sem fuso IANA e sem mês-dia.
 * Título ≤24 (DEC-134 A); descrição só quando o título corta — o cliente
 * WhatsApp ecoa título e descrição no bubble da resposta; se forem iguais,
 * a cliente vê a linha duplicada.
 */
export function slotListRowCopy(
  date: string,
  time: string,
  opts?: { timeOnly?: boolean },
): { title: string; description: string } {
  if (opts?.timeOnly) {
    return { title: time, description: '' }
  }
  const wd = weekdayOfCivil(date)
  const [, month, day] = date.split('-')
  const long = WEEKDAY_LABEL[wd] ?? ''
  const full = `${long} ${day}/${month} ${time}`.trim()
  if (full.length <= SLOT_LIST_ROW_TITLE_MAX) {
    return { title: full, description: '' }
  }
  return {
    title: `${full.slice(0, Math.max(1, SLOT_LIST_ROW_TITLE_MAX - 1)).trimEnd()}…`,
    description: full,
  }
}

/**
 * `{dia}` com preposição (DEC-123): «na sexta (06/11)», «no sábado (07/11)»,
 * ou «hoje» / «amanhã» quando `today` é o dia civil da clínica.
 */
export function dayWithPrepPt(date: string, today?: string | null): string {
  const label = dayTextPt(date, today)
  if (label === 'hoje' || label === 'amanhã') return label
  const wd = WEEKDAY_LABEL[weekdayOfCivil(date)]!
  const [, m, d] = date.split('-')
  const prep = FEMININE_WEEKDAYS.has(wd) ? 'na' : 'no'
  return `${prep} ${wd} (${d}/${m})`
}

/**
 * Rótulo para oferta com dia já pedido (Paulo 08/11/2026; hoje/amanhã 09/11/2026):
 * «hoje» / «amanhã» / «quarta 11/11» — entra em «horários disponíveis para {dia}».
 */
export function dayOfferLabelPt(date: string, today: string): string {
  return dayTextPt(date, today)
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
/**
 * DEC-181: «fim/final/finalzinho da tarde, da manhã ou do dia» pede os últimos horários.
 * Sem cue, a ordem é a de sempre (mais cedo primeiro; «início da manhã» já era assim).
 */
export type SlotOrder = 'earliest' | 'latest'

const LATEST_CUE = /\b(fim|final|finalzinho|finzinho)\s+(da|de|do)\s+(tarde|manha|dia)\b/

export function slotOrderFromText(text: string): SlotOrder {
  const folded = text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  return LATEST_CUE.test(folded) ? 'latest' : 'earliest'
}

export type OfferNearestSlotsResult = {
  slots: OfferedSlot[]
  replyText: string
  /** Caller limpa period sticky no frame (auto-avanço / eco Sim). */
  clearPeriod?: boolean
  /** Caller limpa date sticky no frame. */
  clearDate?: boolean
  /** Anexar botões T1 Manhã|Tarde|Outro dia (período/dia ainda vazio). */
  periodDayChoice?: boolean
}

/**
 * «Para massagem, … não tenho horário livre. Para massagem, tenho …»: tira o prefixo
 * repetido da 2.ª frase («Tenho …»). Só remove o prefixo; o resto da frase aprovada fica.
 */
export function dropRepeatedSubject(text: string, subject: string): string {
  const prefix = `Para ${subject}, `
  if (!text.startsWith(prefix)) return text
  const rest = text.slice(prefix.length)
  return rest.charAt(0).toUpperCase() + rest.slice(1)
}

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
  /** DEC-181: `latest` oferece os últimos horários do período/dia. Omisso = `earliest`. */
  order?: SlotOrder
  limit?: number
  /** Espaçamento mínimo entre ofertas no mesmo dia (minutos). */
  minGapMinutes?: number
  /** Id da conversa — escolhe a redação (hash estável / #448). */
  conversationId?: string
  /** Evita recursão no auto-avanço silencioso (Paulo 09/11/2026). */
  _skipEmptyAdvance?: boolean
}): Promise<OfferNearestSlotsResult> {
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
    order = 'earliest',
    limit = 3,
    minGapMinutes = 30,
    conversationId = '',
    _skipEmptyAdvance = false,
  } = input
  const nowMs = clock.nowMs()
  const earliest = earliestBookableStartsAt(
    nowMs,
    ensureClinicSettings(db, tenantId, clock).bookingLeadMinutes,
  )
  const today = clinicCivilDateFromUtc(tz, nowMs)
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
    if (order === 'latest') {
      // DEC-181: do fim para o princípio, com o mesmo espaçamento; sai em ordem crescente.
      const eligible = slots
        .filter((slot) => slot.startsAt >= earliest)
        .map((slot) => ({ slot, time: localHHMM(tz, slot.startsAt) }))
        .filter(({ time }) => !period || inPeriodHHMM(period, time))
      const chosen: OfferedSlot[] = []
      let nextMinute: number | null = null
      for (let i = eligible.length - 1; i >= 0 && picked.length + chosen.length < limit; i--) {
        const { slot, time } = eligible[i]!
        const minute = minutesOfHHMM(time)
        if (nextMinute != null && nextMinute - minute < minGapMinutes) continue
        nextMinute = minute
        chosen.push({ date: day, time, startsAt: slot.startsAt })
      }
      picked.push(...chosen.reverse())
      continue
    }
    for (const slot of slots) {
      if (slot.startsAt < earliest) continue
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
  const subject = joinNames(names) || serviceNameInProse(service.name)
  if (picked.length === 0) {
    // Silencioso 2 (Paulo 09/11/2026): período/dia vazio → auto-avançar sem wait «Sim».
    if (!_skipEmptyAdvance && period) {
      const advanced = await offerNearestSlots({
        ...input,
        period: null,
        _skipEmptyAdvance: true,
      })
      const período = periodWordPt(period)
      const fallback = `Para ${subject}, ${período} não tenho horário livre.`
      const noPeriodReply = sayAct(
        'sem_horario_periodo',
        conversationId,
        { assunto: subject, período },
        fallback,
      )
      if (advanced.slots.length > 0) {
        // O auto-avanço continua sem esperar um «Sim» (Paulo 09/11/2026), mas já não é mudo:
        // a cliente pediu o período e tem de saber que não há, antes dos horários que lhe damos.
        // Só junta as duas frases já aprovadas; não há copy nova (DEC-104).
        return {
          ...advanced,
          replyText: `${noPeriodReply} ${dropRepeatedSubject(advanced.replyText, subject)}`,
          clearPeriod: true,
        }
      }
      return {
        slots: [],
        replyText: noPeriodReply,
        clearPeriod: true,
        periodDayChoice: true,
      }
    }
    if (!_skipEmptyAdvance && date) {
      const advanced = await offerNearestSlots({
        ...input,
        date: null,
        period: null,
        _skipEmptyAdvance: true,
      })
      if (advanced.slots.length > 0) {
        return {
          ...advanced,
          clearDate: true,
          clearPeriod: Boolean(period) || Boolean(advanced.clearPeriod),
        }
      }
      const dia = dayWithPrepPt(date, today)
      const fallback = `Para ${subject}, ${dia} não tenho horário livre.`
      return {
        slots: [],
        replyText: sayAct(
          'sem_horario_dia',
          conversationId,
          { assunto: subject, dia },
          fallback,
        ),
        clearDate: true,
        clearPeriod: Boolean(period),
        periodDayChoice: true,
      }
    }
    if (period) {
      const período = periodWordPt(period)
      const fallback = `Para ${subject}, ${período} não tenho horário livre.`
      return {
        slots: [],
        replyText: sayAct(
          'sem_horario_periodo',
          conversationId,
          { assunto: subject, período },
          fallback,
        ),
        clearPeriod: true,
        periodDayChoice: true,
      }
    }
    if (date) {
      const dia = dayWithPrepPt(date, today)
      const fallback = `Para ${subject}, ${dia} não tenho horário livre.`
      return {
        slots: [],
        replyText: sayAct(
          'sem_horario_dia',
          conversationId,
          { assunto: subject, dia },
          fallback,
        ),
        clearDate: true,
        periodDayChoice: true,
      }
    }
    const fallback = `Para ${subject}, no momento não tenho horário livre.`
    return {
      slots: [],
      replyText: sayAct(
        'sem_horario_semana',
        conversationId,
        { assunto: subject },
        fallback,
      ),
      periodDayChoice: true,
    }
  }

  const byDay = new Map<string, string[]>()
  for (const slot of picked) {
    const list = byDay.get(slot.date) ?? []
    list.push(slot.time)
    byDay.set(slot.date, list)
  }

  // Dia já pedido e a oferta ficou nesse dia: sem «próximos… para {serviço}» (Paulo 08/11/2026).
  const dayConstrained =
    Boolean(date) && picked.length > 0 && picked.every((slot) => slot.date === date)
  if (dayConstrained) {
    const diaBase = dayOfferLabelPt(date!, today)
    const dia = period ? `${diaBase} ${periodWordPt(period)}` : diaBase
    // Horas só no corpo e na lista interativa — o dia já vai no enquadramento (Paulo 13/11/2026).
    const listed = (byDay.get(date!) ?? picked.map((slot) => slot.time)).join(', ')
    const fallback = `Os horários disponíveis para ${dia} são ${listed}. Algum serve?`
    const body = sayAct(
      'oferecer_horarios',
      conversationId,
      { assunto: subject, quando: '', lista: listed, dia },
      fallback,
      { requireInTemplate: ['{dia}'] },
    )
    return { slots: picked, replyText: body }
  }

  const bits = [...byDay.entries()].map(
    ([day, times]) => `${dayTextPt(day, today)} às ${times.join(', ')}`,
  )
  const listed = bits.length === 1 ? bits[0]! : `${bits.slice(0, -1).join(', ')} e ${bits[bits.length - 1]}`
  // `{quando}`: período com espaço final, ou vazio (opcional no motor do catálogo).
  const quando = period ? `${periodWordPt(period)} ` : ''
  const fallback = `Para ${subject}, ${quando}tenho ${listed}. Qual fica melhor?`
  const body = sayAct(
    'oferecer_horarios',
    conversationId,
    { assunto: subject, quando, lista: listed },
    fallback,
  )
  // Paulo 06/11/2026: sem rodapé «vale por 24 horas» — a lista fica só com as horas.
  // A validade de 24 h do lastOffer/pending (DEC-127) continua no backend.
  return {
    slots: picked,
    replyText: body,
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
    const today = clinicCivilDateFromUtc(input.tz, input.clock.nowMs())
    const bits = [...byDay.entries()].map(
      ([day, times]) => `${dayTextPt(day, today)} às ${times.join(', ')}`,
    )
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
