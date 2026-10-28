import type { InboxMessage } from '../../api'

/**
 * Sugestão da IA só quando a cliente está à espera de resposta (Decidido, 28/10/2026):
 * a última mensagem relevante tem de ser da cliente. Mensagens de sistema e notas
 * internas não contam ao determinar a última.
 */
export function awaitingClinicReply(messages: readonly InboxMessage[]): boolean {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!
    if (m.direction === 'inbound') return true
    if (m.direction === 'outbound') return false
    // 'system' (inclui notas internas/eventos): ignorar.
  }
  return false
}
