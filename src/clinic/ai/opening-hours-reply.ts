/**
 * FAQ de expediente sem LLM: detecção ampla e resposta a partir de janelas / bloqueios.
 */
import type { Clock } from '../../db/clock'
import { listBlocks } from '../config/blocks'
import { ensureClinicSettings } from '../config/settings'
import { CLINIC_SCOPE_ID } from '../config/types'
import { clinicCivilDateFromUtc } from '../scheduling/timezone'
import type { ClinicDb } from '../store'
import { sayAct } from './dialogue-acts'
import { isOpeningDayAsk } from './opening-day-ask'
import {
  clinicWideClosureOnCivilDay,
  listProfessionalOpeningWindows,
} from './opening-source'
import { addCivilDays, weekdayOfCivil } from './slot-offer'
import { formatOpeningHours } from './schedule-context'
import { hasBookingDayOrPeriodCue } from './nlu/temporal'

/** Mesma família que `catalog-reply` HOURS + variantes e typos comuns. */
const HOURS_FAQ =
  /\b(hor[aá]rio de funcionamento|que horas (voc[eê]s )?(abrem|funcionam|atendem|fecham)|at[eé]?\s*que horas (voc[eê]s )?(ficam|funcionam|atendem|fecham)?|tem\s+hor[aá]rio\s+depois\s+das|(abrem|funcionam|atendem|fecham)\s+depois\s+das\s+\d|(hor[aá]rio|atendimento)\s+(noturno|depois\s+das\s+\d))\b/i

const HOLIDAY_ASK = /\bferiad[oa]s?\b/i

const SHORT_DAY =
  /\b(abre(?:m)?|atend(?:e|em)|funciona(?:m)?)\s+(?:no\s+)?(?:s[aá]b(?:ado)?|dom(?:ingo)?)/i

const WEEKDAY_ALIASES: Array<{ re: RegExp; dow: number }> = [
  { re: /\bdom(?:ingo)?\b/i, dow: 7 },
  { re: /\bs[aá]b(?:ado)?\b/i, dow: 6 },
  { re: /\bseg(?:unda)?(?:\s*[- ]?\s*feira)?\b/i, dow: 1 },
  { re: /\bter[cç](?:a)?(?:\s*[- ]?\s*feira)?\b/i, dow: 2 },
  { re: /\bquart[a]?(?:\s*[- ]?\s*feira)?\b/i, dow: 3 },
  { re: /\bquint[a]?(?:\s*[- ]?\s*feira)?\b/i, dow: 4 },
  { re: /\bsexta(?:\s*[- ]?\s*feira)?\b/i, dow: 5 },
]

const WEEKDAY_NAMES = ['', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado', 'domingo']

export function isOpeningHoursFaqAsk(text: string): boolean {
  const body = text.trim()
  if (!body) return false
  return (
    HOURS_FAQ.test(body) ||
    isOpeningDayAsk(body) ||
    HOLIDAY_ASK.test(body) ||
    SHORT_DAY.test(body)
  )
}

/**
 * Marcação no mesmo turno → cede ao encaminhamento «Abrir agenda» (DEC-202), não só FAQ.
 * TRE-77: «pode me atender amanhã?» / disponibilidade sem verbo de marcar **não** é misto —
 * responde o expediente e orienta ao toque em Abrir agenda (sem pedir serviço nem equipe).
 */
export function openingHoursMixedWithBooking(text: string): boolean {
  const body = text.trim()
  if (!body) return false
  if (!isOpeningHoursFaqAsk(body)) return false
  if (/\b(quero|gostaria|preciso)\s+(um\s+)?hor[aá]rio\b/i.test(body)) return true
  if (
    /\b(marcar|agendar)\b/i.test(body) &&
    (/\b\d{1,2}\s*h/i.test(body) || hasBookingDayOrPeriodCue(body))
  ) {
    return true
  }
  if (/\b(disponi|vaga)\b/i.test(body) && hasBookingDayOrPeriodCue(body)) return true
  return false
}

function foldPt(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
}

function weekdayFromText(text: string): number | null {
  const folded = foldPt(text)
  for (const { re, dow } of WEEKDAY_ALIASES) {
    if (re.test(folded)) return dow
  }
  return null
}

function clinicProfessionalWindows(
  db: ClinicDb,
  tenantId: string,
  clock: Clock,
): Array<{ dayOfWeek: number; startMinute: number; endMinute: number }> {
  return listProfessionalOpeningWindows(db, tenantId, clock)
}

function formatUpcomingClinicClosures(
  db: ClinicDb,
  tenantId: string,
  clock: Clock,
  tz: string,
): string[] {
  const now = clock.nowMs()
  const horizon = now + 90 * 24 * 60 * 60 * 1000
  const blocks = listBlocks(db, tenantId, CLINIC_SCOPE_ID).filter(
    (b) => b.startsAt >= now && b.startsAt <= horizon,
  )
  if (blocks.length === 0) return []
  const fmt = new Intl.DateTimeFormat('pt-BR', {
    timeZone: tz,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
  return blocks.slice(0, 6).map((b) => {
    const day = fmt.format(new Date(b.startsAt))
    const note = b.note?.trim()
    return note ? `${day}: ${note}` : `${day}: fechado`
  })
}

/** Rótulo do dia pedido («amanhã (sexta-feira)», «hoje (quinta-feira)», «sábado»). */
function dayAskLabel(date: string, today: string): string {
  const wd = weekdayOfCivil(date)
  const base = WEEKDAY_NAMES[wd]!
  const withFeira = base === 'sábado' || base === 'domingo' ? base : `${base}-feira`
  if (date === today) return `hoje (${withFeira})`
  if (date === addCivilDays(today, 1)) return `amanhã (${withFeira})`
  return withFeira
}

/**
 * Próxima ocorrência civil do dia pedido (hoje / amanhã / depois de amanhã / weekday).
 * Null quando a pergunta é só o expediente genérico («horário de funcionamento»).
 */
export function resolveOpeningHoursAskDate(text: string, today: string): string | null {
  const folded = foldPt(text)
  if (/\bdepois de amanha\b/.test(folded)) return addCivilDays(today, 2)
  if (/\bamanha\b/.test(folded)) return addCivilDays(today, 1)
  if (/\bhoje\b/.test(folded)) return today
  const dow = weekdayFromText(text)
  if (dow == null) return null
  for (let i = 0; i < 7; i++) {
    const date = addCivilDays(today, i)
    if (weekdayOfCivil(date) === dow) return date
  }
  return null
}

export { clinicWideClosureOnCivilDay } from './opening-source'

/**
 * Resposta de expediente a partir do cadastro. Null se misto com marcação
 * (continua o funil / LLM) ou sem janelas configuradas.
 */
export function buildOpeningHoursReply(
  db: ClinicDb,
  tenantId: string,
  clock: Clock,
  text: string,
  conversationId: string,
): string | null {
  const body = text.trim()
  if (!body || !isOpeningHoursFaqAsk(body)) return null
  if (openingHoursMixedWithBooking(body)) return null

  const windows = clinicProfessionalWindows(db, tenantId, clock)
  const lines = formatOpeningHours(windows)
  if (lines.length === 0) {
    return sayAct(
      'informar_expediente',
      conversationId,
      { lista: 'a equipe confirma o horário' },
      'Não tenho o horário cadastrado; a equipe confirma.',
    )
  }

  const civilTz = ensureClinicSettings(db, tenantId, clock).timezone
  const today = clinicCivilDateFromUtc(civilTz, clock.nowMs())
  const askedDate = resolveOpeningHoursAskDate(body, today)

  let lista = lines.join('\n')
  let fallback = `Funcionamos assim:\n${lista}`

  if (HOLIDAY_ASK.test(body) && askedDate == null) {
    const closures = formatUpcomingClinicClosures(db, tenantId, clock, civilTz)
    if (closures.length > 0) {
      lista = `Fechamentos programados:\n${closures.join('\n')}\n\nExpediente habitual:\n${lista}`
      fallback = lista
    }
  } else if (askedDate != null) {
    const label = dayAskLabel(askedDate, today)
    const closure = clinicWideClosureOnCivilDay(db, tenantId, askedDate, civilTz, windows)
    if (closure.closed) {
      lista = `${label}: fechado`
      const cap = label.charAt(0).toUpperCase() + label.slice(1)
      fallback = closure.note
        ? `${cap} a clínica está fechada (${closure.note}).`
        : `${cap} a clínica está fechada.`
    } else {
      const dow = weekdayOfCivil(askedDate)
      const weeklyLine = lines[dow - 1]
      if (weeklyLine) {
        const hours = weeklyLine.slice(weeklyLine.indexOf(':') + 1).trim()
        lista = `${label}: ${hours}`
        const cap = label.charAt(0).toUpperCase() + label.slice(1)
        fallback =
          hours === 'fechado' ? `${cap}: fechamos.` : `${cap}: atendemos ${hours}.`
      }
    }
  }

  return sayAct('informar_expediente', conversationId, { lista }, fallback)
}
