/**
 * Botões Continuar | Terminar no ack de «avaliar» / «feedback» (TRE-29).
 * Reusa applyIdleClientAction: Continuar = retoma marcação; Terminar = DEC-086/087.
 */
import type { Clock } from '../../db/clock'
import { parseReviewFlagAckButtonId } from '../inbox/review-flag'
import { assertClinicSchemaReady } from '../migrations'
import type { OutboxRow } from '../outbox'
import type { ClinicDb } from '../store'
import { applyIdleClientAction } from './idle'
import type { IdleContinueChoiceResume } from './idle-continue-resume'

export type ReviewAckButtonResult =
  | { handled: false; reason: 'not_review_ack_button' }
  | {
      handled: true
      action: 'continue' | 'end'
      closedOpportunityId?: string | null
      outbox: OutboxRow[]
      resumeChoice?: IdleContinueChoiceResume
    }

export function handleReviewFlagAckButtonClick(
  db: ClinicDb,
  input: {
    tenantId: string
    conversationId: string
    buttonId: string
    providerEventKey?: string | null
  },
  clock: Clock,
): ReviewAckButtonResult {
  assertClinicSchemaReady(db)
  const parsed = parseReviewFlagAckButtonId(input.buttonId)
  if (!parsed || parsed.conversationId !== input.conversationId) {
    return { handled: false, reason: 'not_review_ack_button' }
  }
  return applyIdleClientAction(
    db,
    {
      tenantId: input.tenantId,
      conversationId: input.conversationId,
      action: parsed.action,
      via: 'button',
      providerEventKey: input.providerEventKey,
    },
    clock,
  )
}
