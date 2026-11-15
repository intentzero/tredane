/**
 * Red line: confirmação falsa — alerta severo + D1.
 */
import type { AsyncAdminDb } from '../db/admin/async-store'
import type { Clock } from '../db/clock'
import { emitOpsAlert } from '../ops/alerts'
import type { ClinicDb } from '../clinic/store'
import { detectFalseConfirmationSignals } from './detect'
import { insertFalseConfirmation } from './store'
import { getOpenBookingSession } from '../clinic/ai/booking-session'

export async function auditOutboundForFalseConfirmation(
  db: ClinicDb,
  central: AsyncAdminDb | null,
  input: {
    tenantId: string
    conversationId: string
    messageId: string
    body: string
  },
  clock: Clock,
): Promise<void> {
  const signals = detectFalseConfirmationSignals(input.body)
  if (signals.length === 0) return

  const open = getOpenBookingSession(db, input.tenantId, input.conversationId)
  const sessionId = open?.sessionId ?? null

  const hasAppointment = Boolean(
    db.get<{ n: number }>(
      `SELECT COUNT(*) AS n FROM appointments a
       JOIN conversations c ON c.tenant_id = a.tenant_id AND c.contact_id = a.contact_id
       WHERE a.tenant_id = ? AND c.id = ? AND a.status = 'confirmed'
         AND a.created_at >= ?`,
      input.tenantId,
      input.conversationId,
      open?.openedAt ?? 0,
    )?.n,
  )

  for (const signal of signals) {
    const isFalse =
      signal === 'claimed_booked' ? !hasAppointment : !hasAppointment && signal === 'team_will_confirm'
    if (!isFalse) continue

    const now = clock.nowMs()
    emitOpsAlert({
      kind: 'conversation.false_confirmation',
      severity: 'critical',
      tenantId: input.tenantId,
      operation: 'conversation.false_confirmation',
      stage: signal,
      outcome: 'severe',
      fields: {
        conversationId: input.conversationId,
        messageId: input.messageId,
        sessionId,
      },
    })
    console.log(
      JSON.stringify({
        level: 'error',
        event: 'conversation.false_confirmation',
        tenantId: input.tenantId,
        conversationId: input.conversationId,
        messageId: input.messageId,
        signal,
        sessionId,
      }),
    )

    if (central) {
      await insertFalseConfirmation(central, {
        tenantId: input.tenantId,
        conversationId: input.conversationId,
        sessionId,
        messageId: input.messageId,
        signal,
        nowMs: now,
      })
    }

    if (open) {
      try {
        db.run(`UPDATE booking_sessions SET false_confirmation = 1 WHERE session_id = ?`, open.sessionId)
      } catch {
        /* migração 0071 ausente */
      }
    }
  }
}