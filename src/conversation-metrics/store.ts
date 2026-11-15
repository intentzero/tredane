/**
 * Persistência D1 central das métricas (fail-soft).
 */
import type { AsyncAdminDb } from '../db/admin/async-store'
import type { SqlValue } from '../db/admin/store'
import type {
  ConversationQualityEpisodeRow,
  FalseConfirmationSignal,
} from './types'
import { CONVERSATION_QUALITY_TTL_MS } from './types'

export type FalseConfirmationRow = {
  id: string
  tenantId: string
  conversationId: string
  sessionId: string | null
  messageId: string
  occurredAt: number
  signal: FalseConfirmationSignal
  expiresAt: number
}

export async function upsertConversationQualityEpisode(
  db: AsyncAdminDb,
  row: ConversationQualityEpisodeRow,
): Promise<void> {
  try {
    await db.run(
      `INSERT INTO conversation_quality_episodes (
         session_id, tenant_id, conversation_id, opened_at, closed_at, last_message_at,
         outcome, drop_step, max_step, inbound_turns, inbound_turns_to_confirm,
         confirmed_appointment_id, booking_intent, misunderstanding_turns,
         attendant_spontaneous, attendant_offered_rule, attendant_recognized,
         attendant_registered, attendant_last_step, handoff_unattended,
         false_confirmation, ai_appointment_fulfillment, expires_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (session_id) DO UPDATE SET
         closed_at = excluded.closed_at,
         last_message_at = excluded.last_message_at,
         outcome = excluded.outcome,
         drop_step = excluded.drop_step,
         max_step = excluded.max_step,
         inbound_turns = excluded.inbound_turns,
         inbound_turns_to_confirm = excluded.inbound_turns_to_confirm,
         confirmed_appointment_id = excluded.confirmed_appointment_id,
         misunderstanding_turns = excluded.misunderstanding_turns,
         attendant_spontaneous = excluded.attendant_spontaneous,
         attendant_offered_rule = excluded.attendant_offered_rule,
         attendant_recognized = excluded.attendant_recognized,
         attendant_registered = excluded.attendant_registered,
         attendant_last_step = excluded.attendant_last_step,
         handoff_unattended = excluded.handoff_unattended,
         false_confirmation = excluded.false_confirmation,
         ai_appointment_fulfillment = excluded.ai_appointment_fulfillment,
         expires_at = excluded.expires_at`,
      row.sessionId,
      row.tenantId,
      row.conversationId,
      row.openedAt,
      row.closedAt,
      row.lastMessageAt,
      row.outcome,
      row.dropStep,
      row.maxStep,
      row.inboundTurns,
      row.inboundTurnsToConfirm,
      row.confirmedAppointmentId,
      row.bookingIntent ? 1 : 0,
      row.misunderstandingTurns,
      row.attendantSpontaneous,
      row.attendantOfferedRule,
      row.attendantRecognized,
      row.attendantRegistered,
      row.attendantLastStep,
      row.handoffUnattended ? 1 : 0,
      row.falseConfirmation ? 1 : 0,
      row.aiAppointmentFulfillment,
      row.expiresAt,
    )
  } catch (err) {
    console.warn(
      JSON.stringify({
        level: 'warn',
        event: 'conversation_quality.episode_sink_failed',
        tenantId: row.tenantId,
        sessionId: row.sessionId,
        error: err instanceof Error ? err.message : 'unknown',
      }),
    )
  }
}

export async function insertFalseConfirmation(
  db: AsyncAdminDb,
  input: {
    tenantId: string
    conversationId: string
    sessionId: string | null
    messageId: string
    signal: FalseConfirmationSignal
    nowMs: number
  },
): Promise<{ inserted: boolean; id: string }> {
  const id = `cfc_${input.tenantId}_${input.conversationId}_${input.messageId}_${input.signal}`
  try {
    await db.run(
      `INSERT INTO conversation_false_confirmations
       (id, tenant_id, conversation_id, session_id, message_id, occurred_at, signal, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (tenant_id, conversation_id, message_id, signal) DO NOTHING`,
      id,
      input.tenantId,
      input.conversationId,
      input.sessionId,
      input.messageId,
      input.nowMs,
      input.signal,
      input.nowMs + CONVERSATION_QUALITY_TTL_MS,
    )
    return { inserted: true, id }
  } catch (err) {
    console.warn(
      JSON.stringify({
        level: 'warn',
        event: 'conversation_quality.false_confirmation_sink_failed',
        tenantId: input.tenantId,
        error: err instanceof Error ? err.message : 'unknown',
      }),
    )
    return { inserted: false, id }
  }
}

export async function listConversationQualityEpisodes(
  db: AsyncAdminDb,
  opts: { sinceMs: number; toMs: number; tenantId?: string | null },
): Promise<ConversationQualityEpisodeRow[]> {
  const tenantFilter = opts.tenantId ? 'AND tenant_id = ?' : ''
  const params: SqlValue[] = [opts.sinceMs, opts.toMs]
  if (opts.tenantId) params.push(opts.tenantId)
  const rows = await db.all<{
    session_id: string
    tenant_id: string
    conversation_id: string
    opened_at: number
    closed_at: number | null
    last_message_at: number
    outcome: string | null
    drop_step: string | null
    max_step: string | null
    inbound_turns: number
    inbound_turns_to_confirm: number | null
    confirmed_appointment_id: string | null
    booking_intent: number
    misunderstanding_turns: number
    attendant_spontaneous: number
    attendant_offered_rule: number
    attendant_recognized: number
    attendant_registered: number
    attendant_last_step: string | null
    handoff_unattended: number
    false_confirmation: number
    ai_appointment_fulfillment: string | null
    expires_at: number
  }>(
    `SELECT * FROM conversation_quality_episodes
     WHERE COALESCE(closed_at, opened_at) >= ? AND COALESCE(closed_at, opened_at) <= ?
     ${tenantFilter}
     ORDER BY opened_at DESC`,
    ...params,
  )
  return rows.map((r) => ({
    sessionId: r.session_id,
    tenantId: r.tenant_id,
    conversationId: r.conversation_id,
    openedAt: r.opened_at,
    closedAt: r.closed_at,
    lastMessageAt: r.last_message_at,
    outcome: r.outcome as ConversationQualityEpisodeRow['outcome'],
    dropStep: r.drop_step as ConversationQualityEpisodeRow['dropStep'],
    maxStep: r.max_step as ConversationQualityEpisodeRow['maxStep'],
    inboundTurns: r.inbound_turns,
    inboundTurnsToConfirm: r.inbound_turns_to_confirm,
    confirmedAppointmentId: r.confirmed_appointment_id,
    bookingIntent: r.booking_intent === 1,
    misunderstandingTurns: r.misunderstanding_turns,
    attendantSpontaneous: r.attendant_spontaneous,
    attendantOfferedRule: r.attendant_offered_rule,
    attendantRecognized: r.attendant_recognized,
    attendantRegistered: r.attendant_registered,
    attendantLastStep: r.attendant_last_step as ConversationQualityEpisodeRow['attendantLastStep'],
    handoffUnattended: r.handoff_unattended === 1,
    falseConfirmation: r.false_confirmation === 1,
    aiAppointmentFulfillment:
      r.ai_appointment_fulfillment as ConversationQualityEpisodeRow['aiAppointmentFulfillment'],
    expiresAt: r.expires_at,
  }))
}

export async function listFalseConfirmationIds(
  db: AsyncAdminDb,
  opts: { sinceMs: number; toMs: number; tenantId?: string | null },
): Promise<string[]> {
  const tenantFilter = opts.tenantId ? 'AND tenant_id = ?' : ''
  const params: SqlValue[] = [opts.sinceMs, opts.toMs]
  if (opts.tenantId) params.push(opts.tenantId)
  const rows = await db.all<{ id: string }>(
    `SELECT id FROM conversation_false_confirmations
     WHERE occurred_at >= ? AND occurred_at <= ?
     ${tenantFilter}`,
    ...params,
  )
  return rows.map((r) => r.id)
}