/**
 * Pausa da IA e frase fixa quando a cliente pede uma pessoa ou sai do agendamento (DEC-083).
 * Não chama o modelo. Não marca horário. Uma mensagem já pausada não gera outra frase.
 */
import { detectInjectionSignals } from '../../ai'
import type { Clock } from '../../db/clock'
import { workerCaller } from '../envelopes'
import { ClinicError } from '../errors'
import { listResources } from '../config/resources'
import { listServices } from '../config/services'
import { sendOutboundMessageOp } from '../inbox/operations'
import { openPendingCommunication } from '../proposals/pending-communication'
import type { ClinicDb } from '../store'

export const HUMAN_HANDOFF_TEXT = 'Vou pedir para a equipe continuar daqui.'
export const HUMAN_HANDOFF_BUTTON_ID = 'handoff:human'
export const HUMAN_HANDOFF_BUTTON_TITLE = 'Falar com a equipe'

export type AiReplyPauseReason = 'customer_requested' | 'off_purpose' | 'human_only'

const WANTS_HUMAN =
  /\b(falar com (a )?(equipe|equipa|algu[eé]m|uma pessoa|atendente)|quero (uma )?pessoa|atendimento humano)\b/i
const HEALTH = /\b(gr[aá]vid|\bd[oó]i\b|\bmedicamento|\bcontraindica)/i
const OFFENSE = /\b(idiota|porra|merda|vsf|fdp)\b/i
const OFF_TOPIC = /\b(piada|esquece a cl[ií]nica)\b/i
const PIX = /\b(chave\s+pix|j[aá] paguei|pix copia)\b/i
const RESCHEDULE = /\b(remarca|remarcar|remarque|cancela|cancelar|desmarca|desmarcar)\b/i
const THIRD_PARTY = /\b(minha m[aã]e|meu pai|minha filha|meu filho|n[aã]o [eé] para mim|para a minha)\b/i

export function readAiReplyPause(
  db: ClinicDb,
  tenantId: string,
  conversationId: string,
): { at: number; reason: string } | null {
  const row = db.get<{ at: number | null; reason: string | null }>(
    `SELECT ai_reply_paused_at AS at, ai_reply_pause_reason AS reason
     FROM conversations WHERE tenant_id = ? AND id = ?`,
    tenantId,
    conversationId,
  )
  if (!row?.at) return null
  return { at: row.at, reason: row.reason ?? 'off_purpose' }
}

export function resumeAiReply(
  db: ClinicDb,
  tenantId: string,
  conversationId: string,
  clock: Clock,
): void {
  db.run(
    `UPDATE conversations SET ai_reply_paused_at = NULL, ai_reply_pause_reason = NULL, updated_at = ?
     WHERE tenant_id = ? AND id = ?`,
    clock.nowMs(),
    tenantId,
    conversationId,
  )
}

function professionalOutsideService(db: ClinicDb, tenantId: string, text: string, clock: Clock): boolean {
  const pros = listResources(db, tenantId, clock).filter((r) => r.kind === 'professional' && r.name.trim().length >= 2)
  const mentioned = pros.filter((p) => new RegExp(`\\b${p.name.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(text))
  if (mentioned.length === 0) return false
  const services = listServices(db, tenantId).filter((s) => s.active)
  const named = services.filter((s) => text.toLowerCase().includes(s.name.trim().toLowerCase()))
  const pool = named.length > 0 ? named : services
  return mentioned.some((p) => !pool.some((s) => s.professionalIds.includes(p.id)))
}

/** Motivo da pausa, ou null se a mensagem ainda é um pedido de agendamento. */
export function handoffReason(
  db: ClinicDb,
  tenantId: string,
  text: string,
  clock: Clock,
): AiReplyPauseReason | null {
  const body = text.trim()
  if (!body) return null
  if (WANTS_HUMAN.test(body)) return 'customer_requested'
  if (
    detectInjectionSignals(body) ||
    HEALTH.test(body) ||
    OFFENSE.test(body) ||
    OFF_TOPIC.test(body) ||
    PIX.test(body)
  ) {
    return 'off_purpose'
  }
  if (RESCHEDULE.test(body) || THIRD_PARTY.test(body) || professionalOutsideService(db, tenantId, body, clock)) {
    return 'human_only'
  }
  return null
}

/**
 * Pausa e, se ainda não estava pausada, envia uma frase e abre o alerta da equipe.
 * Falha de WhatsApp não desfaz a pausa: a equipe vê a comunicação pendente.
 */
export function notifyHumanHandoff(
  db: ClinicDb,
  tenantId: string,
  input: { conversationId: string; reason: AiReplyPauseReason; clientRequestId: string },
  clock: Clock,
): { already: boolean; sent: boolean } {
  const existing = readAiReplyPause(db, tenantId, input.conversationId)
  if (existing) return { already: true, sent: false }
  const now = clock.nowMs()
  db.run(
    `UPDATE conversations SET ai_reply_paused_at = ?, ai_reply_pause_reason = ?, updated_at = ?
     WHERE tenant_id = ? AND id = ?`,
    now,
    input.reason,
    now,
    tenantId,
    input.conversationId,
  )
  const conv = db.get<{ contact_id: string }>(
    `SELECT contact_id FROM conversations WHERE tenant_id = ? AND id = ?`,
    tenantId,
    input.conversationId,
  )
  if (!conv) return { already: false, sent: false }
  const open = db.get<{ id: string }>(
    `SELECT id FROM pending_communications
     WHERE tenant_id = ? AND conversation_id = ? AND kind = 'alter_awaiting_team' AND status != 'resolved'
     LIMIT 1`,
    tenantId,
    input.conversationId,
  )
  if (!open) {
    const detail =
      input.reason === 'customer_requested'
        ? 'A cliente pediu atendimento humano.'
        : input.reason === 'human_only'
          ? 'Pedido que a IA não cumpre (remarcar, cancelar, terceiro ou profissional fora do serviço). A equipe continua.'
          : 'A mensagem saiu do agendamento. A IA ficou pausada.'
    openPendingCommunication(
      db,
      {
        tenantId,
        conversationId: input.conversationId,
        contactId: conv.contact_id,
        proposalId: null,
        kind: 'alter_awaiting_team',
        detailText: detail,
      },
      clock,
    )
  }
  try {
    sendOutboundMessageOp(
      db,
      workerCaller(tenantId, 'system:ai-autodraft'),
      {
        conversationId: input.conversationId,
        body: HUMAN_HANDOFF_TEXT,
        clientRequestId: input.clientRequestId,
        authorClerkUserId: 'system:ai-autodraft',
        authorDisplayName: 'IA',
      },
      clock,
    )
    return { already: false, sent: true }
  } catch (err) {
    if (!(err instanceof ClinicError)) throw err
    return { already: false, sent: false }
  }
}
