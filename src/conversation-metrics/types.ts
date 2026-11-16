/**
 * Métricas founder-approved de qualidade conversacional.
 * Sem corpo de mensagem nos tipos expostos ao D1 / MCP.
 */
import type { BookingSessionOutcome, BookingSessionStep } from '../clinic/ai/booking-session'

export const CONVERSATION_QUALITY_TTL_MS = 90 * 24 * 60 * 60 * 1000

export const ABANDONMENT_IDLE_MS = 24 * 60 * 60 * 1000

export type AttendantRequestSource = 'spontaneous' | 'offered_misunderstanding_rule'

export type FalseConfirmationSignal = 'team_will_confirm' | 'claimed_booked'

export type AiAppointmentFulfillment =
  | 'pending'
  | 'fulfilled'
  | 'cancelled'
  | 'no_show'
  | 'unknown'

/** Linha minimizada no D1 central (uma por booking_session). */
export type ConversationQualityEpisodeRow = {
  sessionId: string
  tenantId: string
  conversationId: string
  openedAt: number
  closedAt: number | null
  lastMessageAt: number
  outcome: BookingSessionOutcome | null
  dropStep: BookingSessionStep | null
  maxStep: BookingSessionStep | null
  inboundTurns: number
  inboundTurnsToConfirm: number | null
  confirmedAppointmentId: string | null
  bookingIntent: boolean
  misunderstandingTurns: number
  attendantSpontaneous: number
  attendantOfferedRule: number
  attendantRecognized: number
  attendantRegistered: number
  attendantLastStep: BookingSessionStep | null
  handoffUnattended: boolean
  falseConfirmation: boolean
  aiAppointmentFulfillment: AiAppointmentFulfillment | null
  expiresAt: number
}

export type ConversationMetricsWindow = {
  tenantId: string | null
  fromMs: number
  toMs: number
}

export type ConversationMetricsReport = {
  window: ConversationMetricsWindow
  /** PRIMARY: intenção de marcar que terminou com compromisso confirmado. */
  bookingRate: {
    episodesWithIntent: number
    confirmed: number
    rate: number | null
  }
  /** RED LINE — deve ser 0; cada ocorrência gera alerta severo. */
  falseConfirmations: {
    count: number
    ids: string[]
  }
  attendantCalls: {
    episodesWithRequest: number
    episodesTotal: number
    rate: number | null
    spontaneous: number
    offeredByMisunderstandingRule: number
    recognized: number
    registered: number
    recognitionRate: number | null
    registrationRate: number | null
    stepBreakdown: Record<string, number>
  }
  abandonedConversations: {
    count: number
    stepBreakdown: Record<string, number>
  }
  messagesToBook: {
    median: number | null
    samples: number
    baseline: number
  }
  misunderstandingsPerConversation: {
    mean: number | null
    totalTurns: number
    episodes: number
  }
  attendance: {
    /** Agendamentos feitos pela IA (confirmed_by system) na janela. */
    aiBooked: number
    fulfilled: number
    cancelled: number
    noShow: number
    pending: number
    unknown: number
    fulfillmentRate: number | null
    note: string
  }
  blindSpots: string[]
}