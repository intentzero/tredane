/**
 * Reagendamento conversacional (DEC-091 / REQ-101).
 * Mantém serviço e variantes do compromisso; confirma só pelo botão (DEC-061).
 */
import type { Clock } from '../../db/clock'
import { getContact } from '../contacts'
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
import {
  CANCEL_RE,
  RESCHEDULE_RE,
  classifySensitive,
  hasPolicyQuestion,
} from './nlu/sensitive'
import { checkConversationProtection } from './protection'
import { getScheduleSession, saveScheduleSession, scheduleFactsFromText } from './schedule-session'

/** Frase estável para continuar a escolha de horário sem reiniciar o funil. */
export const RESCHEDULE_OFFER_MARKER = 'Para remarcar o mesmo atendimento'

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

function priorRescheduleOffer(db: ClinicDb, tenantId: string, conversationId: string): boolean {
  const row = db.get<{ body: string }>(
    `SELECT body FROM messages
     WHERE tenant_id = ? AND conversation_id = ? AND direction = 'outbound'
     ORDER BY created_at DESC, id DESC LIMIT 8`,
    tenantId,
    conversationId,
  )
  return Boolean(row?.body && row.body.includes(RESCHEDULE_OFFER_MARKER))
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
  const guard = checkConversationProtection(db, tenantId, input.conversationId)
  if (!guard.allowed) return null
  const conv = getConversation(db, tenantId, input.conversationId)
  if (!conv) return null
  const now = clock.nowMs()
  const apt = loadUpcomingAppointment(db, tenantId, conv.contactId, now)
  const priorOffer = priorRescheduleOffer(db, tenantId, input.conversationId)
  if (!isRescheduleIntent(input.inboundText, { hasUpcoming: Boolean(apt), priorOffer })) {
    return null
  }
  if (!apt) {
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

  const session = getScheduleSession(db, tenantId, input.conversationId)
  const facts = scheduleFactsFromText(input.inboundText)
  const dates = [...extractDates(input.inboundText, today)]
  let date = dates.length === 1 ? dates[0] : undefined
  if (!date && facts.dayLabel) {
    const resolved = [...extractDates(facts.dayLabel, today)]
    if (resolved.length === 1) date = resolved[0]
  }
  if (!date && session?.dayLabel && priorOffer) {
    const resolved = [...extractDates(session.dayLabel, today)]
    if (resolved.length === 1) date = resolved[0]
  }
  const times = [...extractTimes(input.inboundText)]
  const time = times.length === 1 ? times[0] : undefined
  const period = facts.period ?? (priorOffer ? session?.period : undefined) ?? null

  if (facts.dayLabel || facts.period) {
    saveScheduleSession(
      db,
      tenantId,
      input.conversationId,
      {
        serviceId: apt.serviceId,
        ...(facts.dayLabel ? { dayLabel: facts.dayLabel } : {}),
        ...(facts.period ? { period: facts.period } : {}),
      },
      clock,
    )
  }

  const contact = getContact(db, tenantId, conv.contactId)
  const name = contact?.displayName?.trim().split(/\s+/)[0]
  const hi = name ? `, ${name}` : ''

  if (!date) {
    return {
      handled: true,
      appointmentId: apt.id,
      replyText: `${RESCHEDULE_OFFER_MARKER}${hi}: para qual dia você prefere?`,
      notes: `Remarcação do compromisso ${apt.id} sem dia. Pedido o dia.`,
      outbox: [],
    }
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
      return {
        handled: true,
        appointmentId: apt.id,
        date,
        replyText:
          `${RESCHEDULE_OFFER_MARKER}: na ${dayText(date)} não tenho horário livre. ` +
          `Quer ver outro dia?`,
        notes: `Sem vagas para remarcar ${apt.id} em ${date}.`,
        outbox: [],
      }
    }
    const listed = slots.slice(0, 5).map((s) => localHHMM(tz, s.startsAt))
    return {
      handled: true,
      appointmentId: apt.id,
      date,
      replyText:
        `${RESCHEDULE_OFFER_MARKER} na ${dayText(date)}, tenho ${listed.join(', ')}. ` +
        `Qual fica melhor?`,
      notes: `Oferta de remarcação ${apt.id} em ${date}: ${listed.join(', ')}.`,
      outbox: [],
    }
  }

  const slot = slots.find((s) => localHHMM(tz, s.startsAt) === time)
  if (!slot) {
    const alts = slots.slice(0, 3).map((s) => localHHMM(tz, s.startsAt))
    return {
      handled: true,
      appointmentId: apt.id,
      date,
      time,
      replyText:
        alts.length > 0
          ? `${RESCHEDULE_OFFER_MARKER}: às ${time} na ${dayText(date)} já não tenho vaga. Tenho ${alts.join(', ')}. Qual fica melhor?`
          : `${RESCHEDULE_OFFER_MARKER}: na ${dayText(date)} não tenho horário livre. Quer ver outro dia?`,
      notes: `Horário ${time} indisponível para remarcar ${apt.id}.`,
      outbox: [],
    }
  }

  if (input.capability === false) {
    return {
      handled: true,
      appointmentId: apt.id,
      date,
      time,
      replyText:
        `Anotei o pedido de remarcar ${apt.serviceName} para ${dayText(date)} às ${time}. ` +
        `A equipe confirma em seguida.`,
      notes: `Capacidade pausada: remarcação ${apt.id} não enviou proposta.`,
      outbox: [],
    }
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
    const sent = sendProposalToWhatsAppOp(db, caller, { proposalId: proposal.id }, clock)
    const delivered = sent.status === 'queued' || sent.status === 'already_sent'
    return {
      handled: true,
      appointmentId: apt.id,
      date,
      time,
      proposalId: proposal.id,
      proposalVersion: proposal.version,
      replyText: delivered
        ? ''
        : `${RESCHEDULE_OFFER_MARKER}${hi}: vou confirmar ${dayText(date)} às ${time} com a equipe.`,
      notes: `Proposta de remarcação ${proposal.id} v${proposal.version} para ${apt.id}.`,
      outbox: sent.outbox,
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'erro'
    return {
      handled: true,
      appointmentId: apt.id,
      date,
      time,
      replyText: `${RESCHEDULE_OFFER_MARKER}${hi}: a equipe confirma ${dayText(date)} às ${time}.`,
      notes: `Falha ao montar proposta de remarcação: ${message}`,
      outbox: [],
    }
  }
}
