/**
 * Interpretador da resposta contra `pending.options` (ADR-0015 § interpretador / DEC-127).
 * Corre antes dos parsers de data/hora. Sem frase nova.
 */
import { extractTimes } from './nlu/temporal'
import type { BookingFramePending } from './schedule-session'

const AFFIRM_ONLY =
  /^(sim|pode ser|pode|fechado|combinado|ok|okay|beleza|blz|bora|👍|👍🏻|👍🏼|👍🏽|👍🏾|👍🏿)[\s!.?]*$/i

const ORDINAL_WORDS: Array<[RegExp, number]> = [
  [/\b(primeira|primeiro|1\.?[ªºa]?)\b/i, 1],
  [/\b(segunda|segundo|2\.?[ªºa]?)\b/i, 2],
  [/\b(terceira|terceiro|3\.?[ªºa]?)\b/i, 3],
  [/\b(quarta|quarto|4\.?[ªºa]?)\b/i, 4],
  [/\b(quinta|quinto|5\.?[ªºa]?)\b/i, 5],
]

const WEEKDAY_IN_TEXT: Array<[RegExp, string]> = [
  [/\bsegunda\b/i, 'segunda'],
  [/\bter[cç]a\b/i, 'terca'],
  [/\bquarta\b/i, 'quarta'],
  [/\bquinta\b/i, 'quinta'],
  [/\bsexta\b/i, 'sexta'],
  [/\bs[aá]bado\b/i, 'sabado'],
  [/\bdomingo\b/i, 'domingo'],
]

export type PendingChoiceResult =
  | { kind: 'match'; key: string; label: string }
  | { kind: 'ask_which' }
  | { kind: 'ambiguous' }
  | { kind: 'none' }

function fold(text: string): string {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
}

/** Dias da semana que também são ordinais em PT — só contam como N-ésima com «opção/hora/horário». */
const AMBIGUOUS_ORDINAL_WEEKDAYS: ReadonlySet<number> = new Set([2, 4, 5]) // segunda, quarta, quinta

function ordinalIndex(text: string): number | null {
  const folded = fold(text)
  const hasOrdinalQualifier = /\b(op[cç][aã]o|hora|horario)\b/.test(folded)
  // «a 2ª» / «a 4ª opção» / «primeira» — dígitos e primeira/terceiro não colidem com DOW.
  for (const [re, n] of ORDINAL_WORDS) {
    if (!re.test(folded)) continue
    if (AMBIGUOUS_ORDINAL_WEEKDAYS.has(n) && !hasOrdinalQualifier) {
      // Pode ser dia da semana — tratado em weekdayMention / matchPendingChoice.
      continue
    }
    return n
  }
  // «a segunda opção» explícito (redundante com hasOrdinalQualifier, mantém o contrato).
  if (/\b(a|o)\s+(primeira|segunda|terceira|quarta|quinta)\s+op/i.test(text)) {
    const m = fold(text).match(/\b(primeira|segunda|terceira|quarta|quinta)\b/)
    if (!m) return null
    const map: Record<string, number> = {
      primeira: 1,
      segunda: 2,
      terceira: 3,
      quarta: 4,
      quinta: 5,
    }
    return map[m[1]!] ?? null
  }
  return null
}

function weekdayMention(text: string): string | null {
  // Remove «Nª opção/hora» para «segunda opção» não contar como dia da semana.
  const folded = fold(text).replace(
    /\b(primeira|primeiro|segunda|segundo|terceira|terceiro|quarta|quarto|quinta|quinto)\s+(op[cç][aã]o|hora|horario)\b/g,
    ' ',
  )
  const hits: string[] = []
  for (const [re, key] of WEEKDAY_IN_TEXT) {
    if (re.test(folded)) hits.push(key)
  }
  return hits.length === 1 ? hits[0]! : null
}

function optionWeekday(label: string): string | null {
  return weekdayMention(label)
}

/**
 * Casa a resposta da cliente com `pending.options`.
 * DEC-127 (2)(3): ordinal vs dia; 👍/sim com uma ou várias opções.
 */
export function matchPendingChoice(
  text: string,
  pending: BookingFramePending | null | undefined,
): PendingChoiceResult {
  if (!pending || pending.options.length === 0) return { kind: 'none' }
  const opts = pending.options
  const trimmed = text.trim()
  // Rajada sem fala da clínica no meio («Às 10» + proposta muda + «Sexta às 09:00
  // e cotovelo»): a hora da última frase é a escolha. Duas horas na mesma frase
  // continuam fora deste atalho.
  const lines = trimmed.split('\n').map((line) => line.trim()).filter(Boolean)
  const lastLine = lines[lines.length - 1] ?? trimmed
  const lastTimes = [...new Set(extractTimes(lastLine))]
  const choiceText =
    lines.length > 1 && lastTimes.length === 1 ? lastLine : trimmed

  // DEC-127 (3): 👍 / sim / pode ser / fechado
  if (AFFIRM_ONLY.test(choiceText)) {
    if (opts.length === 1) return { kind: 'match', key: opts[0]!.key, label: opts[0]!.label }
    return { kind: 'ask_which' }
  }

  // Hora citada («o das 14», «14h», «às 14:00») contra opções.
  // O relógio é o de parseTimes (DEC-137, leitura 06/11/2026): «o das N» já entra em extractTimes.
  const times = [...extractTimes(choiceText)]
  // Hora solta em resposta à oferta de horários: «14» = 14:00 quando há uma opção às 14:00.
  // Só com pending de horário e só se alguma opção tiver essa hora; senão «1»…«5» seguem como
  // ordinais mais abaixo.
  if (times.length === 0 && pending.slot === 'horario') {
    const bare = choiceText.match(/^(\d{1,2})\s*[.!]?$/)
    const hour = bare ? Number(bare[1]) : -1
    if (hour >= 0 && hour <= 23) {
      const want = `${String(hour).padStart(2, '0')}:00`
      const offered = opts.some(
        (o) => o.key.match(/\d{2}:\d{2}/)?.[0] === want || [...extractTimes(o.label)].includes(want),
      )
      if (offered) times.push(want)
    }
  }
  const uniqueTimes = [...new Set(times)]
  if (uniqueTimes.length === 1) {
    const want = uniqueTimes[0]!
    const hour = want.slice(0, 2)
    const hits = opts.filter((o) => {
      const t = [...extractTimes(o.label)]
      const keyTime = o.key.match(/\d{2}:\d{2}/)?.[0]
      if (keyTime === want) return true
      if (t.includes(want)) return true
      // «14» casa «14:00» / «14:30» só se hora bater e houver um único no pending
      return o.label.includes(want) || o.label.includes(`${Number(hour)}h`) || o.key.includes(want)
    })
    if (hits.length === 1) return { kind: 'match', key: hits[0]!.key, label: hits[0]!.label }
    if (hits.length > 1) return { kind: 'ambiguous' }
    // Hora explícita fora da lista não é escolha ambígua do dia («sexta às 17:00»
    // com 09:00 e 10:00 na sexta). O resto do funil trata a hora citada.
    return { kind: 'none' }
  }

  // DEC-127 (2): ordinal vs dia da semana
  const ord = (() => {
    // Forçar deteção de «a segunda opção»
    if (/\b(primeira|segunda|terceira|quarta|quinta)\s+op/i.test(fold(choiceText))) {
      const m = fold(choiceText).match(/\b(primeira|segunda|terceira|quarta|quinta)\b/)
      const map: Record<string, number> = {
        primeira: 1,
        segunda: 2,
        terceira: 3,
        quarta: 4,
        quinta: 5,
      }
      return m ? (map[m[1]!] ?? null) : null
    }
    return ordinalIndex(choiceText)
  })()
  const wd = weekdayMention(choiceText)

  let byOrdinal: (typeof opts)[0] | null = null
  if (ord != null && ord >= 1 && ord <= opts.length) {
    byOrdinal = opts[ord - 1]!
  }

  let byWeekday: (typeof opts)[0] | null = null
  if (wd) {
    const hits = opts.filter((o) => optionWeekday(o.label) === wd)
    if (hits.length === 1) byWeekday = hits[0]!
    else if (hits.length > 1) return { kind: 'ambiguous' }
  }

  if (byOrdinal && byWeekday) {
    if (byOrdinal.key === byWeekday.key) {
      return { kind: 'match', key: byOrdinal.key, label: byOrdinal.label }
    }
    // Leituras divergentes → pergunta de volta, sem escolher (DEC-127.2)
    return { kind: 'ambiguous' }
  }
  if (byOrdinal) return { kind: 'match', key: byOrdinal.key, label: byOrdinal.label }
  if (byWeekday) return { kind: 'match', key: byWeekday.key, label: byWeekday.label }

  // Match exact key/label
  const folded = fold(choiceText)
  const exact = opts.filter((o) => fold(o.label) === folded || fold(o.key) === folded)
  if (exact.length === 1) return { kind: 'match', key: exact[0]!.key, label: exact[0]!.label }

  return { kind: 'none' }
}

/** 24 h sem mensagem da cliente desde a criação do pending/lastOffer (DEC-127.1). */
export const PENDING_OFFER_TTL_MS = 24 * 60 * 60 * 1000

/**
 * Validade: deriva de `created_at` da mensagem que criou pending/lastOffer
 * (contrato sem campo de data — ADR deixa o PR fixar). 23h59 vale; 24h01 não.
 */
export function isPendingOfferFresh(
  createdAtMs: number | null | undefined,
  nowMs: number,
  ttlMs: number = PENDING_OFFER_TTL_MS,
): boolean {
  if (createdAtMs == null || !Number.isFinite(createdAtMs)) return false
  const age = nowMs - createdAtMs
  return age >= 0 && age <= ttlMs
}
