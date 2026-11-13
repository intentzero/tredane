/**
 * Após a cliente escolher Terminar (pós-agendamento, idle, preço):
 * cancela idle DEC-087 e timeout de handoff DEC-155, e a IA assume a conversa
 * (`system:ai-autodraft` via resumeAiReply).
 *
 * **Confirmado** (Paulo, 13/11/2026, America/Sao_Paulo): Terminar religa a IA
 * mesmo depois de Assumir — revê DEC-083 só neste caminho (Assumir sozinho
 * continua a deixar a IA pausada até Devolver à IA / DEC-155).
 */
import type { Clock } from '../../db/clock'
import { resumeAiReply } from '../ai/human-handoff'
import type { OutboxRow } from '../outbox'
import type { ClinicDb } from '../store'
import { clearConversationIdle } from './idle-state'

/**
 * Limpa timers automáticos e devolve a conversa à IA após fecho pela cliente.
 * Sem mensagem WhatsApp extra (o adeus Terminar já saiu).
 */
export function suppressFollowupsAfterClientEnd(
  db: ClinicDb,
  tenantId: string,
  conversationId: string,
  clock: Clock,
): OutboxRow[] {
  clearConversationIdle(db, tenantId, conversationId, clock.nowMs())
  return resumeAiReply(db, tenantId, conversationId, clock, {
    source: 'manual_resume',
  })
}
