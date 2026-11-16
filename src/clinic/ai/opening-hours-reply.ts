/**
 * FAQ de expediente sem LLM: detecção ampla e resposta a partir de janelas / bloqueios.
 */
import type { Clock } from '../../db/clock'
import { listEffectiveWeeklyWindows } from '../config/availability'
import { listBlocks } from '../config/blocks'
import { listResources } from '../config/resources'
import { ensureClinicSettings } from '../config/settings'
import { CLINIC_SCOPE_ID } from '../config/types'
import type { ClinicDb } from '../store'
import { sayAct } from './dialogue-acts'
import { isOpeningDayAsk } from './opening-day-ask'
import { formatOpeningHours } from './schedule-context'

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

const PERIOD =
  /\b(amanh[aã]|hoje|segunda|ter[cç]a|quarta|quinta|sexta|s[aá]bado|domingo|manh[aã]|tarde|noite)\b/i

/** Marcação no mesmo turno → cede ao funil (não só FAQ de expediente). */
export function openingHoursMixedWithBooking(text: string): boolean {
  const body = text.trim()
  if (!body || !isOpeningHoursFaqAsk(body)) return false
  if (/\b(quero|gostaria|preciso)\s+(um\s+)?hor[aá]rio\b/i.test(body)) return true
  if (/\b(marcar|agendar)\b/i.test(body) && (/\b\d{1,2}\s*h/i.test(body) || PERIOD.test(body))) {
    return true
  }
  if (/\b(disponi|vaga)\b/i.test(body) && PERIOD.test(body)) return true
  return false
}

function weekdayFromText(text: string): number | null {
  const folded = text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
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
  const resources = listResources(db, tenantId, clock)
  const pros = new Set(resources.filter((r) => r.kind === 'professional').map((r) => r.id))
  return listEffectiveWeeklyWindows(db, tenantId)
    .filter((w) => pros.has(w.resourceId))
    .map((w) => ({ dayOfWeek: w.dayOfWeek, startMinute: w.startMinute, endMinute: w.endMinute }))
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

function singleDayCopy(line: string): string {
  const idx = line.indexOf(':')
  if (idx < 0) return line
  const dayName = line.slice(0, idx).trim()
  const hours = line.slice(idx + 1).trim()
  const cap = dayName.charAt(0).toUpperCase() + dayName.slice(1)
  if (hours === 'fechado') return `${cap}: fechamos.`
  return `${cap}: atendemos ${hours}.`
}

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

  const asked = weekdayFromText(body)
  let lista = lines.join('\n')
  let fallback = `Funcionamos assim:\n${lista}`

  if (HOLIDAY_ASK.test(body)) {
    const closures = formatUpcomingClinicClosures(db, tenantId, clock, civilTz)
    if (closures.length > 0) {
      lista = `Fechamentos programados:\n${closures.join('\n')}\n\nExpediente habitual:\n${lista}`
      fallback = lista
    }
  } else if (asked != null) {
    const line = lines[asked - 1]
    if (line) {
      lista = line
      fallback = singleDayCopy(line)
    }
  }

  return sayAct('informar_expediente', conversationId, { lista }, fallback)
}