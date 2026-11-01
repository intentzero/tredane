/**
 * Agendamento pela IA após confirmação explícita da própria cliente
 * (decidido por Paulo, 28/10/2026 — ver DEC-006 / DEC-056 em docs/product/decisions.md).
 *
 * Regra: o backend envia a proposta quando dia, horário e procedimento ficam determinados
 * sem ambiguidade. Cada elemento vem da vez atual da cliente ou, se ela não o repetir,
 * da mensagem mais recente que cite um único valor (não só a bolha imediatamente anterior).
 * «1530» e «às 13» contam como horário. Zona já dita pela cliente numa mensagem
 * anterior conta; a lista que a clínica ofereceu não escolhe a zona. Faltou ou
 * ficou ambíguo → não envia proposta. Detecção
 * determinística, sem o modelo.
 *
 * S2 (#173, épico #171): esta leitura de texto livre NUNCA marca — só produz nota para a atendente.
 * Com a capacidade ligada (sempre, salvo pausa da owner), o backend monta e envia a proposta
 * versionada com botão WhatsApp (S3–S4). A marcação/Pix fica no clique autenticado (S5 #176 /
 * DEC-061: `executeProposalConfirmOp`). Serviço com sinal: Pix sem hold (DEC-047); horário só
 * após pagamento (#39).
 */
import type { Clock } from '../../db/clock'
import { AI_AUTOBOOK_ACTOR } from '../constants'
import { getContact } from '../contacts'
import { listResources } from '../config/resources'
import { listServices } from '../config/services'
import { explicitAudienceLine } from '../catalog/audience'
import { quoteVisit, variantAudiencesConflict, zonesNamedInText } from '../config/zones'
import { ensureClinicSettings } from '../config/settings'
import type { ServiceRow } from '../config/types'
import type { ClinicCaller } from '../envelopes'
import { getConversation } from '../inbox/conversations'
import type { OutboxRow } from '../outbox'
import { createProposal } from '../proposals/proposals'
import { sendProposalToWhatsAppOp } from '../proposals/send'
import { clinicCivilDateFromUtc } from '../scheduling/timezone'
import { openPendingCommunication } from '../proposals/pending-communication'
import { TEMPO_REFUSED_PHRASE, TEMPO_UNCONFIRMED_PHRASE } from '../proposals/render'
import { queryAvailability } from '../scheduling/query'
import { queryAutomaticAvailability } from '../tempo/automatic'
import { evaluateServiceTempo, type ForecastAdapter } from '../tempo/evaluate'
import { readOpenMeteo } from '../tempo/open-meteo'
import type { ClinicDb } from '../store'
import type { AbuseLimits } from './abuse-limits'
import {
  DEFAULT_OPTION_KIND_PLURAL,
  MIXED_AUDIENCE_REPLY,
  SERVICE_NOT_FOUND_REPLY,
  teamConfirmsSoonReply,
} from './client-copy'
import { checkConversationProtection } from './protection'
import { resolveBookingObject, servicesFromBookingMatch } from './booking-object'
import {
  audienceLineFromClientTexts,
  citesServiceName,
  claimsWholeCatalog,
  zonesChosenInClientTexts,
  zonesOfferedToClient,
} from './schedule-choice'
import { getScheduleSession, saveScheduleLine, saveScheduleSession, scheduleFactsFromText } from './schedule-session'
import {
  audienceLineQuestion,
  needsAudienceLine,
  stableVariantLabelList,
  variantListQuestion,
  zonesForAudienceLine,
} from './variant-line'
import { extractDates, extractTimes, norm } from './nlu/temporal'

export { extractDates, extractTimes, norm }

export const AI_AUTOBOOK_ACTOR_ID = AI_AUTOBOOK_ACTOR
export const AI_AUTOBOOK_ACTOR_NAME = 'IA (agendamento automático)'

export type AutoBookStatus =
  | 'booked'
  | 'needs_info'
  | 'ambiguous'
  | 'not_confirmed'
  | 'unavailable'
  | 'requires_button'
  | 'blocked'
  | 'needs_signal'
  | 'disabled'

export type AutoBookOutcome = {
  status: AutoBookStatus
  /** Elementos em falta ou ambíguos (para a nota interna). */
  missing: Array<'dia' | 'horario' | 'procedimento'>
  confirmationMessageId: string | null
  serviceId?: string
  date?: string
  time?: string
  appointmentId?: string
  /** Proposta criada/enviada quando a capacidade está ligada (S3–S4). */
  proposalId?: string
  proposalVersion?: number
  /** Texto determinístico para o rascunho (substitui o do modelo), quando aplicável. */
  replyText?: string
  notes?: string
  outbox: OutboxRow[]
}

const WEEKDAY_LABEL = ['', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado', 'domingo']

function addDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number]
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10)
}

function weekdayOf(date: string): number {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number]
  const js = new Date(Date.UTC(y, m - 1, d)).getUTCDay()
  return js === 0 ? 7 : js
}

function significantWords(name: string): string[] {
  return norm(name)
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3)
}

/**
 * Serviços activos cujo nome inteiro (todas as palavras) aparece no texto.
 * Sem filtro de audiência aqui: «masculina»/«feminina» no nome do serviço
 * (ex.: «Depilação masculina amanhã…») não é pedido de linha da cliente.
 * O filtro de audiência fica no catálogo da IA (`buildAiContextPayload`).
 */
export function extractServices(text: string, services: ServiceRow[]): ServiceRow[] {
  const words = new Set(norm(text).split(/[^a-z0-9]+/).filter(Boolean))
  const hits = services.filter((s) => {
    const sw = significantWords(s.name)
    return sw.length > 0 && sw.every((w) => words.has(w))
  })
  // Preferência: matching exacto legado (todas as palavras). Depois, o resolver de objecto.
  if (hits.length > 0) {
    return hits.filter(
      (s) =>
        !hits.some(
          (o) =>
            o.id !== s.id
            && significantWords(o.name).length > significantWords(s.name).length
            && significantWords(s.name).every((w) => significantWords(o.name).includes(w)),
        ),
    )
  }
  const fuzzy = services.filter((s) => citesServiceName(text, s.name))
  if (fuzzy.length > 0) return fuzzy
  // Só usa o resolver quando o catálogo traz zonas (fixtures parciais ficam no legado).
  if (!services.every((s) => Array.isArray(s.zones))) return []
  return servicesFromBookingMatch(resolveBookingObject({ text, services }), services)
}

const AFFIRMATIVE =
  /\b(sim|pode ser|pode marcar|pode agendar|pode|confirmo|confirmado|confirma|fechado|combinado|quero|isso|ok|okay|perfeito|beleza|blz|otimo|bora|marca|marcar|agenda|agendar|serve|fica bom|esta otimo|ta bom|ta otimo|certo)\b/
/**
 * Hesitação por expressão (#410 / CF-05). Palavras soltas («ver», «acho», «não», «outra»)
 * não bloqueiam aceite nem pedido completo; «não, 16h» é correção de horário.
 */
const HESITATION_PHRASE =
  /\b(vou ver|vou pensar|talvez|nao sei|depois eu vejo|mais tarde)\b/
const RESCHEDULE = /\b(reagend\w*|remarc\w*|desmarc\w*|cancel\w*|mudar|trocar|adiar)\b/

/** Preferência «com a Bia» quando a profissional faz o serviço (#410 / CF-20). */
function preferredProfessionalId(
  db: ClinicDb,
  tenantId: string,
  text: string,
  service: ServiceRow,
  clock: Clock,
): string | undefined {
  const pros = listResources(db, tenantId, clock).filter(
    (r) => r.kind === 'professional' && r.active && r.name.trim().length >= 2,
  )
  const mentioned = pros.filter((p) =>
    new RegExp(`\\b${p.name.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(text),
  )
  const inService = mentioned.filter((p) => service.professionalIds.includes(p.id))
  return inService.length === 1 ? inService[0]!.id : undefined
}

type Msg = { id: string; direction: string; body: string; created_at: number }

export function detectExplicitConfirmation(input: {
  clientTexts: string[]
  previousClinicText: string | null
  /** Mensagens mais antigas, da mais recente para a mais antiga, fora da vez atual. */
  historyTexts?: string[]
  clientToday: string
  clinicToday: string
  services: ServiceRow[]
}): {
  ok: boolean
  status: AutoBookStatus
  missing: Array<'dia' | 'horario' | 'procedimento'>
  date?: string
  time?: string
  service?: ServiceRow
} {
  const client = input.clientTexts.join('\n')
  const c = norm(client)
  const prev = input.previousClinicText ?? ''
  if (RESCHEDULE.test(c)) return { ok: false, status: 'not_confirmed', missing: [] }
  if (HESITATION_PHRASE.test(c.replace(/\bdepois de amanha\b/g, 'amanha'))) {
    return { ok: false, status: 'ambiguous', missing: [] }
  }

  const cDates = extractDates(client, input.clientToday)
  const cTimes = extractTimes(client)
  const cServices = extractServices(client, input.services)
  const pDates = extractDates(prev, input.clinicToday)
  const pTimes = extractTimes(prev)
  const pServices = extractServices(prev, input.services)

  const affirmative = AFFIRMATIVE.test(c)
  // «sim/pode ser…» OU horário de relógio («15h», «1530») OU dia absoluto
  // já resolvido com um serviço (oferta de período, ex. B-04 «semana que vem de manhã»).
  if (!affirmative && cTimes.size === 0 && !(cDates.size === 1 && cServices.length === 1)) {
    return { ok: false, status: 'not_confirmed', missing: [] }
  }

  const missing: Array<'dia' | 'horario' | 'procedimento'> = []
  let ambiguous = false
  const history = input.historyTexts ?? []
  const resolve = <T,>(
    own: T[],
    prior: T[],
    label: 'dia' | 'horario' | 'procedimento',
    fromText: (text: string) => T[],
  ): T | undefined => {
    if (own.length === 1) return own[0]
    if (own.length > 1) { ambiguous = true; missing.push(label); return undefined }
    if (prior.length === 1) return prior[0]
    if (prior.length > 1) { ambiguous = true; missing.push(label); return undefined }
    for (const text of history) {
      const found = fromText(text)
      if (found.length === 1) return found[0]
      if (found.length > 1) { ambiguous = true; missing.push(label); return undefined }
    }
    missing.push(label)
    return undefined
  }
  const date = resolve([...cDates], [...pDates], 'dia', (text) => [...extractDates(text, input.clinicToday)])
  const time = resolve([...cTimes], [...pTimes], 'horario', (text) => [...extractTimes(text)])
  const service = resolve(cServices, pServices, 'procedimento', (text) => extractServices(text, input.services))
  if (missing.length > 0) {
    // Devolve o que já está determinado para a oferta de período / perguntas (#408 B-04).
    return {
      ok: false,
      status: ambiguous ? 'ambiguous' : 'needs_info',
      missing,
      ...(date ? { date } : {}),
      ...(time ? { time } : {}),
      ...(service ? { service } : {}),
    }
  }
  return { ok: true, status: 'requires_button', missing: [], date, time, service }
}

/** Zona escolhida pela cliente. A mensagem da clínica que lista o cardápio não conta. */
function zonesChosenByClient(
  clientTurn: Msg[],
  older: Msg[],
  zones: ServiceRow['zones'],
): { zones: ServiceRow['zones']; ambiguous: boolean } {
  const texts = [
    clientTurn.map((m) => m.body).join('\n'),
    ...older.filter((m) => m.direction === 'inbound').map((m) => m.body),
  ]
  return zonesChosenInClientTexts(texts, zones)
}

export function askZonesReply(phrase: string, zoneNames: string[], time: string): string {
  const list = zoneNames.join(', ')
  return `Para fechar às ${time}, me diga ${phrase}: ${list}. Pode ser mais de uma.`
}

function firstName(label: string | null | undefined): string | null {
  const f = label?.trim().split(/\s+/)[0]
  return f ? f : null
}

function dayText(date: string): string {
  const [, m, d] = date.split('-')
  return `${WEEKDAY_LABEL[weekdayOf(date)]} ${d}/${m}`
}

function localHHMM(tz: string, ms: number): string {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(ms))
}

function signalAmountCents(svc: ServiceRow, priceCents: number | null = svc.priceCents): number | null {
  if (!svc.requiresSignal) return null
  if (svc.signalKind === 'fixed' && svc.signalFixedCents != null) return svc.signalFixedCents
  if (svc.signalKind === 'percent' && svc.signalPercent != null && priceCents != null) {
    return Math.trunc((priceCents * svc.signalPercent) / 100)
  }
  return null
}

function brl(cents: number): string {
  const v = (cents / 100).toFixed(2).split('.')
  return `R$ ${v[0]!.replace(/\B(?=(\d{3})+(?!\d))/g, '.')},${v[1]}`
}

function periodWord(period: 'manha' | 'tarde' | 'noite'): string {
  if (period === 'manha') return 'de manhã'
  if (period === 'tarde') return 'à tarde'
  return 'à noite'
}

function inPeriod(period: 'manha' | 'tarde' | 'noite', hhmm: string): boolean {
  const hour = Number(hhmm.slice(0, 2))
  if (period === 'manha') return hour < 12
  if (period === 'tarde') return hour >= 12 && hour < 18
  return hour >= 18
}

function clockLabel(tz: string, ms: number): string {
  const raw = localHHMM(tz, ms)
  const match = raw.match(/(\d{1,2})\D(\d{2})/)
  if (!match) return raw
  return `${match[1]!.padStart(2, '0')}:${match[2]}`
}

function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? ''
  if (names.length === 2) return `${names[0]} e ${names[1]}`
  return `${names.slice(0, -1).join(', ')} e ${names[names.length - 1]}`
}

/**
 * Zonas e linha já escolhidas, período sem hora de relógio (DEC-090).
 * Oferece horários reais desse período. Não volta a perguntar a linha nem as zonas.
 */
async function offerZonesInPeriod(
  db: ClinicDb,
  tenantId: string,
  service: ServiceRow,
  zones: ServiceRow['zones'],
  period: 'manha' | 'tarde' | 'noite',
  date: string | null,
  tz: string,
  clock: Clock,
  forecast: ForecastAdapter | undefined,
  professionalId?: string,
): Promise<string> {
  const names: string[] = []
  for (const zone of zones) {
    if (!names.includes(zone.name)) names.push(zone.name)
  }
  const label = joinNames(names)
  const when = periodWord(period)
  let duration = service.durationMinutes
  try {
    duration = quoteVisit(
      db,
      tenantId,
      service,
      zones.map((zone) => zone.id),
    ).durationMinutes
  } catch {
    duration = service.durationMinutes
  }
  const today = clinicCivilDateFromUtc(tz, clock.nowMs())
  const dates = date ? [date] : [0, 1, 2, 3, 4, 5, 6].map((offset) => addDays(today, offset))
  const picked: { date: string; time: string }[] = []
  const lastMinute = new Map<string, number>()
  for (const day of dates) {
    if (picked.length >= 3) break
    let slots: { startsAt: number }[] = []
    try {
      const avail = await queryAutomaticAvailability(
        db,
        tenantId,
        {
          serviceId: service.id,
          date: day,
          durationMinutesOverride: duration,
          ...(professionalId ? { professionalId } : {}),
        },
        clock,
        forecast ?? { read: readOpenMeteo },
      )
      if (!avail.schedulingAllowed) continue
      slots = avail.slots
    } catch {
      continue
    }
    for (const slot of slots) {
      if (slot.startsAt <= clock.nowMs()) continue
      const time = clockLabel(tz, slot.startsAt)
      if (!inPeriod(period, time)) continue
      const minute = Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5))
      const prev = lastMinute.get(day)
      if (prev != null && minute - prev < 30) continue
      lastMinute.set(day, minute)
      picked.push({ date: day, time })
      if (picked.length >= 3) break
    }
  }
  const subject = label || service.name
  if (picked.length === 0) {
    return `Para ${subject}, ${when} não tenho horário livre. Quer ver outro período?`
  }
  const byDay = new Map<string, string[]>()
  for (const slot of picked) {
    const list = byDay.get(slot.date) ?? []
    list.push(slot.time)
    byDay.set(slot.date, list)
  }
  const bits = [...byDay.entries()].map(([day, times]) => `${dayText(day)} às ${times.join(', ')}`)
  const listed = bits.length === 1 ? bits[0]! : `${bits.slice(0, -1).join(', ')} e ${bits[bits.length - 1]}`
  return `Para ${subject}, ${when} tenho ${listed}. Qual fica melhor?`
}

/**
 * Tenta marcar pela IA para a conversa. Não lança: devolve o resultado.
 * Idempotente por mensagem de confirmação (clientRequestId = ai-autobook:<messageId>).
 */
export async function tryAiAutoBook(
  db: ClinicDb,
  caller: ClinicCaller,
  clock: Clock,
  input: {
    conversationId: string
    suggestionId?: string | null
    enabled?: boolean
    /**
     * Capacidade efetiva (ligada, salvo pausa da owner).
     * Texto livre nunca marca; com capacidade ligada o backend envia a proposta/botão.
     */
    capability?: boolean
    /** Limites S7 ao criar proposta (opcional). */
    abuseLimits?: AbuseLimits
    /** Previsão fictícia nos testes. Omisso = Open-Meteo. */
    forecast?: ForecastAdapter
  },
): Promise<AutoBookOutcome> {
  const tenantId = caller.tenantId
  const none = (status: AutoBookStatus, extra: Partial<AutoBookOutcome> = {}): AutoBookOutcome => ({
    status,
    missing: [],
    confirmationMessageId: null,
    outbox: [],
    ...extra,
  })
  if (input.enabled === false) return none('disabled')
  // Proteção (#182): contato bloqueado ou conversa em pausa → nenhuma ação nova.
  const guard = checkConversationProtection(db, tenantId, input.conversationId)
  if (!guard.allowed) return none('blocked', { notes: `Ação automática negada (${guard.reason}).` })
  const conv = getConversation(db, tenantId, input.conversationId)
  if (!conv) return none('not_confirmed')
  const settings = ensureClinicSettings(db, tenantId, clock)
  const tz = settings.timezone || 'America/Sao_Paulo'

  const recent = db
    .all<Msg>(
      `SELECT id, direction, body, created_at FROM messages
       WHERE tenant_id = ? AND conversation_id = ? AND direction IN ('inbound', 'outbound')
       ORDER BY created_at DESC, id DESC LIMIT 20`,
      tenantId,
      input.conversationId,
    )
  const clientTurn: Msg[] = []
  let prevClinic: Msg | null = null
  const older: Msg[] = []
  for (const m of recent) {
    if (!prevClinic) {
      if (m.direction === 'inbound') {
        clientTurn.push(m)
      } else if (clientTurn.length > 0) {
        prevClinic = m
      } else {
        return none('not_confirmed') // a clínica falou por último
      }
    } else {
      older.push(m)
    }
  }
  if (clientTurn.length === 0) return none('not_confirmed')
  clientTurn.reverse()
  const confirmation = clientTurn[clientTurn.length - 1]!

  const services = listServices(db, tenantId).filter((s) => s.active)
  const turnText = clientTurn.map((m) => m.body).join('\n')
  let det = detectExplicitConfirmation({
    clientTexts: clientTurn.map((m) => m.body),
    previousClinicText: prevClinic?.body ?? null,
    historyTexts: older.map((m) => m.body),
    clientToday: clinicCivilDateFromUtc(tz, confirmation.created_at),
    clinicToday: clinicCivilDateFromUtc(tz, prevClinic?.created_at ?? confirmation.created_at),
    services,
  })
  const session = getScheduleSession(db, tenantId, input.conversationId)
  let date = det.date
  let missing = [...det.missing]
  // O período (tarde) não vira horário. O dia já dito na sessão preenche só o dia.
  if (!date && session?.dayLabel && (!det.service || session.serviceId === det.service.id)) {
    const resolved = [...extractDates(session.dayLabel, clinicCivilDateFromUtc(tz, confirmation.created_at))]
    if (resolved.length === 1) {
      date = resolved[0]
      missing = missing.filter((item) => item !== 'dia')
    }
  }
  const turnFacts = scheduleFactsFromText(turnText)
  const rememberDayPeriod = (serviceId: string) => {
    if (!turnFacts.dayLabel && !turnFacts.period) return
    saveScheduleSession(
      db,
      tenantId,
      input.conversationId,
      {
        serviceId,
        ...(turnFacts.dayLabel ? { dayLabel: turnFacts.dayLabel } : {}),
        ...(turnFacts.period ? { period: turnFacts.period } : {}),
      },
      clock,
    )
  }
  const base = { confirmationMessageId: confirmation.id, missing }
  const contact = getContact(db, tenantId, conv.contactId)
  const name = firstName(contact?.displayName)
  const hi = name ? `, ${name}` : ''
  const clockFromTurn = (() => {
    const times = [...extractTimes(turnText)]
    return times.length === 1 ? times[0]! : null
  })()
  if (!det.service && session?.serviceId) {
    const stored = services.find((item) => item.id === session.serviceId)
    // «Na parte da manhã» não repete o serviço nem a zona. A sessão já os tem.
    const periodContinues =
      Boolean(turnFacts.period) && !clockFromTurn && Boolean(session.variantIds?.length)
    if (
      stored &&
      (clockFromTurn ||
        zonesNamedInText(turnText, stored.zones.filter((zone) => zone.active)).length > 0 ||
        periodContinues)
    ) {
      det = { ...det, service: stored }
    }
  }
  let time = det.time
  if (!time && det.service && session?.serviceId === det.service.id && session.clockTime) {
    time = session.clockTime
    missing = missing.filter((item) => item !== 'horario')
  }
  const ready =
    Boolean(det.service && date && time) &&
    (det.ok || (det.status === 'needs_info' && missing.length === 0))
  if (!ready || !det.service || !date || !time) {
    let replyText: string | undefined
    if (det.service) {
      const active = det.service.zones.filter((z) => z.active)
      const turnExplicit = explicitAudienceLine(turnText)
      const carried = session?.serviceId === det.service.id ? session.audienceLine : null
      const line = needsAudienceLine(active) ? (turnExplicit ?? carried) : null
      const pool = needsAudienceLine(active) && line ? zonesForAudienceLine(active, line) : active
      const chosen = zonesChosenByClient(clientTurn, older, pool.length > 0 ? pool : active)
      let kept = chosen.zones
      if (
        kept.length === 0 &&
        !chosen.ambiguous &&
        session?.serviceId === det.service.id &&
        session.variantIds?.length
      ) {
        const fromSession = (pool.length > 0 ? pool : active).filter((z) => session.variantIds!.includes(z.id))
        if (fromSession.length === session.variantIds.length) kept = fromSession
      }
      saveScheduleSession(
        db,
        tenantId,
        input.conversationId,
        {
          serviceId: det.service.id,
          ...(turnExplicit ? { audienceLine: turnExplicit } : {}),
          ...(turnFacts.dayLabel ? { dayLabel: turnFacts.dayLabel } : {}),
          ...(turnFacts.period ? { period: turnFacts.period } : {}),
          ...(clockFromTurn ? { clockTime: clockFromTurn } : {}),
          ...(kept.length > 0 && !chosen.ambiguous ? { variantIds: kept.map((z) => z.id) } : {}),
        },
        clock,
      )
      const contributed =
        Boolean(clockFromTurn) ||
        zonesNamedInText(turnText, pool.length > 0 ? pool : active).length > 0
      if (!(date && time && kept.length > 0 && !chosen.ambiguous && contributed)) {
        const plural = det.service.variantKindPlural?.trim() || ''
        const singular = det.service.variantKind?.trim() || ''
        const kindLabel = (plural || singular || DEFAULT_OPTION_KIND_PLURAL).toLocaleLowerCase('pt-BR')
        const earlyPhrase = plural || !singular ? `as ${kindLabel}` : `a ${kindLabel}`
        const cited = zonesNamedInText(turnText, active)
        if (variantAudiencesConflict(cited)) {
          replyText = MIXED_AUDIENCE_REPLY
        } else if (needsAudienceLine(active) && !line) {
          replyText = audienceLineQuestion(det.service.name)
        } else if (active.length > 0 && (kept.length === 0 || chosen.ambiguous)) {
          const names = stableVariantLabelList(pool.length > 0 ? pool : active)
          replyText = time
            ? askZonesReply(earlyPhrase, names, time)
            : variantListQuestion(
                det.service.name,
                det.service.variantKindPlural || det.service.variantKind,
                pool.length > 0 ? pool : active,
              )
        } else if (!time) {
          const period =
            turnFacts.period ?? (session?.serviceId === det.service.id ? session?.period : null)
          // Serviço sem variantes (ex. massagem): oferta de período com a data absoluta (#408 B-04).
          const canOfferPeriod =
            Boolean(period) &&
            !chosen.ambiguous &&
            (kept.length > 0 || active.length === 0)
          if (canOfferPeriod && period) {
            const preferred = preferredProfessionalId(
              db,
              tenantId,
              [turnText, ...older.map((m) => m.body)].join('\n'),
              det.service,
              clock,
            )
            replyText = await offerZonesInPeriod(
              db,
              tenantId,
              det.service,
              kept,
              period,
              date ?? null,
              tz,
              clock,
              input.forecast,
              preferred,
            )
          } else {
            replyText = `Qual horário fica melhor para ${det.service.name}?`
          }
        } else if (!date) {
          replyText = `Me diga o dia para ${det.service.name}.`
        }
        const faltam = missing.length ? missing.join(', ') : 'confirmação clara'
        return {
          ...none(det.status, base),
          ...(replyText ? { replyText } : {}),
          notes:
            det.status === 'needs_info' || det.status === 'ambiguous'
              ? `Agendamento pela IA não feito: falta/ambíguo (${faltam}). Confirme com a cliente dia, horário e procedimento.`
              : undefined,
        }
      }
    } else {
      const booking = resolveBookingObject({
        text: turnText,
        services,
        session: session
          ? {
              serviceId: session.serviceId,
              audienceLine: session.audienceLine,
              variantIds: session.variantIds,
            }
          : null,
      })
      let replyText: string | undefined
      if (booking.kind === 'handoff') {
        if (booking.handoffReason === 'terceiro') {
          replyText =
            'Para agendar para outra pessoa, a equipe precisa continuar este atendimento.'
        } else if (booking.handoffReason === 'multiplos_servicos') {
          replyText = 'Neste momento marcamos um serviço de cada vez. Qual você quer primeiro?'
        } else if (booking.handoffReason === 'inexistente') {
          replyText = SERVICE_NOT_FOUND_REPLY
        } else if (booking.handoffReason === 'historico_indisponivel') {
          replyText = 'Não tenho o detalhe da sua visita anterior aqui. Qual serviço você quer agora?'
        }
      } else if (booking.kind === 'clarify' && booking.question) {
        replyText = booking.question
        if (booking.serviceId) {
          saveScheduleSession(
            db,
            tenantId,
            input.conversationId,
            {
              serviceId: booking.serviceId,
              ...(booking.variantIds.length > 0 ? { variantIds: booking.variantIds } : {}),
            },
            clock,
          )
        }
      }
      const faltam = missing.length ? missing.join(', ') : 'confirmação clara'
      return {
        ...none(det.status, base),
        ...(replyText ? { replyText } : {}),
        notes:
          det.status === 'needs_info' || det.status === 'ambiguous'
            ? `Agendamento pela IA não feito: falta/ambíguo (${faltam}). Confirme com a cliente dia, horário e procedimento.`
            : undefined,
      }
    }
  }
  const svc = det.service
  rememberDayPeriod(svc.id)
  const preferredProId = preferredProfessionalId(
    db,
    tenantId,
    [turnText, ...older.map((m) => m.body)].join('\n'),
    svc,
    clock,
  )
  const activeZones = svc.zones.filter((z) => z.active)
  // DEC-090: linha já dita neste funil não se reperguntar.
  // Só a sessão activa do mesmo serviço + mensagens desde o início do funil contam.
  // Após DEC-086 (sessão limpa) ou serviço diferente, «Masculina»/«Todas» antigas não valem.
  const sameFunnel = Boolean(session && session.serviceId === svc.id)
  const funnelStartedAt = sameFunnel && session ? session.updatedAt : Number.POSITIVE_INFINITY
  const funnelOlder = sameFunnel
    ? older.filter((m) => m.direction !== 'inbound' || m.created_at >= funnelStartedAt)
    : []
  const funnelInboundNewestFirst = [
    ...[...clientTurn].reverse().map((m) => m.body),
    ...funnelOlder.filter((m) => m.direction === 'inbound').map((m) => m.body),
  ]
  const turnExplicit = explicitAudienceLine(turnText)
  const historyLine = sameFunnel ? audienceLineFromClientTexts(funnelInboundNewestFirst) : null
  const carried = sameFunnel && session ? session.audienceLine : null
  const line = needsAudienceLine(activeZones) ? (turnExplicit ?? carried ?? historyLine) : null
  if (needsAudienceLine(activeZones) && !line) {
    saveScheduleLine(db, tenantId, input.conversationId, svc.id, null, clock)
    return {
      ...none('needs_info', { ...base, serviceId: svc.id, date, time }),
      replyText: audienceLineQuestion(svc.name),
      notes:
        `A cliente falou em ${svc.name} sem escolher a linha. Pergunta automática enviada. ` +
        'Não se infere pelo nome, pelo histórico nem por marcações. Texto livre não marca.',
    }
  }
  if (line && (turnExplicit || historyLine || carried)) {
    saveScheduleLine(db, tenantId, input.conversationId, svc.id, line, clock)
  }
  const scoped = needsAudienceLine(activeZones) ? zonesForAudienceLine(activeZones, line) : activeZones
  const chosen = sameFunnel
    ? zonesChosenByClient(clientTurn, funnelOlder, scoped)
    : zonesChosenByClient(clientTurn, [], scoped)
  let namedZones = chosen.zones
  if (
    namedZones.length === 0 &&
    !chosen.ambiguous &&
    sameFunnel &&
    session?.variantIds?.length
  ) {
    const fromSession = scoped.filter((z) => session.variantIds!.includes(z.id))
    if (fromSession.length === session.variantIds.length) namedZones = fromSession
  }
  // A cliente aceitou a hora. O conjunto é o da oferta («para axila e íntima»),
  // não o resto do catálogo que a sessão ou «as duas» tenham arrastado.
  let ambiguous = chosen.ambiguous
  const offered = zonesOfferedToClient(prevClinic?.body ?? null, scoped)
  if (
    offered.length > 0 &&
    clockFromTurn &&
    zonesNamedInText(turnText, scoped).length === 0 &&
    !claimsWholeCatalog(turnText)
  ) {
    namedZones = offered
    ambiguous = false
  }
  if (namedZones.length > 0 && !ambiguous) {
    saveScheduleSession(
      db,
      tenantId,
      input.conversationId,
      {
        serviceId: svc.id,
        variantIds: namedZones.map((z) => z.id),
        ...(clockFromTurn ? { clockTime: clockFromTurn } : { clockTime: time }),
      },
      clock,
    )
  } else if (clockFromTurn || time) {
    saveScheduleSession(
      db,
      tenantId,
      input.conversationId,
      { serviceId: svc.id, clockTime: clockFromTurn ?? time },
      clock,
    )
  }
  const plural = svc.variantKindPlural?.trim() || ''
  const singular = svc.variantKind?.trim() || ''
  const kind = (plural || singular || DEFAULT_OPTION_KIND_PLURAL).toLocaleLowerCase('pt-BR')
  const phrase = plural || !singular ? `as ${kind}` : `a ${kind}`
  if (activeZones.length > 0 && (namedZones.length === 0 || ambiguous)) {
    const names = stableVariantLabelList(scoped.length > 0 ? scoped : activeZones)
    return {
      ...none('needs_info', { ...base, serviceId: svc.id, date, time }),
      // REQ-088 / AC-60: pergunta determinística — não depender do modelo nem silenciar.
      replyText: askZonesReply(phrase, names, time),
      notes: ambiguous
        ? `O nome citado casa com mais de uma ${kind}. Pergunta automática enviada. Não informe valor nem envie proposta.`
        : `A cliente falou em ${svc.name} sem escolher ${kind} (${names.join(', ')}). ` +
          `Pergunta automática enviada. Não informe valor nem «a partir de».`,
    }
  }
  if (variantAudiencesConflict(namedZones)) {
    return {
      ...none('needs_info', { ...base, serviceId: svc.id, date, time }),
      replyText: MIXED_AUDIENCE_REPLY,
      notes:
        `As ${kind} escolhidas misturam masculino e feminino. Peça um conjunto compatível. Não informe valor nem envie proposta.`,
    }
  }
  let quote
  try {
    quote = quoteVisit(
      db,
      tenantId,
      svc,
      namedZones.map((z) => z.id),
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : 'erro'
    return {
      ...none('needs_info', { ...base, serviceId: svc.id, date, time }),
      // Não silenciar: o modelo pode ter deixado a mensagem vazia à espera da proposta.
      replyText:
        activeZones.length > 0
          ? askZonesReply(phrase, stableVariantLabelList(scoped.length > 0 ? scoped : activeZones), time)
          : teamConfirmsSoonReply(svc.name, time),
      notes:
        `Não deu para calcular ${svc.name}: ${message}. Pergunta/aviso automático enviado. Texto livre não marca.`,
    }
  }
  const label = `${svc.name} · ${dayText(date)} às ${time}`
  const found = { ...base, serviceId: svc.id, date, time }

  // S2 / DEC-061: texto livre NUNCA marca. Com capacidade ligada, monta+envia proposta versionada
  // (botão WhatsApp); o clique (S5) é que marca ou inicia Pix. Sem capacidade → só nota à atendente.
  const avail = await queryAutomaticAvailability(
    db,
    tenantId,
    {
      serviceId: svc.id,
      date,
      ...(quote.zones.length > 0 ? { durationMinutesOverride: quote.durationMinutes } : {}),
      ...(preferredProId ? { professionalId: preferredProId } : {}),
    },
    clock,
    input.forecast ?? { read: readOpenMeteo },
  )
  const slot = avail.slots.find((s) => localHHMM(tz, s.startsAt) === time)

  if (!slot) {
    const team = queryAvailability(
      db,
      tenantId,
      {
        serviceId: svc.id,
        date,
        ...(quote.zones.length > 0 ? { durationMinutesOverride: quote.durationMinutes } : {}),
        ...(preferredProId ? { professionalId: preferredProId } : {}),
      },
      clock,
    )
    const teamSlot = team.slots.find((s) => localHHMM(tz, s.startsAt) === time)
    if (teamSlot) {
      const verdict = await evaluateServiceTempo(
        db,
        tenantId,
        { serviceId: svc.id, startsAt: teamSlot.startsAt },
        input.forecast ?? { read: readOpenMeteo },
        clock,
      )
      if (verdict.outcome !== 'serve') {
        const phraseTempo =
          verdict.outcome === 'indisponivel' ? TEMPO_UNCONFIRMED_PHRASE : TEMPO_REFUSED_PHRASE
        openPendingCommunication(
          db,
          {
            tenantId,
            conversationId: conv.id,
            contactId: conv.contactId,
            proposalId: null,
            kind: 'alter_awaiting_team',
            detailText: phraseTempo,
          },
          clock,
        )
        return {
          ...none(svc.requiresSignal ? 'needs_signal' : 'requires_button', found),
          replyText: phraseTempo,
          notes:
            `O horário das ${time} não passa no tempo de ${svc.name}. Frase fixa enviada. ` +
            'A equipe vê o alerta. Texto livre não marca.',
        }
      }
    }
    const alts = avail.slots
      .slice(0, 3)
      .map((s) => localHHMM(tz, s.startsAt))
      .filter((t) => t !== time)
    const altText =
      alts.length > 0
        ? ` Tenho ${alts.join(', ')}. Qual fica melhor?`
        : ' Quer que eu veja outro horário?'
    return {
      ...none(svc.requiresSignal ? 'needs_signal' : 'requires_button', found),
      replyText: `Nesse horário das ${time} já não tenho vaga.${altText}`,
      notes:
        `A cliente parece confirmar ${label} (horário não livre na agenda). ` +
        'Aviso automático enviado. Texto livre não marca — confirme pelo Agendar se precisar.',
    }
  }

  if (!input.capability) {
    if (svc.requiresSignal) {
      const amount = signalAmountCents(svc, quote.priceCents)
      return {
        ...none('needs_signal', found),
        replyText:
          `Perfeito${hi}! Para garantir ${svc.name} na ${dayText(date)} às ${time}, a clínica pede um sinal` +
          `${amount != null ? ` de ${brl(amount)}` : ''} por Pix. O horário fica reservado depois do pagamento; o Pix chega aqui na conversa.`,
        notes:
          `A cliente confirmou ${label}. Serviço exige sinal: a IA NÃO marcou. ` +
          'Envie a cobrança Pix pelo Agendar (fluxo normal); o compromisso é criado após o pagamento.',
      }
    }
    return {
      ...none('requires_button', found),
      replyText:
        `Perfeito${hi}! Anotei ${svc.name} na ${dayText(date)} às ${time}. A equipe confirma o horário em seguida.`,
      notes:
        `A cliente parece confirmar ${label}. ` +
        'Capacidade pausada: aviso automático enviado; confirme pelo Agendar (fluxo normal).',
    }
  }

  try {
    const proposal = createProposal(
      db,
      tenantId,
      {
        contactId: conv.contactId,
        conversationId: conv.id,
        serviceId: svc.id,
        professionalId: slot.professionalId,
        startsAt: slot.startsAt,
        endsAt: slot.startsAt + quote.durationMinutes * 60_000,
        durationMinutes: quote.durationMinutes,
        zoneIds: quote.zones.map((z) => z.zoneId).filter((id): id is string => Boolean(id)),
      },
      clock,
      input.abuseLimits ? { abuseLimits: input.abuseLimits } : {},
    )
    const sent = sendProposalToWhatsAppOp(db, caller, { proposalId: proposal.id }, clock)
    const status: AutoBookStatus = svc.requiresSignal ? 'needs_signal' : 'requires_button'
    const delivered = sent.status === 'queued' || sent.status === 'already_sent'
    const sendNote = delivered
      ? `Proposta ${proposal.id} v${proposal.version} enfileirada/enviada com botão Confirmar. ` +
        'Aguarda o clique da cliente; texto livre («sim») não marca.'
      : `Proposta ${proposal.id} v${proposal.version} preparada, mas envio entregue à equipe ` +
        `(${sent.status}). Texto livre não marca.`
    return {
      ...none(status, found),
      proposalId: proposal.id,
      proposalVersion: proposal.version,
      // Proposta no WhatsApp → sem texto. Falha de envio → aviso, para não silenciar.
      replyText: delivered
        ? ''
        : `Quase lá${hi}! Vou confirmar ${svc.name} na ${dayText(date)} às ${time} com a equipe e já te retorno.`,
      notes: `A cliente parece confirmar ${label}. ${sendNote}`,
      outbox: sent.outbox,
    }
  } catch (err) {
    return {
      ...none(svc.requiresSignal ? 'needs_signal' : 'requires_button', found),
      replyText:
        `Quase lá${hi}! Vou confirmar ${svc.name} na ${dayText(date)} às ${time} com a equipe e já te retorno.`,
      notes:
        `A cliente parece confirmar ${label}. Falha ao montar/enviar a proposta: ` +
        `${err instanceof Error ? err.message.slice(0, 180) : 'erro'}. ` +
        'Aviso automático enviado — confirme pelo Agendar.',
    }
  }
}
