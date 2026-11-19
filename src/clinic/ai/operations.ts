import type { Clock } from '../../db/clock'
import { assertValidCaller, type ClinicCaller } from '../envelopes'
import { NotFoundError } from '../errors'
import { assertClinicSchemaReady } from '../migrations'
import type { ClinicDb } from '../store'
import { bindOrAssertTenant } from '../tenant'
import { getSuggestion, updateSuggestionDecision } from './suggestions'
import type { AiSuggestionRow } from './types'

/**
 * Liga um envio humano já persistido a uma sugestão (histórico interno).
 * Não reenvia — só marca decisão. Chamado após sendOutbound com aiSuggestionId.
 */
export function attachSuggestionToOutboundOp(
  db: ClinicDb,
  caller: ClinicCaller,
  input: {
    suggestionId: string
    outboundMessageId: string
    messageId: string
    revisedText: string
    actorClerkUserId: string
    actorDisplayName: string
  },
  clock: Clock,
): AiSuggestionRow {
  assertClinicSchemaReady(db)
  assertValidCaller(caller)
  const meta = bindOrAssertTenant(db, caller, clock)
  const existing = getSuggestion(db, meta.tenantId, input.suggestionId)
  if (!existing) {
    throw new NotFoundError('suggestion_not_found', 'Sugestão não encontrada')
  }

  const edited =
    input.revisedText.trim() !== existing.suggestedText.trim()
  const now = clock.nowMs()

  db.run(
    `UPDATE outbound_messages SET
      ai_suggestion_id = ?,
      ai_origin_note = ?
     WHERE tenant_id = ? AND id = ?`,
    input.suggestionId,
    edited
      ? `Sugestão da IA, editada por ${input.actorDisplayName}`
      : `Sugestão da IA, usada por ${input.actorDisplayName}`,
    meta.tenantId,
    input.outboundMessageId,
  )

  return updateSuggestionDecision(db, {
    tenantId: meta.tenantId,
    suggestionId: input.suggestionId,
    status: edited ? 'edited' : 'used',
    decision: edited ? 'edit' : 'use',
    actorClerkUserId: input.actorClerkUserId,
    revisedText: input.revisedText,
    outboundMessageId: input.messageId,
    updatedAt: now,
  })
}
