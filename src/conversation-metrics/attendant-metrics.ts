/**
 * Métricas de pedido de atendente (plug-in para P3/P4 e regra das 2 incompreensões, PR #801).
 */
import { getOpenBookingSession } from '../clinic/ai/booking-session'
import type { BookingSessionStep } from '../clinic/ai/booking-session'
import type { ClinicDb } from '../clinic/store'
import { recordAttendantRequest } from './session-counters'
import type { AttendantRequestSource } from './types'

/** PR #801: `replyMisunderstandingEscalation` usa este prefixo no clientRequestId. */
export const MISUNDERSTANDING_ESC_CLIENT_PREFIX = 'ai-misunderstanding-esc:'

export function resolveAttendantRequestSource(
  explicit: AttendantRequestSource | undefined,
  clientRequestId: string,
): AttendantRequestSource {
  if (explicit) return explicit
  if (clientRequestId.startsWith(MISUNDERSTANDING_ESC_CLIENT_PREFIX)) {
    return 'offered_misunderstanding_rule'
  }
  return 'spontaneous'
}

/** Chamar após registo do pedido à equipe (ex.: `registerHumanHelpRequest` no PR #801). */
export function recordAttendantMetricsForOpenSession(
  db: ClinicDb,
  tenantId: string,
  conversationId: string,
  input: {
    source: AttendantRequestSource
    recognized: boolean
    registered: boolean
  },
): void {
  const open = getOpenBookingSession(db, tenantId, conversationId)
  if (!open) return
  recordAttendantRequest(db, open.sessionId, {
    source: input.source,
    recognized: input.recognized,
    registered: input.registered,
    step: open.maxStep as BookingSessionStep | null,
  })
}