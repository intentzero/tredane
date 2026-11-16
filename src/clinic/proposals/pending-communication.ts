/**
 * Comunicação pendente (H7 / #164 / DEC-061) — S4.
 * Cobre falha/atraso no envio determinístico da proposta ou do resultado,
 * e espera da equipe (legado `alter_awaiting_team`; Alterar detalhes já não abre isto — Paulo 09/11/2026).
 */
import type { Clock } from '../../db/clock'
import {
  PENDING_COMMUNICATION_ALERT_MS,
  type PendingCommunicationKind,
  type PendingCommunicationStatus,
} from '../constants'
import { newId } from '../ids'
import { assertClinicSchemaReady } from '../migrations'
import type { ClinicDb } from '../store'

export type PendingCommunicationRow = {
  id: string
  tenantId: string
  conversationId: string
  contactId: string
  proposalId: string | null
  kind: PendingCommunicationKind
  status: PendingCommunicationStatus
  startedAt: number
  alertAfterAt: number
  alertedAt: number | null
  resolvedAt: number | null
  outboundId: string | null
  messageId: string | null
  detailText: string
  createdAt: number
  updatedAt: number
}

type PendingSql = {
  id: string
  tenant_id: string
  conversation_id: string
  contact_id: string
  proposal_id: string | null
  kind: string
  status: string
  started_at: number
  alert_after_at: number
  alerted_at: number | null
  resolved_at: number | null
  outbound_id: string | null
  message_id: string | null
  detail_text: string
  created_at: number
  updated_at: number
}

function mapRow(row: PendingSql): PendingCommunicationRow {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    conversationId: row.conversation_id,
    contactId: row.contact_id,
    proposalId: row.proposal_id,
    kind: row.kind as PendingCommunicationKind,
    status: row.status as PendingCommunicationStatus,
    startedAt: row.started_at,
    alertAfterAt: row.alert_after_at,
    alertedAt: row.alerted_at,
    resolvedAt: row.resolved_at,
    outboundId: row.outbound_id,
    messageId: row.message_id,
    detailText: row.detail_text,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function getPendingCommunication(
  db: ClinicDb,
  tenantId: string,
  id: string,
): PendingCommunicationRow | null {
  assertClinicSchemaReady(db)
  const row = db.get<PendingSql>(
    `SELECT * FROM pending_communications WHERE tenant_id = ? AND id = ?`,
    tenantId,
    id,
  )
  return row ? mapRow(row) : null
}

/**
 * `proposal_send` pendente que já não tem nada a comunicar (bug 16/11/2026):
 * a proposta avançou (confirmada / substituída / expirada / recusada /
 * encaminhada), o Meta já aceitou ou entregou o envio, a cliente escreveu
 * ou tocou num botão depois do envio (excepto se o envio falhou de vez),
 * ou a conversa foi encerrada. Sem isto o cartão «Aguardando aceitação Meta
 * da proposta» ficava para sempre quando o resultado Meta chegava depois
 * do Confirmar (reconcile rebentava em confirmada→enviada e era engolido).
 *
 * Alias obrigatório: `p` = pending_communications.
 */
export const PROPOSAL_SEND_SUPERSEDED_SQL = `(
  p.kind = 'proposal_send' AND (
    EXISTS (
      SELECT 1 FROM appointment_proposals ap
      WHERE ap.tenant_id = p.tenant_id AND ap.id = p.proposal_id
        AND ap.state NOT IN ('preparada', 'envio_pendente', 'envio_incerto', 'enviada')
    )
    OR EXISTS (
      SELECT 1 FROM outbound_messages o
      WHERE o.tenant_id = p.tenant_id AND o.id = p.outbound_id
        AND o.delivery_state IN ('accepted', 'delivered', 'read')
    )
    OR (
      EXISTS (
        SELECT 1 FROM messages m
        WHERE m.tenant_id = p.tenant_id AND m.conversation_id = p.conversation_id
          AND m.direction = 'inbound' AND m.created_at > p.started_at
      )
      AND NOT EXISTS (
        SELECT 1 FROM outbound_messages o
        WHERE o.tenant_id = p.tenant_id AND o.id = p.outbound_id
          AND o.delivery_state = 'failed'
      )
    )
    OR EXISTS (
      SELECT 1 FROM conversations cv
      WHERE cv.tenant_id = p.tenant_id AND cv.id = p.conversation_id
        AND cv.status = 'closed'
    )
  )
)`

/**
 * Fecha os `proposal_send` ultrapassados (ver `PROPOSAL_SEND_SUPERSEDED_SQL`).
 * Devolve quantos resolveu. Sem `conversationId` corre no tenant inteiro (sweep).
 */
export function resolveSupersededProposalSendPendings(
  db: ClinicDb,
  tenantId: string,
  clock: Clock,
  conversationId?: string | null,
): number {
  assertClinicSchemaReady(db)
  const params: Array<string | number> = [tenantId]
  let scope = ''
  if (conversationId) {
    scope = 'AND p.conversation_id = ?'
    params.push(conversationId)
  }
  const ids = db
    .all<{ id: string }>(
      `SELECT p.id FROM pending_communications p
       WHERE p.tenant_id = ? ${scope} AND p.status IN ('open', 'alerted')
         AND ${PROPOSAL_SEND_SUPERSEDED_SQL}`,
      ...params,
    )
    .map((r) => r.id)
  for (const id of ids) resolvePendingCommunication(db, tenantId, id, clock)
  return ids.length
}

export function listOpenPendingCommunicationsForConversation(
  db: ClinicDb,
  tenantId: string,
  conversationId: string,
): PendingCommunicationRow[] {
  assertClinicSchemaReady(db)
  // Leitura pura: esconde já os ultrapassados (o sweep resolve-os na base).
  return db
    .all<PendingSql>(
      `SELECT p.* FROM pending_communications p
       WHERE p.tenant_id = ? AND p.conversation_id = ? AND p.status IN ('open', 'alerted')
         AND NOT ${PROPOSAL_SEND_SUPERSEDED_SQL}
       ORDER BY p.started_at ASC, p.id`,
      tenantId,
      conversationId,
    )
    .map(mapRow)
}

export function findOpenPendingByProposalKind(
  db: ClinicDb,
  tenantId: string,
  proposalId: string,
  kind: PendingCommunicationKind,
): PendingCommunicationRow | null {
  assertClinicSchemaReady(db)
  const row = db.get<PendingSql>(
    `SELECT * FROM pending_communications
     WHERE tenant_id = ? AND proposal_id = ? AND kind = ? AND status IN ('open', 'alerted')
     ORDER BY created_at DESC LIMIT 1`,
    tenantId,
    proposalId,
    kind,
  )
  return row ? mapRow(row) : null
}

export function openPendingCommunication(
  db: ClinicDb,
  input: {
    tenantId: string
    conversationId: string
    contactId: string
    proposalId?: string | null
    kind: PendingCommunicationKind
    outboundId?: string | null
    messageId?: string | null
    detailText?: string | null
  },
  clock: Clock,
): PendingCommunicationRow {
  assertClinicSchemaReady(db)
  const existing =
    input.proposalId != null
      ? findOpenPendingByProposalKind(db, input.tenantId, input.proposalId, input.kind)
      : null
  if (existing) {
    if (input.outboundId || input.messageId || input.detailText) {
      const now = clock.nowMs()
      db.run(
        `UPDATE pending_communications SET
           outbound_id = COALESCE(?, outbound_id),
           message_id = COALESCE(?, message_id),
           detail_text = CASE WHEN ? IS NOT NULL AND length(?) > 0 THEN ? ELSE detail_text END,
           updated_at = ?
         WHERE tenant_id = ? AND id = ?`,
        input.outboundId ?? null,
        input.messageId ?? null,
        input.detailText ?? null,
        input.detailText ?? null,
        input.detailText ?? '',
        now,
        input.tenantId,
        existing.id,
      )
      return getPendingCommunication(db, input.tenantId, existing.id)!
    }
    return existing
  }

  const id = newId('pcomm')
  const now = clock.nowMs()
  const alertAfterAt = now + PENDING_COMMUNICATION_ALERT_MS
  db.run(
    `INSERT INTO pending_communications (
      id, tenant_id, conversation_id, contact_id, proposal_id, kind, status,
      started_at, alert_after_at, alerted_at, resolved_at, outbound_id, message_id,
      detail_text, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'open', ?, ?, NULL, NULL, ?, ?, ?, ?, ?)`,
    id,
    input.tenantId,
    input.conversationId,
    input.contactId,
    input.proposalId ?? null,
    input.kind,
    now,
    alertAfterAt,
    input.outboundId ?? null,
    input.messageId ?? null,
    (input.detailText ?? '').trim(),
    now,
    now,
  )
  return getPendingCommunication(db, input.tenantId, id)!
}

export function resolvePendingCommunication(
  db: ClinicDb,
  tenantId: string,
  id: string,
  clock: Clock,
): PendingCommunicationRow | null {
  assertClinicSchemaReady(db)
  const current = getPendingCommunication(db, tenantId, id)
  if (!current) return null
  if (current.status === 'resolved') return current
  const now = clock.nowMs()
  db.run(
    `UPDATE pending_communications
     SET status = 'resolved', resolved_at = ?, updated_at = ?
     WHERE tenant_id = ? AND id = ?`,
    now,
    now,
    tenantId,
    id,
  )
  return getPendingCommunication(db, tenantId, id)
}

export function resolvePendingByProposalKind(
  db: ClinicDb,
  tenantId: string,
  proposalId: string,
  kind: PendingCommunicationKind,
  clock: Clock,
): void {
  const open = findOpenPendingByProposalKind(db, tenantId, proposalId, kind)
  if (open) resolvePendingCommunication(db, tenantId, open.id, clock)
}

/**
 * Marca como alerted os pendentes cujo prazo de 5 min já passou.
 * Devolve os que acabaram de alertar (para system message / painel).
 */
export function sweepPendingCommunicationAlerts(
  db: ClinicDb,
  tenantId: string,
  clock: Clock,
): PendingCommunicationRow[] {
  assertClinicSchemaReady(db)
  // Antes de alertar: proposta que já avançou não gera «Comunicação pendente».
  resolveSupersededProposalSendPendings(db, tenantId, clock)
  const now = clock.nowMs()
  const due = db.all<PendingSql>(
    `SELECT * FROM pending_communications
     WHERE tenant_id = ? AND status = 'open' AND alert_after_at <= ?
     ORDER BY alert_after_at ASC, id`,
    tenantId,
    now,
  )
  const out: PendingCommunicationRow[] = []
  for (const row of due) {
    db.run(
      `UPDATE pending_communications
       SET status = 'alerted', alerted_at = ?, updated_at = ?
       WHERE tenant_id = ? AND id = ? AND status = 'open'`,
      now,
      now,
      tenantId,
      row.id,
    )
    const fresh = getPendingCommunication(db, tenantId, row.id)
    if (fresh) out.push(fresh)
  }
  return out
}

export function listAlertedPendingCommunications(
  db: ClinicDb,
  tenantId: string,
): PendingCommunicationRow[] {
  assertClinicSchemaReady(db)
  return db
    .all<PendingSql>(
      `SELECT p.* FROM pending_communications p
       WHERE p.tenant_id = ? AND p.status = 'alerted'
         AND NOT ${PROPOSAL_SEND_SUPERSEDED_SQL}
       ORDER BY p.alerted_at DESC, p.id`,
      tenantId,
    )
    .map(mapRow)
}
