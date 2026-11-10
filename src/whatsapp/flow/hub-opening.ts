/**
 * Abertura do hub Flow + frases Meus / Informações (TR-306).
 * Copy **Confirmada** (Paulo, 04/11/2026, DEC-104).
 * Horário na abertura (Paulo, 05/11/2026): uma frase com o expediente de hoje,
 * dentro ou fora da janela. A frase «Já estamos fechados…» (opção A, 04/11) fica revogada.
 * Relógio da clínica; sem rótulo IANA. Confirmar continua no chat (DEC-061).
 */
import type { Clock } from '../../db/clock'
import { listEffectiveWeeklyWindows } from '../../clinic/config/availability'
import { listServices } from '../../clinic/config/services'
import { ensureClinicSettings } from '../../clinic/config/settings'
import { textCitesSynonym } from '../../clinic/config/synonyms'
import type { ServiceRow } from '../../clinic/config/types'
import { extractServices } from '../../clinic/ai/autobook'
import { catalogMissHint } from '../../clinic/ai/booking-object'
import { citesServiceName } from '../../clinic/ai/schedule-choice'
import {
  formatClinicTime,
  formatOpeningHours,
} from '../../clinic/ai/schedule-context'
import { isCancelIntent, isRescheduleIntent } from '../../clinic/ai/reschedule'
import { RESCHEDULE_RE } from '../../clinic/ai/nlu/sensitive'
import { clinicCivilDateFromUtc } from '../../clinic/scheduling/timezone'
import type { ClinicDb } from '../../clinic/store'
import { FLOW_COPY } from './copy'

const WEEKDAYS = ['', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado', 'domingo']

const GREET_ONLY = /^(oi|ol[aá]|bom dia|boa tarde|boa noite|oie|opa)([\s,]+tudo bem)?[\s!.?]*$/i
const VAGUE_ASK =
  /^(tudo bem|td bem|e a[ií]|opa)[\s!.?]*$/i
const VAGUE_BOOK =
  /\b(quero|gostaria|marcar|agendar|hor[aá]rio|disponi|vaga|atendimento)\b/i

/** Cumprimento / «tudo bem» puro — sem dia/período de marcação. */
export function isHubGreetingText(text: string): boolean {
  const trimmed = text.trim()
  return GREET_ONLY.test(trimmed) || VAGUE_ASK.test(trimmed)
}

/** Campos mínimos para detectar serviço nomeado no gatilho do hub. */
export type HubServiceHint = {
  id: string
  name: string
  active: boolean
  synonyms?: string[] | null
  /** Variantes (DEC-078/079). Presentes em `ServiceRow`: o gate usa o matcher do funil. */
  zones?: ServiceRow['zones']
}

function weekdayOf(civilDate: string): number {
  const [y, m, d] = civilDate.split('-').map(Number) as [number, number, number]
  // UTC noon evita DST edge; civilDate já é do fuso da clínica.
  const dow = new Date(Date.UTC(y, m - 1, d, 12, 0)).getUTCDay()
  return dow === 0 ? 7 : dow
}

function namedBookableServices(services: HubServiceHint[], text: string): HubServiceHint[] {
  const active = services.filter((s) => s.active)
  const folded = text.toLowerCase()
  const exact = active.filter((s) => {
    const name = s.name.trim().toLowerCase()
    return name.length > 0 && folded.includes(name)
  })
  if (exact.length > 0) return exact
  const bySynonym = active.filter((s) =>
    (s.synonyms ?? []).some((syn) => textCitesSynonym(text, syn)),
  )
  if (bySynonym.length > 0) return bySynonym
  const fuzzy = active.filter((s) => citesServiceName(text, s.name))
  if (fuzzy.length > 0) return fuzzy
  // CF-36 (sonda L4 05/11/2026): variante citada sem o nome do serviço
  // («drenagem linfática», «ventosaterapia») — mesmo resolver do funil.
  if (active.length > 0 && active.every((s) => Array.isArray(s.zones))) {
    const ids = new Set(extractServices(text, active as ServiceRow[]).map((s) => s.id))
    return active.filter((s) => ids.has(s.id))
  }
  return []
}

/**
 * Cumprimento ou pedido vago → candidato ao CTA do hub (mesmo gate ops que a
 * oferta Flow: o autodraft só chama isto quando `prepareBookingFlowOffer` existe).
 * Remarcar / cancelar / serviço nomeado (ex. depilar) → caminho directo.
 *
 * Não exige «sem outbound»: após funil fechado / recomeço, «Oi» também abre o hub
 * (staging 04/11/2026: com histórico a abertura caía no LLM com link Google).
 * O CTA em si ainda exige quadro sem pedido (`shouldAttachHubOpeningCta`).
 */
export function shouldOfferHubOpening(input: {
  turnText: string
  services: HubServiceHint[]
}): boolean {
  const text = input.turnText.trim()
  if (!text) return false
  if (isCancelIntent(text)) return false
  if (
    isRescheduleIntent(text, { hasUpcoming: true, priorOffer: false }) ||
    isRescheduleIntent(text, { hasUpcoming: false, priorOffer: false })
  ) {
    return false
  }
  // Cumprimento puro não nomeia serviço: evita correr o resolvedor do funil no caso mais frequente.
  if (GREET_ONLY.test(text) || VAGUE_ASK.test(text)) return true
  if (namedBookableServices(input.services, text).length > 0) return false
  // Pedido vago de marcar sem nomear serviço («quero marcar», «quero agendar um horário»).
  if (VAGUE_BOOK.test(text) && text.length <= 80) {
    // Paulo, 08/11/2026 (DEC-151): intenção de marcar com termo que não casa no
    // catálogo («Quero agendar uma mensagem», typo; «Quero depilar» sem sinónimo)
    // NÃO é abertura vaga — cai no clarificar / «não entendi», sem Olá + Abrir opções.
    // Sem fuzzy mensagem→massagem (Paulo recusou).
    const forMiss = input.services.map((s) => ({
      name: s.name,
      zones: s.zones ?? [],
    })) as ServiceRow[]
    if (catalogMissHint(text, forMiss)) return false
    return true
  }
  return false
}

/**
 * Quadro no meio de um pedido. Paulo, 07/11/2026: enquanto a cliente ainda
 * responde a uma pergunta (coleta, pendente, oferta, Pix, remarcação),
 * «Oi» não abre o hub. Depois da oferta fechada (`ofertado` / `proposto`),
 * um «Oi» novo volta a abrir o hub — é o caminho do Remarcar (FL-13).
 */
export function bookingFrameHasIntent(
  frame: {
    serviceId?: string | null
    phase?: string | null
    pending?: unknown
    lastOffer?: unknown
  } | null | undefined,
): boolean {
  if (!frame) return false
  if (frame.pending) return true
  if (frame.lastOffer) return true
  if (frame.phase === 'remarcando' || frame.phase === 'pix_pendente') return true
  // Serviço ainda por fechar. Sem fase explícita, o serviço sozinho conta
  // como coleta (o quadro acabou de abrir o pedido).
  if (frame.serviceId && (frame.phase == null || frame.phase === 'coletando')) return true
  return false
}

/**
 * CTA «Abrir opções» só na abertura vaga com o quadro vazio.
 * O hub (títulos e roteamento) não muda; o que muda é quando o botão sai.
 */
export function shouldAttachHubOpeningCta(input: {
  turnText: string
  services: HubServiceHint[]
  frame?: Parameters<typeof bookingFrameHasIntent>[0]
}): boolean {
  if (bookingFrameHasIntent(input.frame)) return false
  return shouldOfferHubOpening({ turnText: input.turnText, services: input.services })
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

/** Hora de fecho de hoje no relógio da clínica, ou null se sem janela. */
export function todayClosingHourLabel(
  db: ClinicDb,
  tenantId: string,
  clock: Clock,
): string | null {
  return clinicTodayOpenState(db, tenantId, clock).closesAt
}

/** Clínica aberta agora no expediente de hoje (relógio local). */
export function isClinicOpenNow(db: ClinicDb, tenantId: string, clock: Clock): boolean {
  return clinicTodayOpenState(db, tenantId, clock).openNow
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
 * Mesmo efeito que o hub Flow `meus` → `hubMeusBody` (FL-07): lista ou
 * «não tem horário marcado», sem handoff. Sem este atalho o redator de
 * exceção inventava «a equipe vai verificar» + botão sem `notifyHumanHandoff`.
 * Não casa remarcar/cancelar/«outro agendamento» (DEC-091 / DEC-142).
 */
const MY_APPOINTMENTS_RE =
  /\b(?:quais|quero\s+ver|ver|consultar|mostra|mostrar|listar)?\s*(?:sao\s+)?(?:os\s+)?meus?\s+(?:agendamentos?|horarios?|marcacoes?|compromissos?)\b|\b(?:tenho|tem)\s+(?:algum\s+)?(?:agendamento|horario\s+marcado|marcacao)\b|\bo\s+que\s+(?:eu\s+)?tenho\s+marcado\b/i

export function isMyAppointmentsQuery(text: string): boolean {
  const body = text.trim()
  if (!body) return false
  if (isCancelIntent(body) || RESCHEDULE_RE.test(body)) return false
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
  if (appts.length === 0) return FLOW_COPY.hubMeusNone
  const lista = appts
    .map((a) => `${a.serviceName} ${formatAptWhen(tz, a.startsAt)}`)
    .join('; ')
  return FLOW_COPY.hubMeusList(appts.length, lista)
}

/** Informações — expediente + link configurado (se houver). Sem URL hardcoded. */
export function hubInformacoesBody(db: ClinicDb, tenantId: string, clock: Clock): string {
  const settings = ensureClinicSettings(db, tenantId, clock)
  const windows = listEffectiveWeeklyWindows(db, tenantId)
  const hours =
    windows.length > 0
      ? formatOpeningHours(windows).join('\n')
      : 'Horário de funcionamento: a equipe confirma.'
  const link = settings.googleBusinessUrl?.trim()
  if (link) return `${hours}\n${link}`
  const address = settings.clinicAddress?.trim()
  if (address) return `${hours}\n${address}`
  return hours
}

/** Serviços activos da clínica para o detector de nome. */
export function activeServicesForHub(db: ClinicDb, tenantId: string): ServiceRow[] {
  return listServices(db, tenantId).filter((s) => s.active)
}
