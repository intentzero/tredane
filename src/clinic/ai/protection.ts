/**
 * Ponto de verificação único de proteção (épico #182) para qualquer ação nova automática
 * sobre uma conversa (S2, #173). Falha ou dúvida → nega.
 *
 * - Contato bloqueado: usa `contacts.blocked_at` (já existente).
 * - Conversa/contato em pausa: TODO(#182) — o estado ainda não existe no modelo de dados;
 *   `isConversationPaused` devolve hoje «não pausado» e é o único sítio a ligar quando existir.
 */
import type { ClinicDb } from '../store'

export type ProtectionVerdict =
  | { allowed: true }
  | { allowed: false; reason: 'contact_blocked' | 'conversation_paused' | 'not_found' | 'check_failed' }

/** TODO(#182): ler o estado de pausa da conversa/contato quando o épico de Proteção o definir. */
export function isConversationPaused(db: ClinicDb, tenantId: string, conversationId: string): boolean {
  void db
  void tenantId
  void conversationId
  return false
}

export function checkConversationProtection(
  db: ClinicDb,
  tenantId: string,
  conversationId: string,
): ProtectionVerdict {
  try {
    const row = db.get<{ blocked_at: number | null }>(
      `SELECT c.blocked_at FROM conversations v JOIN contacts c
         ON c.tenant_id = v.tenant_id AND c.id = v.contact_id
       WHERE v.tenant_id = ? AND v.id = ?`,
      tenantId,
      conversationId,
    )
    if (!row) return { allowed: false, reason: 'not_found' }
    if (row.blocked_at != null) return { allowed: false, reason: 'contact_blocked' }
    if (isConversationPaused(db, tenantId, conversationId)) return { allowed: false, reason: 'conversation_paused' }
    return { allowed: true }
  } catch {
    return { allowed: false, reason: 'check_failed' }
  }
}
