/**
 * Após a cliente escolher Terminar (pós-agendamento, idle, preço):
 * cancela idle DEC-087 e timeout de handoff DEC-155 (`ai_handoff_timeout_at` +
 * alerta `alter_awaiting_team` via resumeAiReply), e a IA assume a conversa
 * (`system:ai-autodraft`).
 *
 * Também marca `idle_suppressed_at` para inbound/outbound de small talk (ex.
 * «Gratidão!») não rearmarem o nudge DEC-087 enquanto a oportunidade ficar
 * em Agendado. Limpa com Marcar outro / nova sessão de marcação / Prosseguir.
 *
 * O alarme Durable Object do DEC-155 é cancelado/rearmado no fanout do
 * `conversation.ai_pause` (paused=false) em `clinic-do.ts` — esta helper só
 * mexe no SQLite da clínica.
 *
 * **Confirmado** (Paulo, 13/11/2026, America/Sao_Paulo): Terminar religa a IA
 * mesmo depois de Assumir — revê DEC-083 só neste caminho (Assumir sozinho
 * continua a deixar a IA pausada até Devolver à IA / DEC-155).
 * **Confirmado** (Paulo, 14/11/2026, America/Sao_Paulo): após Terminar o idle
 * não volta com agradecimento / small talk.
 */
import type { Clock } from '../../db/clock'
import { resumeAiReply } from '../ai/human-handoff'
import type { OutboxRow } from '../outbox'
import type { ClinicDb } from '../store'
import { clearConversationIdle, setIdleSuppressed } from './idle-state'

/**
 * Limpa timers automáticos e devolve a conversa à IA após fecho pela cliente.
 * Preferir chamar **antes** do adeus WhatsApp: o outbound do farewell não
 * rearma idle (suppress sticky). Sem mensagem WhatsApp extra aqui.
 */
export function suppressFollowupsAfterClientEnd(
  db: ClinicDb,
  tenantId: string,
  conversationId: string,
  clock: Clock,
): OutboxRow[] {
  const now = clock.nowMs()
  setIdleSuppressed(db, tenantId, conversationId, now)
  clearConversationIdle(db, tenantId, conversationId, now)
  return resumeAiReply(db, tenantId, conversationId, clock, {
    source: 'manual_resume',
  })
}
