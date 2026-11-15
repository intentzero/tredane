/**
 * Monta episódio minimizado a partir do SQLite do Clinic DO.
 */
import type { Clock } from '../db/clock'
import { AI_AUTOBOOK_ACTOR } from '../clinic/constants'
import type { BookingSessionRow } from '../clinic/ai/booking-session'
import type { ClinicDb } from '../clinic/store'
import type { AiAppointmentFulfillment, ConversationQualityEpisodeRow } from './types'
import { CONVERSATION_QUALITY_TTL_MS } from './types'

function lastInboundAt(
  db: ClinicDb,
  tenantId: string,
  conversationId: string,
): number {
  const row = db.get<{ t: number }>(
    `SELECT MAX(created_at) AS t FROM messages
     WHERE tenant_id = ? AND conversation_id = ? AND direction = 'inbound'`,
    tenantId,
    conversationId,
  )
  return row?.t ?? 0
}

function latestConfirmedAppointment(
  db: ClinicDb,
  tenantId: string,
  conversationId: string,
  sinceMs: number,
): { id: string; startsAt: number; status: string; changeReason: string | null; confirmedBy: string | null } | null {
  const row = db.get<{
    id: string
    starts_at: number
    status: string
    change_reason: string | null
    confirmed_by: string | null
  }>(
    `SELECT a.id, a.starts_at, a.status, a.change_reason, a.confirmed_by
     FROM appointments a
     JOIN conversations c ON c.tenant_id = a.tenant_id AND c.contact_id = a.contact_id
     WHERE a.tenant_id = ? AND c.id = ? AND a.status = 'confirmed' AND a.created_at >= ?
     ORDER BY a.created_at DESC LIMIT 1`,
    tenantId,
    conversationId,
    sinceMs,
  )
  if (!row) return null
  return {
    id: row.id,
    startsAt: row.starts_at,
    status: row.status,
    changeReason: row.change_reason,
    confirmedBy: row.confirmed_by,
  }
}

function fulfillmentForAppointment(
  appt: {
    startsAt: number
    status: string
    changeReason: string | null
    confirmedBy: string | null
  } | null,
  nowMs: number,
): AiAppointmentFulfillment | null {
  if (!appt || appt.confirmedBy !== AI_AUTOBOOK_ACTOR) return null
  if (appt.status === 'cancelled') {
    if (appt.changeReason === 'nao_compareceu') return 'no_show'
    return 'cancelled'
  }
  if (appt.startsAt > nowMs) return 'pending'
  if (appt.status === 'confirmed') return 'fulfilled'
  return 'unknown'
}

function handoffUnattended(db: ClinicDb, tenantId: string, conversationId: string): boolean {
  const conv = db.get<{
    ai_reply_paused_at: number | null
    review_flagged_at: number | null
    assignee_clerk_user_id: string | null
  }>(
    `SELECT ai_reply_paused_at, review_flagged_at, assignee_clerk_user_id
     FROM conversations WHERE tenant_id = ? AND id = ?`,
    tenantId,
    conversationId,
  )
  if (!conv?.ai_reply_paused_at) return false
  const pending = db.get<{ id: string }>(
    `SELECT id FROM pending_communications
     WHERE tenant_id = ? AND conversation_id = ? AND kind = 'alter_awaiting_team'
       AND status != 'resolved'`,
    tenantId,
    conversationId,
  )
  const registered = Boolean(conv.review_flagged_at) || Boolean(pending)
  const attended = Boolean(conv.assignee_clerk_user_id)
  return conv.ai_reply_paused_at != null && !registered && !attended
}

export function buildConversationQualityEpisode(
  db: ClinicDb,
  session: BookingSessionRow,
  clock: Clock,
  opts?: { falseConfirmation?: boolean },
): ConversationQualityEpisodeRow {
  const now = clock.nowMs()
  const lastMsg = Math.max(lastInboundAt(db, session.tenantId, session.conversationId), session.openedAt)
  let ext:
    | {
        misunderstanding_turns: number
        attendant_spontaneous: number
        attendant_offered_rule: number
        attendant_recognized: number
        attendant_registered: number
        attendant_last_step: string | null
        confirmed_appointment_id: string | null
        false_confirmation: number
      }
    | undefined
  try {
    ext = db.get(
      `SELECT misunderstanding_turns, attendant_spontaneous, attendant_offered_rule,
              attendant_recognized, attendant_registered, attendant_last_step,
              confirmed_appointment_id, COALESCE(false_confirmation, 0) AS false_confirmation
       FROM booking_sessions WHERE session_id = ?`,
      session.sessionId,
    )
  } catch {
    ext = undefined
  }

  let appointmentId = ext?.confirmed_appointment_id ?? null
  const inboundToConfirm: number | null =
    session.outcome === 'agendado' ? session.inboundTurns : null

  const appt =
    appointmentId != null
      ? db.get<{
          id: string
          starts_at: number
          status: string
          change_reason: string | null
          confirmed_by: string | null
        }>(
          `SELECT id, starts_at, status, change_reason, confirmed_by
           FROM appointments WHERE tenant_id = ? AND id = ?`,
          session.tenantId,
          appointmentId,
        )
      : latestConfirmedAppointment(db, session.tenantId, session.conversationId, session.openedAt)

  if (appt && session.outcome === 'agendado') {
    appointmentId = appt.id
  }

  const fulfillment = fulfillmentForAppointment(
    appt
      ? {
          startsAt: appt.starts_at,
          status: appt.status,
          changeReason: appt.change_reason,
          confirmedBy: appt.confirmed_by,
        }
      : null,
    now,
  )

  return {
    sessionId: session.sessionId,
    tenantId: session.tenantId,
    conversationId: session.conversationId,
    openedAt: session.openedAt,
    closedAt: session.closedAt,
    lastMessageAt: lastMsg,
    outcome: session.outcome,
    dropStep: session.dropStep,
    maxStep: session.maxStep,
    inboundTurns: session.inboundTurns,
    inboundTurnsToConfirm: inboundToConfirm,
    confirmedAppointmentId: appointmentId,
    bookingIntent: true,
    misunderstandingTurns: ext?.misunderstanding_turns ?? 0,
    attendantSpontaneous: ext?.attendant_spontaneous ?? 0,
    attendantOfferedRule: ext?.attendant_offered_rule ?? 0,
    attendantRecognized: ext?.attendant_recognized ?? 0,
    attendantRegistered: ext?.attendant_registered ?? 0,
    attendantLastStep: (ext?.attendant_last_step ??
      session.maxStep) as ConversationQualityEpisodeRow['attendantLastStep'],
    handoffUnattended: handoffUnattended(db, session.tenantId, session.conversationId),
    falseConfirmation: opts?.falseConfirmation ?? (ext?.false_confirmation ?? 0) > 0,
    aiAppointmentFulfillment: fulfillment,
    expiresAt: now + CONVERSATION_QUALITY_TTL_MS,
  }
}