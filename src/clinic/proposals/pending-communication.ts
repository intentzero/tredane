/**
 * Comunicação pendente (H7 / #164 / DEC-061) — S4.
 * Cobre falha/atraso no envio determinístico da proposta ou do resultado,
 * e espera da equipe após «Alterar detalhes».
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

export function listOpenPendingCommunicationsForConversation(
  db: ClinicDb,
  tenantId: string,
  conversationId: string,
): PendingCommunicationRow[] {
  assertClinicSchemaReady(db)
  return db
    .all<PendingSql>(
      `SELECT * FROM pending_communications
       WHERE tenant_id = ? AND conversation_id = ? AND status IN ('open', 'alerted')
       ORDER BY started_at ASC, id`,
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
      `SELECT * FROM pending_communications
       WHERE tenant_id = ? AND status = 'alerted'
       ORDER BY alerted_at DESC, id`,
      tenantId,
    )
    .map(mapRow)
}
