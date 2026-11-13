/**
 * DEC-173 — conversa com atendente activo: Assumir (humano) ou handoff (IA pausada).
 */
import { readAiReplyPause } from '../clinic/ai/human-handoff'
import { isHumanStaffAuthor } from '../clinic/inbox/human-prefix'
import type { ClinicDb } from '../clinic/store'

export function isHumanAttendedConversation(
  db: ClinicDb,
  tenantId: string,
  conversationId: string,
  assigneeClerkUserId?: string | null,
): boolean {
  if (isHumanStaffAuthor(assigneeClerkUserId)) return true
  return readAiReplyPause(db, tenantId, conversationId) != null
}
