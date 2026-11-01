/**
 * Validador factual da mensagem do modelo antes do envio automático (#403, CF-01, DEC-104).
 *
 * Compara o texto com o MESMO contexto que o modelo recebeu: catálogo (preços, variantes,
 * combos) e horários livres por dia. Não chama o modelo e não autoriza nada; só decide se
 * o texto pode sair. Falha → o chamador descarta o texto (`factual_mismatch`).
 *
 * Conservador de propósito: uma hora que a cliente já disse, o expediente e os compromissos
 * dela podem ser repetidos. O que o modelo «oferece» tem de estar na lista do dia citado.
 */
import type { AiCatalogService, AiContextPayload } from './types'

export type ReplyFactsViolation =
  | 'claims_booking'
  | 'price_not_in_catalog'
  | 'time_not_free'
  | 'time_outside_period'

export type ReplyFactsResult = { ok: true } | { ok: false; violation: ReplyFactsViolation }

function fold(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

/* ------------------------------------------------------------------ */
/* Afirmações de reserva                                               */
/* ------------------------------------------------------------------ */

/**
 * Frases que dão a vaga como certa sem compromisso no sistema. Avaliadas por frase;
 * perguntas («Quer que fique marcado para sexta?») não contam.
 */
const BOOKING_CLAIMS: RegExp[] = [
  /\bgaranti(mos)?\b/,
  /\b(vaga|horario|lugar)\s+(ja\s+)?(esta\s+|fica\s+|ficou\s+)?garantid[oa]\b/,
  /\bja\s+(esta\s+)?garantid[oa]\b/,
  /\bte\s+(espero|aguardo|esperamos|aguardamos)\b/,
  /\b(te|lhe)\s+vejo\s+(amanha|hoje|na|no|segunda|terca|quarta|quinta|sexta|sabado|domingo)\b/,
  /\bnos\s+vemos\s+(amanha|hoje|na|no|segunda|terca|quarta|quinta|sexta|sabado|domingo)\b/,
  /\b(esta|ta|fica|ficou)\s+tudo\s+certo\s+(para|pra)\b/,
  /\breservad[oa]\s+(para|pra)\s+(voce|vc|ti)\b/,
  /\b(ja\s+)?(esta|ta|fica|ficou)\s+na\s+agenda\b/,
  /\b(coloquei|deixei|botei)\s+(voce|vc|seu\s+horario|o\s+horario)?\s*na\s+agenda\b/,
  /\banotei\s+(o\s+|seu\s+|o\s+seu\s+|a\s+sua\s+)?(horario|marcacao|agendamento)\b/,
  /^\s*(confirmad[oa]|agendad[oa]|marcad[oa]|reservad[oa])\s*[!.,]/,
  /\b(confirmad[oa]|agendad[oa]|marcad[oa]|reservad[oa])\s+(para|pra)\s+(amanha|hoje|segunda|terca|quarta|quinta|sexta|sabado|domingo|o\s+dia|dia|as)\b/,
]

function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?…])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean)
}

export function claimsBooking(message: string): boolean {
  for (const raw of sentences(message)) {
    if (/\?\s*\p{Extended_Pictographic}*\s*$/u.test(raw)) continue
    const s = fold(raw)
    if (BOOKING_CLAIMS.some((re) => re.test(s))) return true
  }
  return false
}

/* ------------------------------------------------------------------ */
/* Preços                                                              */
/* ------------------------------------------------------------------ */

const PRICE_RE = /r\$\s*(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{1,2}))?|(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{2}))?\s*reais\b/gi

export function pricesInText(text: string): number[] {
  const out: number[] = []
  for (const m of text.matchAll(PRICE_RE)) {
    const int = (m[1] ?? m[3] ?? '').replace(/\./g, '')
    const dec = m[2] ?? m[4] ?? '0'
    if (!int) continue
    out.push(Number(int) * 100 + Number(dec.padEnd(2, '0')))
  }
  return out
}

/** Até 2^10 combinações por serviço; acima disso, só variantes, combos e o total. */
const MAX_SUBSET_ZONES = 10

export function allowedPricesCents(services: readonly AiCatalogService[]): Set<number> {
  const out = new Set<number>()
  for (const s of services) {
    if (s.priceCents != null) out.add(s.priceCents)
    for (const c of s.combos ?? []) out.add(c.priceCents)
    const zonePrices = (s.zones ?? []).map((z) => z.priceCents).filter((p): p is number => p != null)
    if (zonePrices.length === 0) continue
    if (zonePrices.length <= MAX_SUBSET_ZONES) {
      const n = zonePrices.length
      for (let mask = 1; mask < 1 << n; mask++) {
        let sum = 0
        for (let i = 0; i < n; i++) if (mask & (1 << i)) sum += zonePrices[i]!
        out.add(sum)
      }
    } else {
      for (const p of zonePrices) out.add(p)
      out.add(zonePrices.reduce((a, b) => a + b, 0))
    }
  }
  return out
}

/* ------------------------------------------------------------------ */
/* Horários                                                            */
/* ------------------------------------------------------------------ */

type TimeHit = { time: string; index: number }

const DURATION_BEFORE = /(dura|duracao|leva|sessao\s+de|cerca\s+de|aproximadamente|em\s+media)\s*(de\s*)?$/
const DURATION_AFTER = /^\s*(de\s+(duracao|sessao|atendimento|procedimento)|e\s+meia\s+de)/

/** Horas que o texto do modelo cita (HH:MM, 15h, 15h30). «dura 1h» não conta. */
export function timesInText(text: string): TimeHit[] {
  const t = fold(text)
  const out: TimeHit[] = []
  for (const m of t.matchAll(/\b([01]?\d|2[0-3])(?::([0-5]\d)|h(?:s|rs)?\s?([0-5]\d)?)(?![\d/])/g)) {
    const h = Number(m[1])
    const minute = m[2] ?? m[3]
    const isHourOnly = m[2] == null && m[3] == null
    if (isHourOnly) {
      const before = t.slice(Math.max(0, m.index! - 24), m.index!)
      const after = t.slice(m.index! + m[0].length, m.index! + m[0].length + 30)
      if (DURATION_BEFORE.test(before) || DURATION_AFTER.test(after)) continue
    }
    out.push({ time: `${String(h).padStart(2, '0')}:${String(Number(minute ?? 0)).padStart(2, '0')}`, index: m.index! })
  }
  return out
}

/** Horas que a cliente disse (inclui «às 3 da tarde» e «meio-dia») — podem ser repetidas. */
export function clientTimes(text: string): Set<string> {
  const out = new Set(timesInText(text).map((h) => h.time))
  const t = fold(text)
  if (/\bmeio[\s-]?dia\b/.test(t)) out.add('12:00')
  for (const m of t.matchAll(/\b(?:as\s+)?([1-9]|1[0-2])\s+(?:horas?\s+)?da\s+(tarde|noite|manha)\b/g)) {
    let h = Number(m[1])
    if ((m[2] === 'tarde' || m[2] === 'noite') && h < 12) h += 12
    out.add(`${String(h).padStart(2, '0')}:00`)
  }
  for (const m of t.matchAll(/\bas\s+([01]?\d|2[0-3])\b(?![:h\d])/g)) {
    out.add(`${String(Number(m[1])).padStart(2, '0')}:00`)
  }
  for (const m of t.matchAll(/(?<![\d/])\b([01]\d|2[0-3])([0-5]\d)\b(?![\d/,])/g)) {
    out.add(`${m[1]}:${m[2]}`)
  }
  return out
}

const WEEKDAY_TOKENS: Array<[RegExp, number]> = [
  [/\bsegunda\b/g, 1],
  [/\bterca\b/g, 2],
  [/\bquarta\b/g, 3],
  [/\bquinta\b/g, 4],
  [/\bsexta\b/g, 5],
  [/\bsabado\b/g, 6],
  [/\bdomingo\b/g, 7],
]

function addDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number]
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10)
}

function weekdayOf(date: string): number {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number]
  const js = new Date(Date.UTC(y, m - 1, d)).getUTCDay()
  return js === 0 ? 7 : js
}

type DayHit = { date: string; index: number }

/** Dias citados no texto, resolvidos dentro da janela de 7 dias a partir de `today`. */
function daysInText(text: string, today: string): DayHit[] {
  const t = fold(text)
  const window = [0, 1, 2, 3, 4, 5, 6].map((i) => addDays(today, i))
  const out: DayHit[] = []
  for (const m of t.matchAll(/\b(\d{1,2})\/(\d{1,2})(?:\/\d{2,4})?\b/g)) {
    const dd = String(Number(m[1])).padStart(2, '0')
    const mm = String(Number(m[2])).padStart(2, '0')
    const inWindow = window.find((d) => d.slice(5) === `${mm}-${dd}`)
    // Data fora da janela: dia conhecido, mas sem horários na lista.
    out.push({ date: inWindow ?? `fora:${mm}-${dd}`, index: m.index! })
  }
  for (const m of t.matchAll(/\bdepois de amanha\b/g)) out.push({ date: addDays(today, 2), index: m.index! })
  for (const m of t.matchAll(/\bamanha\b/g)) {
    if (/depois de\s*$/.test(t.slice(Math.max(0, m.index! - 12), m.index!))) continue
    out.push({ date: addDays(today, 1), index: m.index! })
  }
  for (const m of t.matchAll(/\bhoje\b/g)) out.push({ date: today, index: m.index! })
  for (const [re, dow] of WEEKDAY_TOKENS) {
    for (const m of t.matchAll(re)) {
      const date = window.find((d) => weekdayOf(d) === dow)
      if (date) out.push({ date, index: m.index! })
    }
  }
  return out.sort((a, b) => a.index - b.index)
}

/** Frase que descreve o expediente («funcionamos das 9:00 às 18:00», «fechamos às 12:00»). */
const HOURS_SENTENCE = /\b(funcion\w*|abr(e|imos)|fech(a|amos)|atendemos|expediente|almoco)\b/

type Period = 'manha' | 'tarde' | 'noite'

function inPeriod(period: Period, hhmm: string): boolean {
  const h = Number(hhmm.slice(0, 2))
  if (period === 'manha') return h < 12
  if (period === 'tarde') return h >= 12 && h < 18
  return h >= 18
}

function singlePeriod(text: string): Period | null {
  const t = fold(text).replace(/\bmais tarde\b/g, ' ')
  const found = (['manha', 'tarde', 'noite'] as const).filter((p) => new RegExp(`\\b${p}\\b`).test(t))
  return found.length === 1 ? found[0]! : null
}

/** Mensagens da cliente no fim da conversa (a vez atual). */
function clientTurn(messages: AiContextPayload['messages']): string {
  const turn: string[] = []
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!
    if (m.direction !== 'inbound') break
    turn.unshift(m.body)
  }
  return turn.join('\n')
}

/* ------------------------------------------------------------------ */
/* Validador                                                           */
/* ------------------------------------------------------------------ */

export function validateReplyFacts(message: string, ctx: AiContextPayload): ReplyFactsResult {
  if (claimsBooking(message)) return { ok: false, violation: 'claims_booking' }

  const prices = pricesInText(message)
  if (prices.length > 0) {
    const allowed = allowedPricesCents(ctx.services)
    if (prices.some((p) => !allowed.has(p))) return { ok: false, violation: 'price_not_in_catalog' }
  }

  const clinic = ctx.clinic
  if (!clinic) return { ok: true }
  const offered = timesInText(message)
  if (offered.length === 0) return { ok: true }

  // Pode repetir: o que a cliente disse, o expediente e os compromissos dela.
  const repeatable = new Set<string>()
  for (const m of ctx.messages) if (m.direction === 'inbound') for (const t of clientTimes(m.body)) repeatable.add(t)
  // Horas do expediente só valem numa frase sobre o expediente, não numa oferta.
  const hoursTimes = new Set<string>()
  for (const line of clinic.openingHours) for (const h of timesInText(line)) hoursTimes.add(h.time)
  for (const a of clinic.upcomingAppointments) for (const h of timesInText(a.when)) repeatable.add(h.time)
  if (clinic.tempoNote) for (const h of timesInText(clinic.tempoNote)) repeatable.add(h.time)

  // Horários da lista, restritos ao serviço quando a mensagem (ou a sessão) o identifica.
  const folded = fold(message)
  const listed = [...new Set(clinic.freeSlots.map((d) => d.serviceName))]
  const named = listed.filter((n) => n.trim().length >= 3 && folded.includes(fold(n.trim())))
  const scope =
    named.length === 1
      ? named[0]
      : ctx.schedule?.serviceName && listed.includes(ctx.schedule.serviceName)
        ? ctx.schedule.serviceName
        : null
  const slots = clinic.freeSlots.filter((d) => scope == null || d.serviceName === scope)
  const byDay = new Map<string, Set<string>>()
  for (const d of slots) {
    const set = byDay.get(d.date) ?? new Set<string>()
    for (const t of d.times) set.add(t)
    byDay.set(d.date, set)
  }
  const anyDay = new Set(slots.flatMap((d) => d.times))

  const turn = clientTurn(ctx.messages)
  const period = timesInText(turn).length === 0 ? singlePeriod(turn) : null
  const clientDays = daysInText(turn, clinic.today)
  const clientDay = new Set(clientDays.map((d) => d.date)).size === 1 ? clientDays[0]!.date : null

  const days = daysInText(message, clinic.today)
  // Fronteiras de frase: um dia citado numa frase não vale para a seguinte.
  const breaks = [...message.matchAll(/[.!?\n]/g)].map((m) => m.index!)
  const sentenceOf = (i: number) => breaks.filter((b) => b < i).length

  const sentenceText = (i: number) => {
    const n = sentenceOf(i)
    const start = n === 0 ? 0 : breaks[n - 1]! + 1
    const end = breaks[n] ?? message.length
    return fold(message.slice(start, end))
  }

  for (const hit of offered) {
    if (repeatable.has(hit.time)) continue
    if (hoursTimes.has(hit.time) && HOURS_SENTENCE.test(sentenceText(hit.index))) continue
    const own = days.filter((d) => d.index < hit.index && sentenceOf(d.index) === sentenceOf(hit.index)).at(-1)
    const day = own?.date ?? clientDay
    const free = day ? (byDay.get(day) ?? new Set<string>()) : anyDay
    if (!free.has(hit.time)) return { ok: false, violation: 'time_not_free' }
    if (period && day && !inPeriod(period, hit.time)) {
      const dayHasPeriod = [...(byDay.get(day) ?? [])].some((t) => inPeriod(period, t))
      if (dayHasPeriod) return { ok: false, violation: 'time_outside_period' }
    }
  }
  return { ok: true }
}
