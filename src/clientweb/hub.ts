/**
 * Frases fixas do chat que não marcam nada (DEC-202): abertura com o expediente de hoje e
 * detecção de «Meus agendamentos». Antes viviam no hub do WhatsApp Flow.
 * «Meus agendamentos» no autodraft envia o link da página (TRE-74), sem lista em texto.
 * Relógio da clínica; sem rótulo IANA.
 */
import type { Clock } from '../db/clock'
import { listEffectiveWeeklyWindows } from '../clinic/config/availability'
import { ensureClinicSettings } from '../clinic/config/settings'
import { clinicCivilDateFromUtc } from '../clinic/scheduling/timezone'
import type { ClinicDb } from '../clinic/store'
import { isCancelRequest, isRescheduleRequest } from './route-intent'

function weekdayOf(civilDate: string): number {
  const [y, m, d] = civilDate.split('-').map(Number) as [number, number, number]
  // UTC noon evita DST edge; civilDate já é do fuso da clínica.
  const dow = new Date(Date.UTC(y, m - 1, d, 12, 0)).getUTCDay()
  return dow === 0 ? 7 : dow
}


export type ClinicTodayOpenState = {
  /** HH:MM da primeira abertura de hoje; null sem início válido. */
  opensAt: string | null
  /** HH:MM do último fecho de hoje; null sem fim válido. */
  closesAt: string | null
  /** Relógio local da clínica: dentro de alguma janela de hoje. Não escolhe a frase. */
  openNow: boolean
}

/** HH:MM no relógio da clínica. Sem rótulo de fuso. */
function formatClinicHm(minute: number): string {
  const hh = String(Math.floor(minute / 60)).padStart(2, '0')
  const mm = String(minute % 60).padStart(2, '0')
  return `${hh}:${mm}`
}

/**
 * Expediente de hoje no relógio da clínica (sem rótulo IANA).
 * `{abre}` é a primeira abertura e `{fecho}` o último fecho do dia
 * (união das janelas efectivas). O mesmo par dentro ou fora da janela.
 */
export function clinicTodayOpenState(
  db: ClinicDb,
  tenantId: string,
  clock: Clock,
): ClinicTodayOpenState {
  const settings = ensureClinicSettings(db, tenantId, clock)
  const tz = settings.timezone || 'America/Sao_Paulo'
  const now = clock.nowMs()
  const today = clinicCivilDateFromUtc(tz, now)
  const dow = weekdayOf(today)
  const windows = listEffectiveWeeklyWindows(db, tenantId).filter((w) => w.dayOfWeek === dow)
  if (windows.length === 0) return { opensAt: null, closesAt: null, openNow: false }
  const minute = (() => {
    const label = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(new Date(now))
    const [hh, mm] = label.split(':').map(Number) as [number, number]
    return hh * 60 + mm
  })()
  const openNow = windows.some((w) => w.startMinute <= minute && minute < w.endMinute)
  const starts = windows
    .map((w) => w.startMinute)
    .filter((m) => Number.isFinite(m) && m >= 0 && m < 24 * 60)
  const ends = windows
    .map((w) => w.endMinute)
    .filter((m) => Number.isFinite(m) && m > 0 && m <= 24 * 60)
  return {
    opensAt: starts.length > 0 ? formatClinicHm(Math.min(...starts)) : null,
    closesAt: ends.length > 0 ? formatClinicHm(Math.max(...ends)) : null,
    openNow,
  }
}


function knownBound(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

/**
 * C1h — corpo da mensagem com CTA Abrir opções.
 * Paulo, 05/11/2026: uma frase, dentro ou fora da janela. Sem «fechados»,
 * «ainda não abrimos» ou «agendar mesmo assim». Sem horas: nome e a pergunta.
 * Um só limite conhecido entra na frase; o outro não é inventado.
 */
export function hubOpeningBody(
  clinicName: string | null | undefined,
  hours: { opensAt: string | null; closesAt: string | null } | null | undefined,
): string {
  const name = clinicName?.trim() || 'clínica'
  const opensAt = knownBound(hours?.opensAt)
  const closesAt = knownBound(hours?.closesAt)
  if (opensAt && closesAt) {
    return `Olá! Aqui é a ${name}. Hoje funcionamos das ${opensAt} às ${closesAt}. O que você precisa?`
  }
  if (opensAt) {
    return `Olá! Aqui é a ${name}. Hoje funcionamos a partir das ${opensAt}. O que você precisa?`
  }
  if (closesAt) {
    return `Olá! Aqui é a ${name}. Hoje funcionamos até às ${closesAt}. O que você precisa?`
  }
  return `Olá! Aqui é a ${name}. O que você precisa?`
}


/**
 * Texto livre «meus agendamentos» / «quais os meus horários» (TRE-74 → link da página).
 * Sem este atalho o redator de exceção inventava «a equipe vai verificar».
 * Não casa remarcar/cancelar/«outro agendamento» (DEC-091 / DEC-142).
 * Não casa disponibilidade («tem agendamento amanhã?») nem preferência de
 * slot («quero meu horário das 10») — só 1.ª pessoa / possessivo de lista.
 */
const MY_APPOINTMENTS_RE =
  /\b(?:quais|quero\s+ver|ver|consultar|mostra|mostrar|listar)\s+(?:sao\s+)?(?:os\s+)?meus?\s+(?:agendamentos?|horarios?|marcacoes?|compromissos?)\b|\bmeus?\s+agendamentos?\b|\bmeus\s+horarios?\b|\bmeus?\s+(?:marcacoes?|compromissos?)\b|\b(?:ja\s+)?tenho\s+(?:algum[a]?\s+)?(?:agendamento|horario\s+marcado|marcacao)\b|\bo\s+que\s+(?:eu\s+)?tenho\s+marcado\b|\bquando\s+(?:e|é)\s+(?:minha|meu|o)\s+/i

export function isMyAppointmentsQuery(text: string): boolean {
  const body = text.trim()
  if (!body) return false
  if (isCancelRequest(body) || isRescheduleRequest(body)) return false
  if (/\boutro\s+agendamento\b/i.test(body)) return false
  const folded = body.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
  return MY_APPOINTMENTS_RE.test(folded)
}
