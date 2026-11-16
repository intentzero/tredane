/**
 * Agregação pura das métricas founder-approved a partir de episódios D1.
 */
import { ABANDONMENT_IDLE_MS } from './types'
import type {
  ConversationMetricsReport,
  ConversationMetricsWindow,
  ConversationQualityEpisodeRow,
} from './types'

const MESSAGES_TO_BOOK_BASELINE = 6

function median(nums: number[]): number | null {
  if (nums.length === 0) return null
  const sorted = [...nums].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? (sorted[mid - 1]! + sorted[mid]!) / 2
    : sorted[mid]!
}

function inWindow(ep: ConversationQualityEpisodeRow, w: ConversationMetricsWindow): boolean {
  if (w.tenantId != null && ep.tenantId !== w.tenantId) return false
  const anchor = ep.closedAt ?? ep.openedAt
  return anchor >= w.fromMs && anchor <= w.toMs
}

function isAbandoned(ep: ConversationQualityEpisodeRow, nowMs: number): boolean {
  if (!ep.bookingIntent) return false
  if (ep.confirmedAppointmentId) return false
  const handoffOk =
    ep.outcome === 'handoff' && (ep.attendantRegistered > 0 || !ep.handoffUnattended)
  if (handoffOk) return false
  const idleMs = nowMs - ep.lastMessageAt
  if (idleMs < ABANDONMENT_IDLE_MS) return false
  if (ep.outcome === 'agendado') return false
  if (ep.handoffUnattended) return true
  if (ep.outcome === 'handoff' && ep.attendantRegistered === 0) return true
  return ep.outcome == null || ep.outcome === 'abandon'
}

export function computeConversationMetrics(
  episodes: ConversationQualityEpisodeRow[],
  falseConfirmationIds: string[],
  window: ConversationMetricsWindow,
  nowMs: number,
): ConversationMetricsReport {
  const scoped = episodes.filter((e) => inWindow(e, window))

  const withIntent = scoped.filter((e) => e.bookingIntent)
  const confirmed = withIntent.filter(
    (e) => e.outcome === 'agendado' && e.confirmedAppointmentId != null,
  )

  const attendantEpisodes = withIntent.filter(
    (e) => e.attendantSpontaneous + e.attendantOfferedRule > 0,
  )

  const stepAttendant: Record<string, number> = {}
  for (const ep of attendantEpisodes) {
    const step = ep.attendantLastStep ?? ep.maxStep ?? ep.dropStep ?? 'unknown'
    stepAttendant[step] = (stepAttendant[step] ?? 0) + 1
  }

  const recognized = attendantEpisodes.reduce((n, e) => n + e.attendantRecognized, 0)
  const registered = attendantEpisodes.reduce((n, e) => n + e.attendantRegistered, 0)
  const spontaneous = attendantEpisodes.reduce((n, e) => n + e.attendantSpontaneous, 0)
  const offeredRule = attendantEpisodes.reduce((n, e) => n + e.attendantOfferedRule, 0)

  const abandoned = withIntent.filter((e) => isAbandoned(e, nowMs))
  const stepAbandon: Record<string, number> = {}
  for (const ep of abandoned) {
    const step = ep.dropStep ?? ep.maxStep ?? 'unknown'
    stepAbandon[step] = (stepAbandon[step] ?? 0) + 1
  }

  const turnsToBook = confirmed
    .map((e) => e.inboundTurnsToConfirm ?? e.inboundTurns)
    .filter((n) => n > 0)

  const misunderstandingTotal = withIntent.reduce((n, e) => n + e.misunderstandingTurns, 0)

  const aiEpisodes = scoped.filter((e) => e.confirmedAppointmentId != null)
  const attendance = {
    aiBooked: aiEpisodes.length,
    fulfilled: aiEpisodes.filter((e) => e.aiAppointmentFulfillment === 'fulfilled').length,
    cancelled: aiEpisodes.filter((e) => e.aiAppointmentFulfillment === 'cancelled').length,
    noShow: aiEpisodes.filter((e) => e.aiAppointmentFulfillment === 'no_show').length,
    pending: aiEpisodes.filter((e) => e.aiAppointmentFulfillment === 'pending').length,
    unknown: aiEpisodes.filter((e) => e.aiAppointmentFulfillment === 'unknown').length,
    fulfillmentRate: null as number | null,
    note: 'Comparecimento deriva de status/cancelamento no DO; no-show só quando change_reason=nao_compareceu.',
  }
  const past = attendance.fulfilled + attendance.cancelled + attendance.noShow
  if (past > 0) {
    attendance.fulfillmentRate = attendance.fulfilled / past
  }

  const blindSpots: string[] = []
  if (attendance.pending > 0) {
    blindSpots.push(
      `${attendance.pending} agendamento(s) IA ainda no futuro — comparecimento pendente.`,
    )
  }
  if (attendance.unknown > 0) {
    blindSpots.push(`${attendance.unknown} agendamento(s) IA sem classificação de fulfillment.`)
  }
  blindSpots.push(
    'offered_misunderstanding_rule: `notifyHumanHandoff` com clientRequestId `ai-misunderstanding-esc:*` (PR #801) ou `recordAttendantMetricsForOpenSession` após `registerHumanHelpRequest`.',
  )
  blindSpots.push(
    'Pergunta da cliente ignorada só entra via contador futuro (question_ignored); hoje: fallback + nao_encontrei + repetida.',
  )

  return {
    window,
    bookingRate: {
      episodesWithIntent: withIntent.length,
      confirmed: confirmed.length,
      rate: withIntent.length > 0 ? confirmed.length / withIntent.length : null,
    },
    falseConfirmations: {
      count: falseConfirmationIds.length,
      ids: falseConfirmationIds,
    },
    attendantCalls: {
      episodesWithRequest: attendantEpisodes.length,
      episodesTotal: withIntent.length,
      rate: withIntent.length > 0 ? attendantEpisodes.length / withIntent.length : null,
      spontaneous,
      offeredByMisunderstandingRule: offeredRule,
      recognized,
      registered,
      recognitionRate:
        spontaneous + offeredRule > 0 ? recognized / (spontaneous + offeredRule) : null,
      registrationRate: attendantEpisodes.length > 0 ? registered / attendantEpisodes.length : null,
      stepBreakdown: stepAttendant,
    },
    abandonedConversations: {
      count: abandoned.length,
      stepBreakdown: stepAbandon,
    },
    messagesToBook: {
      median: median(turnsToBook),
      samples: turnsToBook.length,
      baseline: MESSAGES_TO_BOOK_BASELINE,
    },
    misunderstandingsPerConversation: {
      mean: withIntent.length > 0 ? misunderstandingTotal / withIntent.length : null,
      totalTurns: misunderstandingTotal,
      episodes: withIntent.length,
    },
    attendance,
    blindSpots,
  }
}