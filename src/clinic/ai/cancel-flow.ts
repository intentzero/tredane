/**
 * Cancelamento conversacional com botão (DEC-061 espelho / lab S24–S25).
 * Nunca cancela por texto livre — só após toque em «Cancelar marcação».
 */
import type { Clock } from '../../db/clock'
import { AI_AUTOBOOK_ACTOR } from '../constants'
import type { ClinicCaller } from '../envelopes'
import { ensureClinicSettings } from '../config/settings'
import { getConversation } from '../inbox/conversations'
import { sendOutboundMessageOp } from '../inbox/operations'
import type { SendOutboundInteractiveInput } from '../inbox/types'
import type { OutboxRow } from '../outbox'
import { PROPOSAL_BUTTON_TITLE_MAX } from '../proposals/interactive-limits'
import { cancelAppointmentOp } from '../scheduling'
import { formatBookedWhenAt } from '../scheduling/format-booked-when'
import { clinicCivilDateFromUtc } from '../scheduling/timezone'
import type { ClinicDb } from '../store'
import {
  CANCEL_MISMATCH_DATE_PREFIX,
  filterUpcomingByServiceMention,
  isCancelMismatchPending,
} from './appointment-intent'
import { extractDates } from './autobook'
import {
  buildCancelAppointmentChoiceInteractive,
  toSendInteractive,
} from './choice-offer'
import { createDeferredBookingFrame, type DeferredBookingFrame } from './deferred-booking-frame'
import { MODEL_FALLBACK_TEXT } from './model-fallback'
import { validateClientOutbound } from './outbound-validate'
import { saveBookingFrame, getBookingFrame } from './schedule-session'
import { readCatalogVersion } from './turn-context'
import {
  dayText,
  loadUpcomingAppointments,
  phraseCancelOfferReschedule,
  type UpcomingApt,
} from './reschedule'

export const CANCEL_CONFIRM_BUTTON_TITLE = 'Cancelar marcação'

const AUTODRAFT_ACTOR_ID = 'system:ai-autodraft'
const AUTODRAFT_ACTOR_NAME = 'IA'

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

export type CancelDisambiguateVariant = 'same_day' | 'wrong_day' | 'unspecified'

export type CancelTargetResolution =
  | { kind: 'none' }
  | { kind: 'single'; apt: UpcomingApt }
  | { kind: 'day_mismatch'; apt: UpcomingApt; namedDate: string; replyText: string }
  | {
      kind: 'disambiguate'
      appointments: UpcomingApt[]
      /** Corpo com lista em prosa — fallback sem interativo. */
      replyText: string
      variant: CancelDisambiguateVariant
      namedDate?: string
    }

function disambiguateListIntro(variant: CancelDisambiguateVariant, namedDate?: string): string {
  if (variant === 'wrong_day' && namedDate) {
    return safePhrase(
      `Não encontrei marcação na ${dayText(namedDate)}. Qual destas você quer cancelar?`,
    )
  }
  if (variant === 'same_day' && namedDate) {
    return safePhrase(
      `Tenho várias marcações na ${dayText(namedDate)}. Qual delas você quer cancelar?`,
    )
  }
  return safePhrase('Qual destas marcações você quer cancelar?')
}

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
  let upcoming = loadUpcomingAppointments(db, tenantId, contactId, now)
  if (upcoming.length === 0) return { kind: 'none' }
  upcoming = filterUpcomingByServiceMention(upcoming, inboundText, db, tenantId)
  if (upcoming.length === 0) return { kind: 'none' }

  const namedDates = [...extractDates(inboundText, today)]
  const namedDate = namedDates.length === 1 ? namedDates[0] : namedDates.length > 1 ? namedDates[namedDates.length - 1] : null

  const matchDate = (apt: UpcomingApt, date: string) =>
    clinicCivilDateFromUtc(tz, apt.startsAt) === date

  const listFallback = (appointments: UpcomingApt[]) => {
    const listed = appointments
      .map((a) => `${a.serviceName} · ${formatBookedWhenAt(tz, a.startsAt)}`)
      .join('; ')
    return listed
  }

  if (namedDate) {
    const onDay = upcoming.filter((a) => matchDate(a, namedDate))
    if (onDay.length === 1) return { kind: 'single', apt: onDay[0]! }
    if (onDay.length > 1) {
      const listed = listFallback(onDay)
      return {
        kind: 'disambiguate',
        appointments: onDay,
        variant: 'same_day',
        namedDate,
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
            `Na ${dayText(namedDate)} não encontrei marcação sua. A sua é ${apt.serviceName} · ${when}. É essa que quer cancelar?`,
          ),
        }
      }
      return { kind: 'single', apt }
    }
    const listed = listFallback(upcoming)
    return {
      kind: 'disambiguate',
      appointments: upcoming,
      variant: 'wrong_day',
      namedDate,
      replyText: safePhrase(
        `Não encontrei marcação na ${dayText(namedDate)}. As suas próximas são: ${listed}. Qual delas você quer cancelar?`,
      ),
    }
  }

  if (upcoming.length === 1) return { kind: 'single', apt: upcoming[0]! }
  const listed = listFallback(upcoming)
  return {
    kind: 'disambiguate',
    appointments: upcoming,
    variant: 'unspecified',
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
      interactive?: SendOutboundInteractiveInput
      deferredFrame?: DeferredBookingFrame
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
  const mismatchPending = isCancelMismatchPending(frame?.date)

  const conv = getConversation(db, tenantId, conversationId)
  if (!conv) return { handled: false }

  const settings = ensureClinicSettings(db, tenantId, clock)
  const tz = settings.timezone || 'America/Sao_Paulo'
  const upcoming = loadUpcomingAppointments(db, tenantId, conv.contactId, clock.nowMs())

  if (mismatchPending) {
    const aptId = frame?.rescheduleAppointmentId?.trim()
    const apt = aptId ? upcoming.find((a) => a.id === aptId) : upcoming[0]
    if (!apt) {
      saveBookingFrame(db, tenantId, conversationId, { rescheduleAppointmentId: null, date: null }, clock)
      return { handled: false }
    }
    if (isCancelDisambiguationAck(inboundText)) {
      saveBookingFrame(db, tenantId, conversationId, { date: null }, clock)
      return {
        handled: true,
        replyText: phraseCancelOfferReschedule(apt.serviceName),
        appointmentId: apt.id,
        reason: 'cancel_offer_reschedule',
      }
    }
    if (isInsistCancelOnly(inboundText)) {
      saveBookingFrame(db, tenantId, conversationId, { date: null }, clock)
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

  const aptId = frame?.rescheduleAppointmentId?.trim()
  if (!aptId) return { handled: false }

  const apt = upcoming.find((a) => a.id === aptId) ?? upcoming[0]
  if (!apt) {
    saveBookingFrame(db, tenantId, conversationId, { rescheduleAppointmentId: null }, clock)
    return { handled: false }
  }

  if (isInsistCancelOnly(inboundText)) {
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

export type HandleCancelIntentInput = {
  capability?: boolean
}

export function handleCancelIntentAutodraft(
  db: ClinicDb,
  tenantId: string,
  conversationId: string,
  contactId: string,
  inboundText: string,
  clock: Clock,
  options: HandleCancelIntentInput = {},
): CancelIntentOutcome {
  const capability = options.capability !== false
  const resolution = resolveCancelTargetAppointment(db, tenantId, contactId, inboundText, clock)
  if (resolution.kind === 'none') return { handled: false }

  if (resolution.kind === 'day_mismatch') {
    saveBookingFrame(
      db,
      tenantId,
      conversationId,
      {
        serviceId: resolution.apt.serviceId,
        rescheduleAppointmentId: resolution.apt.id,
        date: `${CANCEL_MISMATCH_DATE_PREFIX}${resolution.namedDate}`,
      },
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
    const settings = ensureClinicSettings(db, tenantId, clock)
    const tz = settings.timezone || 'America/Sao_Paulo'
    const catalogVersion = readCatalogVersion(db, tenantId)
    const useList = capability && resolution.appointments.length > 1
    const replyText = useList
      ? disambiguateListIntro(resolution.variant, resolution.namedDate)
      : resolution.replyText

    if (useList) {
      const built = buildCancelAppointmentChoiceInteractive({
        catalogVersion,
        appointments: resolution.appointments.map((a) => ({
          id: a.id,
          serviceName: a.serviceName,
          whenLabel: formatBookedWhenAt(tz, a.startsAt),
        })),
      })
      const deferred = createDeferredBookingFrame()
      deferred.saveFrame({
        catalogVersion,
        pending: built.pending,
      })
      return {
        handled: true,
        replyText,
        interactive: toSendInteractive(built.interactive) ?? undefined,
        deferredFrame: deferred,
        appointmentId: resolution.appointments[0]?.id ?? '',
        reason: 'cancel_disambiguate',
      }
    }

    return {
      handled: true,
      replyText,
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

export type CancelAppointmentListClickInput = {
  tenantId: string
  conversationId: string
  appointmentId: string
  providerEventKey?: string | null
}

export type CancelAppointmentListClickResult =
  | { handled: false }
  | { handled: true; appointmentId: string; outbox: OutboxRow[] }

/** Toque numa linha da lista de marcações — oferta remarcar (não cancela). */
export function handleCancelAppointmentChoiceClick(
  db: ClinicDb,
  caller: ClinicCaller,
  input: CancelAppointmentListClickInput,
  clock: Clock,
): CancelAppointmentListClickResult {
  const conv = getConversation(db, caller.tenantId, input.conversationId)
  if (!conv) return { handled: false }

  const upcoming = loadUpcomingAppointments(db, caller.tenantId, conv.contactId, clock.nowMs())
  const apt = upcoming.find((a) => a.id === input.appointmentId)
  if (!apt) return { handled: false }

  saveBookingFrame(
    db,
    caller.tenantId,
    input.conversationId,
    {
      rescheduleAppointmentId: apt.id,
      serviceId: apt.serviceId,
      pending: null,
    },
    clock,
  )

  try {
    const sent = sendOutboundMessageOp(
      db,
      caller,
      {
        conversationId: input.conversationId,
        body: phraseCancelOfferReschedule(apt.serviceName),
        clientRequestId: `cancel-pick:${apt.id}:${input.providerEventKey ?? clock.nowMs()}`,
        authorClerkUserId: AUTODRAFT_ACTOR_ID,
        authorDisplayName: AUTODRAFT_ACTOR_NAME,
      },
      clock,
    )
    return { handled: true, appointmentId: apt.id, outbox: sent.outbox }
  } catch {
    return { handled: false }
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