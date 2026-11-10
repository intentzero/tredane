/**
 * TR-487 — promessa de follow-up da equipe sem pausar a IA.
 * Paulo Confirmado 10/11/2026: alerta sem pausa (espelha Tempo / DEC-107).
 * Não chama `notifyHumanHandoff`. Copy DEC-125/129 permanece nos call-sites.
 */
import type { Clock } from '../../db/clock'
import { openPendingCommunication } from '../proposals/pending-communication'
import type { ClinicDb } from '../store'
import { readAiReplyPause } from './human-handoff'

/**
 * Texto à cliente que afirma acção/retorno da equipe (não só lacuna DEC-090
 * «confirma o valor / quem atende»).
 */
export function textPromisesTeamFollowUp(text: string): boolean {
  const folded = text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .trim()
  if (!folded || !/\bequipe\b/.test(folded)) return false
  // Honestidade de cadastro (DEC-090 / Informações) — sem «já te retorna».
  if (
    /\ba equipe confirma (o valor|quem atende)\b/.test(folded) ||
    /\bhorario de funcionamento:\s*a equipe confirma\b/.test(folded)
  ) {
    return false
  }
  if (
    /\b(ja\s+te\s+retorna|vai\s+te\s+responder|te\s+responde|em\s+seguida|vai\s+verificar|envia\s+outra\s+opcao|em\s+breve)\b/.test(
      folded,
    )
  ) {
    return true
  }
  // «a equipe confirma» genérico (redator de exceção) — sem qualificadores DEC-090.
  if (/\ba equipe confirma\b/.test(folded)) return true
  return false
}

/**
 * Abre ou reutiliza `alter_awaiting_team` em `alerted`. Não pausa a IA.
 * Idempotente por conversa enquanto o alerta seguir aberto.
 */
export function promiseTeamFollowUp(
  db: ClinicDb,
  tenantId: string,
  input: {
    conversationId: string
    detailText: string
    messageId?: string | null
  },
  clock: Clock,
): { opened: boolean; already: boolean; paused: boolean } {
  const paused = readAiReplyPause(db, tenantId, input.conversationId) != null
  const conv = db.get<{ contact_id: string }>(
    `SELECT contact_id FROM conversations WHERE tenant_id = ? AND id = ?`,
    tenantId,
    input.conversationId,
  )
  if (!conv) return { opened: false, already: false, paused }

  const open = db.get<{ id: string }>(
    `SELECT id FROM pending_communications
     WHERE tenant_id = ? AND conversation_id = ? AND kind = 'alter_awaiting_team' AND status != 'resolved'
     LIMIT 1`,
    tenantId,
    input.conversationId,
  )
  const now = clock.nowMs()
  const detail = input.detailText.trim() || 'A IA prometeu retorno da equipe. A conversa continua aberta à IA.'

  if (!open) {
    const row = openPendingCommunication(
      db,
      {
        tenantId,
        conversationId: input.conversationId,
        contactId: conv.contact_id,
        proposalId: null,
        kind: 'alter_awaiting_team',
        detailText: detail,
        messageId: input.messageId ?? null,
      },
      clock,
    )
    db.run(
      `UPDATE pending_communications
       SET status = 'alerted', alerted_at = COALESCE(alerted_at, ?), updated_at = ?
       WHERE tenant_id = ? AND id = ?`,
      now,
      now,
      tenantId,
      row.id,
    )
    return { opened: true, already: false, paused }
  }

  db.run(
    `UPDATE pending_communications
     SET status = 'alerted', alerted_at = COALESCE(alerted_at, ?), updated_at = ?,
         detail_text = CASE WHEN length(?) > 0 THEN ? ELSE detail_text END,
         message_id = COALESCE(message_id, ?)
     WHERE tenant_id = ? AND id = ?`,
    now,
    now,
    detail,
    detail,
    input.messageId ?? null,
    tenantId,
    open.id,
  )
  return { opened: false, already: true, paused }
}
