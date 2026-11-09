/**
 * Reagendamento conversacional (DEC-091 / REQ-101).
 * Mantém serviço e variantes do compromisso; confirma só pelo botão (DEC-061).
 * Frases fixas DEC-129 (Confirmada): sem marcador interno e sem nome da cliente.
 */
import type { Clock } from '../../db/clock'
import { getService } from '../config/services'
import { readZoneSnapshots, snapshotDuration } from '../config/zones'
import { ensureClinicSettings } from '../config/settings'
import type { ClinicCaller } from '../envelopes'
import { getConversation } from '../inbox/conversations'
import type { OutboxRow } from '../outbox'
import { createProposal } from '../proposals/proposals'
import { sendProposalToWhatsAppOp } from '../proposals/send'
import { clinicCivilDateFromUtc } from '../scheduling/timezone'
import { queryAutomaticAvailability } from '../tempo/automatic'
import type { ForecastAdapter } from '../tempo/evaluate'
import { readOpenMeteo } from '../tempo/open-meteo'
import type { ClinicDb } from '../store'
import type { AbuseLimits } from './abuse-limits'
import { extractDates, extractTimes } from './autobook'
import { slotBindingFromChoice } from './choice-offer'
import {
  CANCEL_RE,
  RESCHEDULE_RE,
  classifySensitive,
  hasPolicyQuestion,
} from './nlu/sensitive'
import { MODEL_FALLBACK_TEXT } from './model-fallback'
import { validateClientOutbound } from './outbound-validate'
import { checkConversationProtection } from './protection'
import { getBookingFrame, getScheduleSession, saveScheduleSession, scheduleFactsFromText } from './schedule-session'
import {
  createDeferredBookingFrame,
  offerFramePatch,
  type DeferredBookingFrame,
} from './deferred-booking-frame'

const EXPLICIT = RESCHEDULE_RE
const CANCEL = CANCEL_RE
const DAY_OR_PERIOD =
  /\b(amanh[aã]|hoje|segunda|ter[cç]a|quarta|quinta|sexta|s[aá]bado|domingo|manh[aã]|tarde|noite)\b/i
const SOFT_DAY =
  /\bposso\b[\s\S]{0,48}\b(para|pra)\b[\s\S]{0,24}\b(amanh[aã]|hoje|segunda|ter[cç]a|quarta|quinta|sexta|s[aá]bado|domingo)\b/i
const NEW_BOOK = /\b(marcar|agendar|quero\s+(uma\s+)?(depil|limpeza|massagem|peeling))\b/i
const WEEKDAY_LABEL = ['', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado', 'domingo']

export type RescheduleOutcome = {
  handled: true
  replyText: string
  proposalId?: string
  proposalVersion?: number
  appointmentId: string
  date?: string
  time?: string
  outbox: OutboxRow[]
  notes?: string
  /** Frame a gravar na mesma TX do outbound (ADR-0015). */
  deferredFrame?: DeferredBookingFrame
}

type UpcomingApt = {
  id: string
  serviceId: string
  professionalId: string
  startsAt: number
  endsAt: number
  serviceName: string
}

function weekdayOf(date: string): number {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number]
  return new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay() === 0
    ? 7
    : new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay()
}

/** `{dia}` sem preposição («sexta 06/11»); a preposição vai na frase fixa. */
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

/**
 * DEC-129: frases fixas no código (como DEC-125), não no catálogo de atos.
 * Uma redação por situação — o catálogo M4 exige 3–5 variantes e variáveis não vazias;
 * aqui a DEC fixa o texto literal. Validador único + INV-05 antes de sair.
 * Hotfix: nunca lança — se o texto interpolado (ex.: nome do serviço) falhar o
 * validador, devolve a frase DEC-107 (sem frase nova).
 */
function reschedulePhrase(text: string): string {
  const check = validateClientOutbound(text, { source: 'phrase', requireSingleQuestion: false })
  // Nunca lança: um erro aqui abortaria o lote do autodraft e deixaria a cliente sem
  // resposta (INV-09). Se o validador recusar, sai o fallback da DEC-107 (DEC-131).
  return check.ok ? text : MODEL_FALLBACK_TEXT
}

/** (1) Sem dia pedido. */
export function phraseAskDay(): string {
  return reschedulePhrase('Claro, vamos remarcar. Para qual dia você prefere?')
}

/** (2) Oferece horários no dia. */
export function phraseOfferSlots(date: string, hours: string): string {
  return reschedulePhrase(`Na ${dayText(date)} tenho ${hours}. Algum serve para remarcar?`)
}

/** (3) Dia sem vaga. */
export function phraseDayFull(date: string): string {
  return reschedulePhrase(`Na ${dayText(date)} não tenho horário livre. Quer ver outro dia?`)
}

/** (4) Hora pedida sem vaga, com alternativas. */
export function phraseTimeTaken(date: string, time: string, alternatives: string): string {
  return reschedulePhrase(
    `Às ${time} na ${dayText(date)} já não tenho vaga. Tenho ${alternatives}. Qual fica melhor?`,
  )
}

/** (5) Envio da proposta falhou. */
export function phraseSendFailed(date: string, time: string): string {
  return reschedulePhrase(
    `Não consegui enviar a confirmação da remarcação para ${dayText(date)} às ${time}. ` +
      `Ainda não está remarcado: a equipe vai te responder em seguida.`,
  )
}

/**
 * (6) Pausa da owner / capacidade desligada.
 * O nome do serviço vem do cadastro e pode conter um termo proibido («Sala VIP», «Linha
 * Premium»). Nesse caso sai a variante sem nome (DEC-131), nunca um erro.
 */
export function phraseOwnerPaused(serviceName: string, date: string, time: string): string {
  const withName =
    `Recebi seu pedido de remarcar ${serviceName} para ${dayText(date)} às ${time}. ` +
    `Ainda não está remarcado: a equipe confirma e já te retorna.`
  const check = validateClientOutbound(withName, { source: 'phrase', requireSingleQuestion: false })
  if (check.ok) return withName
  return reschedulePhrase(
    'Recebi seu pedido de remarcar. Ainda não está remarcado: a equipe confirma e já te retorna.',
  )
}

export function isCancelIntent(text: string): boolean {
  // CF-04: pergunta condicional sobre multa/política não é cancelamento.
  if (hasPolicyQuestion(classifySensitive(text))) return false
  return CANCEL.test(text) && !EXPLICIT.test(text)
}

export function isRescheduleIntent(text: string, opts: { hasUpcoming: boolean; priorOffer: boolean }): boolean {
  const body = text.trim()
  if (!body) return false
  if (CANCEL.test(body) && !EXPLICIT.test(body)) return false
  if (EXPLICIT.test(body)) return true
  if (opts.priorOffer && (DAY_OR_PERIOD.test(body) || extractTimes(body).size > 0)) return true
  if (opts.hasUpcoming && SOFT_DAY.test(body) && !NEW_BOOK.test(body)) return true
  return false
}

export function loadUpcomingAppointment(
  db: ClinicDb,
  tenantId: string,
  contactId: string,
  now: number,
): UpcomingApt | null {
  const row = db.get<{
    id: string
    service_id: string
    professional_id: string
    starts_at: number
    ends_at: number
    service_name: string | null
  }>(
    `SELECT a.id, a.service_id, a.professional_id, a.starts_at, a.ends_at, s.name AS service_name
     FROM appointments a
     LEFT JOIN services s ON s.tenant_id = a.tenant_id AND s.id = a.service_id
     WHERE a.tenant_id = ? AND a.contact_id = ? AND a.status = 'confirmed' AND a.starts_at > ?
     ORDER BY a.starts_at ASC LIMIT 1`,
    tenantId,
    contactId,
    now,
  )
  if (!row) return null
  return {
    id: row.id,
    serviceId: row.service_id,
    professionalId: row.professional_id,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    serviceName: row.service_name ?? 'Atendimento',
  }
}

/**
 * Continuidade da remarcação: só `phase = remarcando` (ADR-0015 / DEC-129).
 * CF-22: não lê texto outbound.
 *
 * `lastOffer` / `pending` também existem na marcação nova (`ofertado`, …). Tratar
 * qualquer oferta no frame como remarcação fazia um re-pedido de dia mid-booking
 * (ex. «Na próxima terça tem horário?») com compromisso futuro cair em
 * «Algum serve para remarcar?» + «Falar com a equipe» em vez da lista Horários.
 */
function priorRescheduleOfferFromFrame(
  frame: ReturnType<typeof getBookingFrame>,
): boolean {
  if (!frame) return false
  return frame.phase === 'remarcando'
}

/** Acumula lastOffer/pending da oferta de remarcação (commit na TX do outbound). */
function rememberRescheduleOffer(
  deferred: DeferredBookingFrame,
  serviceId: string,
  date: string,
  slots: Array<{ startsAt: number; professionalId: string }>,
  tz: string,
): void {
  if (slots.length === 0) return
  deferred.save(
    offerFramePatch({
      serviceId,
      date,
      phase: 'remarcando',
      slots: slots.map((s) => ({
        startsAt: s.startsAt,
        professionalId: s.professionalId,
        time: localHHMM(tz, s.startsAt),
        date,
      })),
    }),
  )
}

function periodFilter(period: string | null | undefined, hhmm: string): boolean {
  if (!period) return true
  const [h] = hhmm.split(':').map(Number) as [number]
  if (period === 'manha') return h < 12
  if (period === 'tarde') return h >= 12 && h < 18
  if (period === 'noite') return h >= 18
  return true
}

/**
 * Tenta o fluxo de remarcação. Null = não aplicável (seguir handoff/catálogo).
 */
export async function tryAiReschedule(
  db: ClinicDb,
  caller: ClinicCaller,
  clock: Clock,
  input: {
    conversationId: string
    inboundText: string
    capability?: boolean
    abuseLimits?: AbuseLimits
    forecast?: ForecastAdapter
  },
): Promise<RescheduleOutcome | null> {
  const tenantId = caller.tenantId
  const deferred = createDeferredBookingFrame()
  const saveSession = (patch: Parameters<typeof saveScheduleSession>[3]) => {
    deferred.save(patch)
  }
  const finish = (outcome: RescheduleOutcome): RescheduleOutcome => {
    if (!deferred.hasWork) return outcome
    const willSend = Boolean(outcome.replyText.trim()) || Boolean(outcome.proposalId)
    if (willSend) return { ...outcome, deferredFrame: deferred }
    const flushed = deferred.flushNow(db, tenantId, input.conversationId, clock)
    return { ...outcome, outbox: [...outcome.outbox, ...flushed] }
  }
  const guard = checkConversationProtection(db, tenantId, input.conversationId)
  if (!guard.allowed) return null
  const conv = getConversation(db, tenantId, input.conversationId)
  if (!conv) return null
  const now = clock.nowMs()
  const apt = loadUpcomingAppointment(db, tenantId, conv.contactId, now)
  const sessionEarly = getScheduleSession(db, tenantId, input.conversationId)
  const frameEarly = getBookingFrame(db, tenantId, input.conversationId)
  // DEC-129 / ADR-0015: continuidade só com phase remarcando (não lastOffer de marcação nova).
  const priorOffer = priorRescheduleOfferFromFrame(frameEarly)
  if (!isRescheduleIntent(input.inboundText, { hasUpcoming: Boolean(apt), priorOffer })) {
    return null
  }
  if (!apt) {
    return null
  }

  // Mid marcação nova (coletando/ofertado/proposto) com serviço no frame: SOFT_DAY /
  // dia solto não podem virar remarcação do compromisso futuro (staging 09/11/2026:
  // «Posso para hoje?» mid Depilação + apt Massagem → proposta Massagem).
  // Lexicon explícito (reagendar/remarcar/…) ainda entra — a cliente pediu remarcação.
  const midNewBooking =
    frameEarly != null &&
    frameEarly.phase !== 'remarcando' &&
    Boolean(frameEarly.serviceId) &&
    (frameEarly.phase === 'coletando' ||
      frameEarly.phase === 'ofertado' ||
      frameEarly.phase === 'proposto')
  if (midNewBooking && !EXPLICIT.test(input.inboundText)) {
    return null
  }

  const settings = ensureClinicSettings(db, tenantId, clock)
  const tz = settings.timezone || 'America/Sao_Paulo'
  const today = clinicCivilDateFromUtc(tz, now)
  const service = getService(db, tenantId, apt.serviceId)
  if (!service || !service.active) return null

  const zoneSnaps = readZoneSnapshots(db, tenantId, 'appointment', apt.id)
  const zoneIds = zoneSnaps.map((z) => z.zoneId).filter((id): id is string => Boolean(id))
  const durationOverride =
    snapshotDuration(zoneSnaps) ?? Math.round((apt.endsAt - apt.startsAt) / 60_000)

  const session = sessionEarly
  const frame = frameEarly
  const facts = scheduleFactsFromText(input.inboundText)
  // Chave civil da oferta (`2026-11-04T10:00`). «2026» não é 20:26.
  const spokenSlot = slotBindingFromChoice(input.inboundText.trim(), '')
  const dates = spokenSlot ? [spokenSlot.date] : [...extractDates(input.inboundText, today)]
  let date = dates.length === 1 ? dates[0] : undefined
  if (!date && facts.dayLabel) {
    const resolved = [...extractDates(facts.dayLabel, today)]
    if (resolved.length === 1) date = resolved[0]
  }
  // ADR-0015: data absoluta do frame (day_label órfã — não autoriza, #472).
  if (!date && frame?.date && (priorOffer || frame.phase === 'remarcando')) {
    date = frame.date
  }
  const times = spokenSlot ? [spokenSlot.time] : [...extractTimes(input.inboundText)]
  const time = times.length === 1 ? times[0] : undefined
  const period = facts.period ?? (priorOffer ? session?.period : undefined) ?? null

  if (facts.dayLabel || facts.period) {
    const absolute =
      facts.dayLabel != null ? [...extractDates(facts.dayLabel, today)][0] ?? null : undefined
    saveSession({
      serviceId: apt.serviceId,
      ...(facts.period ? { period: facts.period } : {}),
      ...(absolute !== undefined ? { date: absolute } : {}),
      phase: 'remarcando',
    })
  }

  if (!date) {
    // Continuidade: phase remarcando autoriza o próximo turno (não texto outbound).
    saveSession({ serviceId: apt.serviceId, phase: 'remarcando' })
    return finish({
      handled: true,
      appointmentId: apt.id,
      replyText: phraseAskDay(),
      notes: `Remarcação do compromisso ${apt.id} sem dia. Pedido o dia.`,
      outbox: [],
    })
  }

  const avail = await queryAutomaticAvailability(
    db,
    tenantId,
    {
      serviceId: apt.serviceId,
      date,
      excludeAppointmentId: apt.id,
      ...(durationOverride > 0 ? { durationMinutesOverride: durationOverride } : {}),
    },
    clock,
    input.forecast ?? { read: readOpenMeteo },
  )
  const slots = avail.slots.filter((s) => periodFilter(period, localHHMM(tz, s.startsAt)))

  if (!time) {
    if (slots.length === 0) {
      // Dia cheio: não deixar date sticky — «à tarde» / continuação refiltrava o mesmo
      // dia e repetia «Quer ver outro dia?» (classe sticky-frame / sibling #655).
      saveSession({
        serviceId: apt.serviceId,
        date: null,
        phase: 'remarcando',
        pending: null,
        lastOffer: null,
      })
      return finish({
        handled: true,
        appointmentId: apt.id,
        date,
        replyText: phraseDayFull(date),
        notes: `Sem vagas para remarcar ${apt.id} em ${date}.`,
        outbox: [],
      })
    }
    const offered = slots.slice(0, 5)
    rememberRescheduleOffer(
      deferred,
      apt.serviceId,
      date,
      offered.map((s) => ({ startsAt: s.startsAt, professionalId: s.professionalId })),
      tz,
    )
    const listed = offered.map((s) => localHHMM(tz, s.startsAt))
    return finish({
      handled: true,
      appointmentId: apt.id,
      date,
      replyText: phraseOfferSlots(date, listed.join(', ')),
      notes: `Oferta de remarcação ${apt.id} em ${date}: ${listed.join(', ')}.`,
      outbox: [],
    })
  }

  const slot = slots.find((s) => localHHMM(tz, s.startsAt) === time)
  if (!slot) {
    const altSlots = slots.slice(0, 3)
    if (altSlots.length > 0) {
      rememberRescheduleOffer(
        deferred,
        apt.serviceId,
        date,
        altSlots.map((s) => ({ startsAt: s.startsAt, professionalId: s.professionalId })),
        tz,
      )
    } else {
      // Sem alternativa no dia: mesma política que dia cheio — limpa date sticky.
      saveSession({
        serviceId: apt.serviceId,
        date: null,
        phase: 'remarcando',
        pending: null,
        lastOffer: null,
      })
    }
    const alts = altSlots.map((s) => localHHMM(tz, s.startsAt))
    return finish({
      handled: true,
      appointmentId: apt.id,
      date,
      time,
      replyText:
        alts.length > 0 ? phraseTimeTaken(date, time, alts.join(', ')) : phraseDayFull(date),
      notes: `Horário ${time} indisponível para remarcar ${apt.id}.`,
      outbox: [],
    })
  }

  if (input.capability === false) {
    return finish({
      handled: true,
      appointmentId: apt.id,
      date,
      time,
      replyText: phraseOwnerPaused(apt.serviceName, date, time),
      notes: `Capacidade pausada: remarcação ${apt.id} não enviou proposta.`,
      outbox: [],
    })
  }

  try {
    const proposal = createProposal(
      db,
      tenantId,
      {
        contactId: conv.contactId,
        conversationId: conv.id,
        serviceId: apt.serviceId,
        professionalId: slot.professionalId,
        startsAt: slot.startsAt,
        endsAt: slot.startsAt + durationOverride * 60_000,
        durationMinutes: durationOverride,
        zoneIds,
        replacesAppointmentId: apt.id,
      },
      clock,
      input.abuseLimits ? { abuseLimits: input.abuseLimits } : {},
    )
    const afterPersist = deferred.hasWork ? deferred.toAfterPersist(clock) : undefined
    const sent = sendProposalToWhatsAppOp(
      db,
      caller,
      { proposalId: proposal.id, ...(afterPersist ? { afterPersist } : {}) },
      clock,
    )
    const delivered = sent.status === 'queued' || sent.status === 'already_sent'
    if (delivered) deferred.discard()
    return finish({
      handled: true,
      appointmentId: apt.id,
      date,
      time,
      proposalId: proposal.id,
      proposalVersion: proposal.version,
      replyText: delivered ? '' : phraseSendFailed(date, time),
      notes: `Proposta de remarcação ${proposal.id} v${proposal.version} para ${apt.id}.`,
      outbox: sent.outbox,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'erro'
    return finish({
      handled: true,
      appointmentId: apt.id,
      date,
      time,
      replyText: phraseSendFailed(date, time),
      notes: `Falha ao montar proposta de remarcação: ${message}`,
      outbox: [],
    })
  }
}
