/**
 * Após a cliente escolher Terminar (pós-agendamento, idle, preço):
 * cancela idle DEC-087 e timeout de handoff DEC-155, para não enviar
 * «A equipe não conseguiu…» / «Ainda está aí?» depois do adeus.
 */
import type { Clock } from '../../db/clock'
import {
  clearHandoffTimeout,
  readAiReplyPause,
  resumeAiReply,
} from '../ai/human-handoff'
import type { OutboxRow } from '../outbox'
import type { ClinicDb } from '../store'
import { clearConversationIdle } from './idle-state'

/**
 * Limpa timers automáticos da conversa após fecho pela cliente.
 * Se a IA estava pausada (DEC-083), devolve-a sem mensagem WhatsApp
 * (o adeus Terminar já saiu) e resolve o alerta `alter_awaiting_team`.
 */
export function suppressFollowupsAfterClientEnd(
  db: ClinicDb,
  tenantId: string,
  conversationId: string,
  clock: Clock,
): OutboxRow[] {
  const now = clock.nowMs()
  clearConversationIdle(db, tenantId, conversationId, now)
  if (readAiReplyPause(db, tenantId, conversationId)) {
    return resumeAiReply(db, tenantId, conversationId, clock, {
      source: 'manual_resume',
    })
  }
  clearHandoffTimeout(db, tenantId, conversationId, now)
  return []
}
