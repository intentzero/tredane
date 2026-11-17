/**
 * Frases fixas do chat que não marcam nada (DEC-202): abertura com o expediente de hoje e
 * «Meus agendamentos». Antes viviam no hub do WhatsApp Flow.
 * Relógio da clínica; sem rótulo IANA.
 */
import type { Clock } from '../db/clock'
import { listEffectiveWeeklyWindows } from '../clinic/config/availability'
import { listServices } from '../clinic/config/services'
import { ensureClinicSettings } from '../clinic/config/settings'
import type { ServiceRow } from '../clinic/config/types'
import { formatClinicTime } from '../clinic/ai/schedule-context'
import { clinicCivilDateFromUtc } from '../clinic/scheduling/timezone'
import type { ClinicDb } from '../clinic/store'
import { isCancelRequest, isRescheduleRequest } from './route-intent'

/** DEC-202: as frases acabam a apontar para o pedido, que recebe o link «Abrir agenda». */
const HUB_MEUS_NONE = 'Você não tem horário marcado. Para agendar, é só pedir aqui.'

function hubMeusList(n: number, lista: string): string {
  return `Você tem ${n}: ${lista}. Para remarcar ou cancelar, é só pedir aqui.`
}

const WEEKDAYS = ['', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado', 'domingo']


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


export type UpcomingHubApt = {
  serviceName: string
  startsAt: number
}

export function listUpcomingForHub(
  db: ClinicDb,
  tenantId: string,
  contactId: string,
  now: number,
  limit = 5,
): UpcomingHubApt[] {
  return db.all<{ starts_at: number; service_name: string | null }>(
    `SELECT a.starts_at AS starts_at, s.name AS service_name
     FROM appointments a
     LEFT JOIN services s ON s.tenant_id = a.tenant_id AND s.id = a.service_id
     WHERE a.tenant_id = ? AND a.contact_id = ? AND a.status = 'confirmed' AND a.starts_at > ?
     ORDER BY a.starts_at LIMIT ?`,
    tenantId,
    contactId,
    now,
    limit,
  ).map((a) => ({
    startsAt: a.starts_at,
    serviceName: a.service_name?.trim() || 'Atendimento',
  }))
}

function formatAptWhen(tz: string, startsAt: number): string {
  const date = clinicCivilDateFromUtc(tz, startsAt)
  const [, m, d] = date.split('-')
  const dow = weekdayOf(date)
  return `${WEEKDAYS[dow]} ${d}/${m} às ${formatClinicTime(tz, startsAt)}`
}


/**
 * Texto livre «meus agendamentos» / «quais os meus horários» (smoke staging).
 * Lista ou
 * «não tem horário marcado», sem handoff. Sem este atalho o redator de
 * exceção inventava «a equipe vai verificar» + botão sem `notifyHumanHandoff`.
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

/** Meus — Confirmado Paulo 04/11/2026. */
export function hubMeusBody(
  db: ClinicDb,
  tenantId: string,
  contactId: string,
  clock: Clock,
): string {
  const settings = ensureClinicSettings(db, tenantId, clock)
  const tz = settings.timezone || 'America/Sao_Paulo'
  const appts = listUpcomingForHub(db, tenantId, contactId, clock.nowMs())
  if (appts.length === 0) return HUB_MEUS_NONE
  const lista = appts
    .map((a) => `${a.serviceName} ${formatAptWhen(tz, a.startsAt)}`)
    .join('; ')
  return hubMeusList(appts.length, lista)
}


/** Serviços activos da clínica para o detector de nome. */
export function activeServicesForHub(db: ClinicDb, tenantId: string): ServiceRow[] {
  return listServices(db, tenantId).filter((s) => s.active)
}
