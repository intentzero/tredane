/**
 * Cancelamento conversacional com botão (DEC-061 espelho / lab S24–S25).
 * Nunca cancela por texto livre — só após toque em «Cancelar marcação».
 */
import type { Clock } from '../../db/clock'
import { AI_AUTOBOOK_ACTOR } from '../constants'
import type { ClinicCaller } from '../envelopes'
import { ensureClinicSettings } from '../config/settings'
import { getConversation } from '../inbox/conversations'
import type { OutboxRow } from '../outbox'
import { PROPOSAL_BUTTON_TITLE_MAX } from '../proposals/render'
import { cancelAppointmentOp } from '../scheduling'
import { formatBookedWhenAt } from '../scheduling/format-booked-when'
import { clinicCivilDateFromUtc } from '../scheduling/timezone'
import type { ClinicDb } from '../store'
import { extractDates } from './autobook'
import { MODEL_FALLBACK_TEXT } from './model-fallback'
import { validateClientOutbound } from './outbound-validate'
import { saveBookingFrame, getBookingFrame } from './schedule-session'
import {
  dayText,
  loadUpcomingAppointments,
  phraseCancelOfferReschedule,
  type UpcomingApt,
} from './reschedule'

export const CANCEL_CONFIRM_BUTTON_TITLE = 'Cancelar marcação'

const INSIST_CANCEL_ONLY =
  /\b(s[oó]\s+cancel\w*|s[oó]\s+desist\w*|cancela\s+mesmo|n[aã]o\s+quero\s+remarc\w*|sem\s+remarc\w*|pode\s+cancelar|quero\s+cancelar\s+mesmo)\b/i

const DECLINE_RESCHEDULE =
  /\b(n[aã]o\s+quero\s+remarc\w*|n[aã]o\s+quero\s+reagend\w*|sem\s+remarc\w*|s[oó]\s+cancel\w*|cancela\s+mesmo)\b/i

const DISAMBIG_ACK =
  /\b(sim|isso|essa|é\s+essa|essa\s+mesma|pode\s+ser|confirmo\s+que\s+[eé])\b/i

function safePhrase(text: string): string {
  const check = validateClientOutbound(text, { source: 'phrase', requireSingleQuestion: false })
  return check.ok ? text : MODEL_FALLBACK_TEXT
}

export function cancelConfirmButtonId(appointmentId: string): string {
  return `apt:cancel:${appointmentId}:confirm`
}

export function parseCancelConfirmButtonId(
  raw: string,
): { appointmentId: string } | null {
  const m = /^apt:cancel:([^:]+):confirm$/.exec(raw.trim())
  if (!m) return null
  return { appointmentId: m[1]! }
}

export type CancelTargetResolution =
  | { kind: 'none' }
  | { kind: 'single'; apt: UpcomingApt }
  | { kind: 'day_mismatch'; apt: UpcomingApt; namedDate: string; replyText: string }
  | { kind: 'disambiguate'; appointments: UpcomingApt[]; replyText: string }

export function resolveCancelTargetAppointment(
  db: ClinicDb,
  tenantId: string,
  contactId: string,
  inboundText: string,
  clock: Clock,
): CancelTargetResolution {
  const now = clock.nowMs()
  const settings = ensureClinicSettings(db, tenantId, clock)
  const tz = settings.timezone || 'America/Sao_Paulo'
  const today = clinicCivilDateFromUtc(tz, now)
  const upcoming = loadUpcomingAppointments(db, tenantId, contactId, now)
  if (upcoming.length === 0) return { kind: 'none' }

  const namedDates = [...extractDates(inboundText, today)]
  const namedDate = namedDates.length === 1 ? namedDates[0] : namedDates.length > 1 ? namedDates[namedDates.length - 1] : null

  const matchDate = (apt: UpcomingApt, date: string) =>
    clinicCivilDateFromUtc(tz, apt.startsAt) === date

  if (namedDate) {
    const onDay = upcoming.filter((a) => matchDate(a, namedDate))
    if (onDay.length === 1) return { kind: 'single', apt: onDay[0]! }
    if (onDay.length > 1) {
      const listed = onDay
        .map((a) => `${a.serviceName} · ${formatBookedWhenAt(tz, a.startsAt)}`)
        .join('; ')
      return {
        kind: 'disambiguate',
        appointments: onDay,
        replyText: safePhrase(
          `Tenho estas marcações na ${dayText(namedDate)}: ${listed}. Qual delas você quer cancelar?`,
        ),
      }
    }
    if (upcoming.length === 1) {
      const apt = upcoming[0]!
      const aptDate = clinicCivilDateFromUtc(tz, apt.startsAt)
      if (aptDate !== namedDate) {
        const when = formatBookedWhenAt(tz, apt.startsAt)
        return {
          kind: 'day_mismatch',
          apt,
          namedDate,
          replyText: safePhrase(
            `Você mencionou ${dayText(namedDate)}, mas a sua marcação de ${apt.serviceName} é ${when}. É essa que quer cancelar?`,
          ),
        }
      }
      return { kind: 'single', apt }
    }
    const listed = upcoming
      .map((a) => `${a.serviceName} · ${formatBookedWhenAt(tz, a.startsAt)}`)
      .join('; ')
    return {
      kind: 'disambiguate',
      appointments: upcoming,
      replyText: safePhrase(
        `Não encontrei marcação na ${dayText(namedDate)}. As suas próximas são: ${listed}. Qual delas você quer cancelar?`,
      ),
    }
  }

  if (upcoming.length === 1) return { kind: 'single', apt: upcoming[0]! }
  const listed = upcoming
    .map((a) => `${a.serviceName} · ${formatBookedWhenAt(tz, a.startsAt)}`)
    .join('; ')
  return {
    kind: 'disambiguate',
    appointments: upcoming,
    replyText: safePhrase(`Qual destas marcações você quer cancelar? ${listed}`),
  }
}

export function isInsistCancelOnly(text: string): boolean {
  return INSIST_CANCEL_ONLY.test(text.trim()) || DECLINE_RESCHEDULE.test(text.trim())
}

export function isCancelDisambiguationAck(text: string): boolean {
  const body = text.trim()
  if (!body) return false
  if (INSIST_CANCEL_ONLY.test(body)) return true
  return DISAMBIG_ACK.test(body) && !/\b(remarc|outro dia|reagend)\b/i.test(body)
}

export function cancelConfirmOfferBody(apt: UpcomingApt, tz: string): string {
  const when = formatBookedWhenAt(tz, apt.startsAt)
  return safePhrase(
    `Para cancelar ${apt.serviceName} · ${when}, toque em ${CANCEL_CONFIRM_BUTTON_TITLE}.`,
  )
}

export function cancelConfirmInteractiveButtons(appointmentId: string): Array<{ id: string; title: string }> {
  if (CANCEL_CONFIRM_BUTTON_TITLE.length > PROPOSAL_BUTTON_TITLE_MAX) {
    throw new Error('cancel_button_title_too_long')
  }
  return [{ id: cancelConfirmButtonId(appointmentId), title: CANCEL_CONFIRM_BUTTON_TITLE }]
}

export type CancelAutodraftOutcome =
  | { handled: false }
  | {
      handled: true
      replyText: string
      interactive?: { buttons: Array<{ id: string; title: string }> }
      appointmentId: string
      reason:
        | 'cancel_offer_reschedule'
        | 'cancel_disambiguate'
        | 'cancel_day_mismatch'
        | 'cancel_confirm_offer'
      clearCancelTarget?: boolean
    }

/**
 * Continuação do fluxo de cancelamento (pós oferta de remarcar / desambiguação).
 */
export function tryCancelAutodraftContinuation(
  db: ClinicDb,
  tenantId: string,
  conversationId: string,
  inboundText: string,
  clock: Clock,
): CancelAutodraftOutcome {
  const frame = getBookingFrame(db, tenantId, conversationId)
  const aptId = frame?.rescheduleAppointmentId?.trim()
  if (!aptId) return { handled: false }

  const conv = getConversation(db, tenantId, conversationId)
  if (!conv) return { handled: false }

  const settings = ensureClinicSettings(db, tenantId, clock)
  const tz = settings.timezone || 'America/Sao_Paulo'
  const upcoming = loadUpcomingAppointments(db, tenantId, conv.contactId, clock.nowMs())
  const apt = upcoming.find((a) => a.id === aptId) ?? upcoming[0]
  if (!apt) {
    saveBookingFrame(db, tenantId, conversationId, { rescheduleAppointmentId: null }, clock)
    return { handled: false }
  }

  if (isCancelDisambiguationAck(inboundText) || isInsistCancelOnly(inboundText)) {
    return {
      handled: true,
      replyText: cancelConfirmOfferBody(apt, tz),
      interactive: { buttons: cancelConfirmInteractiveButtons(apt.id) },
      appointmentId: apt.id,
      reason: 'cancel_confirm_offer',
    }
  }
  return { handled: false }
}

export type CancelIntentOutcome = CancelAutodraftOutcome

export function handleCancelIntentAutodraft(
  db: ClinicDb,
  tenantId: string,
  conversationId: string,
  contactId: string,
  inboundText: string,
  clock: Clock,
): CancelIntentOutcome {
  const resolution = resolveCancelTargetAppointment(db, tenantId, contactId, inboundText, clock)
  if (resolution.kind === 'none') return { handled: false }

  if (resolution.kind === 'day_mismatch') {
    saveBookingFrame(
      db,
      tenantId,
      conversationId,
      { rescheduleAppointmentId: resolution.apt.id },
      clock,
    )
    return {
      handled: true,
      replyText: resolution.replyText,
      appointmentId: resolution.apt.id,
      reason: 'cancel_day_mismatch',
    }
  }

  if (resolution.kind === 'disambiguate') {
    return {
      handled: true,
      replyText: resolution.replyText,
      appointmentId: resolution.appointments[0]?.id ?? '',
      reason: 'cancel_disambiguate',
    }
  }

  const apt = resolution.apt
  saveBookingFrame(
    db,
    tenantId,
    conversationId,
    { rescheduleAppointmentId: apt.id, serviceId: apt.serviceId },
    clock,
  )
  return {
    handled: true,
    replyText: phraseCancelOfferReschedule(apt.serviceName),
    appointmentId: apt.id,
    reason: 'cancel_offer_reschedule',
  }
}

export type CancelButtonClickInput = {
  tenantId: string
  contactId: string
  conversationId: string
  buttonId: string
  providerEventKey?: string | null
}

export type CancelButtonClickResult =
  | { handled: false }
  | { handled: true; appointmentId: string; outbox: OutboxRow[] }

export function handleCancelConfirmButtonClick(
  db: ClinicDb,
  caller: ClinicCaller,
  input: CancelButtonClickInput,
  clock: Clock,
): CancelButtonClickResult {
  const parsed = parseCancelConfirmButtonId(input.buttonId)
  if (!parsed) return { handled: false }

  const clientRequestId = `ai-cancel:${parsed.appointmentId}:${input.providerEventKey ?? 'click'}`
  const cancelled = cancelAppointmentOp(
    db,
    caller,
    {
      clientRequestId,
      appointmentId: parsed.appointmentId,
      reason: 'contato_desistiu',
      actorClerkUserId: AI_AUTOBOOK_ACTOR,
    },
    clock,
  )

  saveBookingFrame(
    db,
    caller.tenantId,
    input.conversationId,
    { rescheduleAppointmentId: null, phase: 'idle' },
    clock,
  )

  return {
    handled: true,
    appointmentId: parsed.appointmentId,
    outbox: cancelled.outbox,
  }
}