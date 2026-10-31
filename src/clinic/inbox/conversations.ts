import type { Clock } from '../../db/clock'
import type { ConversationStatus, InboxFilter, MessageDirection } from '../constants'
import { NotFoundError } from '../errors'
import { newId } from '../ids'
import { assertClinicSchemaReady } from '../migrations'
import type { ClinicDb } from '../store'
import { mapContactSummary, mapConversation, previewBody } from './rows'
import type {
  ContactSummary,
  ConversationListItem,
  ConversationRow,
  InboxCounts,
  ListConversationsInput,
} from './types'

const NEEDS_PERSON_SQL = `(
  c.ai_reply_paused_at IS NOT NULL
  OR EXISTS (
    SELECT 1 FROM pending_communications p
    WHERE p.tenant_id = c.tenant_id AND p.conversation_id = c.id
      AND p.kind = 'alter_awaiting_team' AND p.status IN ('open', 'alerted')
  )
)`

/** Job de rascunho automático ainda vivo (debounce ou a gerar). */
const AI_DRAFTING_SQL = `EXISTS (
  SELECT 1 FROM ai_autodraft_jobs j
  WHERE j.tenant_id = c.tenant_id AND j.conversation_id = c.id
)`

const CONV_COLS = `c.id, c.tenant_id, c.contact_id, c.status,
  c.assignee_clerk_user_id, c.assignee_display_name, c.assignment_version,
  c.last_message_at, c.last_message_preview, c.last_message_direction,
  c.unread_count, c.created_at, c.updated_at`

type ConvSqlRow = {
  id: string
  tenant_id: string
  contact_id: string
  status: string
  assignee_clerk_user_id: string | null
  assignee_display_name: string | null
  assignment_version: number
  last_message_at: number | null
  last_message_preview: string | null
  last_message_direction: string | null
  unread_count: number
  created_at: number
  updated_at: number
  contact_wa_id?: string
  contact_display_name?: string | null
  contact_created_at?: number
}

export function getConversation(
  db: ClinicDb,
  tenantId: string,
  conversationId: string,
): ConversationRow | undefined {
  assertClinicSchemaReady(db)
  const row = db.get<ConvSqlRow>(
    `SELECT ${CONV_COLS} FROM conversations c
     WHERE c.tenant_id = ? AND c.id = ?`,
    tenantId,
    conversationId,
  )
  return row ? mapConversation(row) : undefined
}

export function requireConversation(
  db: ClinicDb,
  tenantId: string,
  conversationId: string,
): ConversationRow {
  const row = getConversation(db, tenantId, conversationId)
  if (!row) {
    throw new NotFoundError('conversation_not_found', 'Conversa não encontrada nesta clínica')
  }
  return row
}

/**
 * Hipótese Proposta (#29): uma conversa por contacto.
 * Preferência: conversa não encerrada; senão a mais recente (para reabrir).
 */
export function findConversationForContact(
  db: ClinicDb,
  tenantId: string,
  contactId: string,
): ConversationRow | undefined {
  assertClinicSchemaReady(db)
  const open = db.get<ConvSqlRow>(
    `SELECT ${CONV_COLS} FROM conversations c
     WHERE c.tenant_id = ? AND c.contact_id = ? AND c.status != 'closed'
     ORDER BY c.updated_at DESC LIMIT 1`,
    tenantId,
    contactId,
  )
  if (open) return mapConversation(open)
  const any = db.get<ConvSqlRow>(
    `SELECT ${CONV_COLS} FROM conversations c
     WHERE c.tenant_id = ? AND c.contact_id = ?
     ORDER BY c.updated_at DESC LIMIT 1`,
    tenantId,
    contactId,
  )
  return any ? mapConversation(any) : undefined
}

export function createConversation(
  db: ClinicDb,
  input: {
    tenantId: string
    contactId: string
    status?: ConversationStatus
    id?: string
  },
  clock: Clock,
): ConversationRow {
  assertClinicSchemaReady(db)
  const id = input.id ?? newId('cnv')
  const now = clock.nowMs()
  const status = input.status ?? 'new'
  db.run(
    `INSERT INTO conversations (
      id, tenant_id, contact_id, status,
      assignee_clerk_user_id, assignee_display_name, assignment_version,
      last_message_at, last_message_preview, last_message_direction,
      unread_count, created_at, updated_at
    ) VALUES (?, ?, ?, ?, NULL, NULL, 0, NULL, NULL, NULL, 0, ?, ?)`,
    id,
    input.tenantId,
    input.contactId,
    status,
    now,
    now,
  )
  return requireConversation(db, input.tenantId, id)
}

export function touchConversationMessage(
  db: ClinicDb,
  input: {
    tenantId: string
    conversationId: string
    preview: string
    direction: MessageDirection
    at: number
    /** Incrementa não lidas só para inbound. */
    bumpUnread: boolean
    /** Reabre se encerrada (hipótese). */
    reopenIfClosed: boolean
  },
): ConversationRow {
  const current = requireConversation(db, input.tenantId, input.conversationId)
  let status = current.status
  if (input.reopenIfClosed && status === 'closed') {
    status = current.assigneeClerkUserId ? 'open' : 'new'
  }
  const unread = input.bumpUnread ? current.unreadCount + 1 : current.unreadCount
  db.run(
    `UPDATE conversations SET
      status = ?,
      last_message_at = ?,
      last_message_preview = ?,
      last_message_direction = ?,
      unread_count = ?,
      updated_at = ?
     WHERE tenant_id = ? AND id = ?`,
    status,
    input.at,
    previewBody(input.preview),
    input.direction,
    unread,
    input.at,
    input.tenantId,
    input.conversationId,
  )
  return requireConversation(db, input.tenantId, input.conversationId)
}

export function setConversationAssignee(
  db: ClinicDb,
  input: {
    tenantId: string
    conversationId: string
    assigneeClerkUserId: string | null
    assigneeDisplayName: string | null
    updatedAt: number
  },
): ConversationRow {
  const current = requireConversation(db, input.tenantId, input.conversationId)
  const nextStatus: ConversationStatus =
    current.status === 'closed'
      ? 'closed'
      : input.assigneeClerkUserId
        ? 'open'
        : 'new'
  db.run(
    `UPDATE conversations SET
      assignee_clerk_user_id = ?,
      assignee_display_name = ?,
      assignment_version = assignment_version + 1,
      status = ?,
      updated_at = ?
     WHERE tenant_id = ? AND id = ?`,
    input.assigneeClerkUserId,
    input.assigneeDisplayName,
    nextStatus,
    input.updatedAt,
    input.tenantId,
    input.conversationId,
  )
  return requireConversation(db, input.tenantId, input.conversationId)
}

export function setConversationStatus(
  db: ClinicDb,
  input: {
    tenantId: string
    conversationId: string
    status: ConversationStatus
    updatedAt: number
  },
): ConversationRow {
  requireConversation(db, input.tenantId, input.conversationId)
  db.run(
    `UPDATE conversations SET status = ?, updated_at = ?
     WHERE tenant_id = ? AND id = ?`,
    input.status,
    input.updatedAt,
    input.tenantId,
    input.conversationId,
  )
  return requireConversation(db, input.tenantId, input.conversationId)
}

export function clearConversationUnread(
  db: ClinicDb,
  tenantId: string,
  conversationId: string,
  updatedAt: number,
): ConversationRow {
  requireConversation(db, tenantId, conversationId)
  db.run(
    `UPDATE conversations SET unread_count = 0, updated_at = ?
     WHERE tenant_id = ? AND id = ?`,
    updatedAt,
    tenantId,
    conversationId,
  )
  return requireConversation(db, tenantId, conversationId)
}

function filterClause(
  filter: InboxFilter | undefined,
  viewerClerkUserId: string | undefined,
): { sql: string; params: Array<string | number> } {
  switch (filter ?? 'all') {
    case 'new':
      return { sql: `AND c.status = 'new'`, params: [] }
    case 'mine':
      if (!viewerClerkUserId) {
        return { sql: `AND 1 = 0`, params: [] }
      }
      return {
        sql: `AND c.assignee_clerk_user_id = ? AND c.status != 'closed'`,
        params: [viewerClerkUserId],
      }
    case 'unassigned':
      return {
        sql: `AND c.assignee_clerk_user_id IS NULL AND c.status != 'closed'`,
        params: [],
      }
    case 'needs_person':
      return {
        sql: `AND ${NEEDS_PERSON_SQL} AND c.status != 'closed'`,
        params: [],
      }
    case 'closed':
      return { sql: `AND c.status = 'closed'`, params: [] }
    case 'all':
    default:
      return { sql: '', params: [] }
  }
}

export function listConversations(
  db: ClinicDb,
  tenantId: string,
  input: ListConversationsInput = {},
): { items: ConversationListItem[]; nextBefore: number | null } {
  assertClinicSchemaReady(db)
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 100)
  const { sql: filterSql, params: filterParams } = filterClause(
    input.filter,
    input.viewerClerkUserId,
  )
  const q = input.q?.trim()
  const searchSql = q
    ? `AND (
        IFNULL(ct.display_name, '') LIKE ? OR
        ct.wa_id LIKE ? OR
        IFNULL(c.last_message_preview, '') LIKE ?
      )`
    : ''
  const searchParams = q ? [`%${q}%`, `%${q}%`, `%${q}%`] : []
  const beforeSql =
    input.before != null ? `AND c.last_message_at IS NOT NULL AND c.last_message_at < ?` : ''
  const beforeParams = input.before != null ? [input.before] : []

  const rows = db.all<
    ConvSqlRow & {
      contact_wa_id: string
      contact_display_name: string | null
      contact_created_at: number
      contact_blocked_at: number | null
      contact_blocked_by: string | null
      contact_blocked_reason: string | null
      needs_person: number
      ai_drafting: number
    }
  >(
    `SELECT ${CONV_COLS},
       CASE WHEN ${NEEDS_PERSON_SQL} THEN 1 ELSE 0 END AS needs_person,
       CASE WHEN ${AI_DRAFTING_SQL} THEN 1 ELSE 0 END AS ai_drafting,
       ct.wa_id AS contact_wa_id,
       ct.display_name AS contact_display_name,
       ct.created_at AS contact_created_at,
       ct.blocked_at AS contact_blocked_at,
       ct.blocked_by_display_name AS contact_blocked_by,
       ct.blocked_reason AS contact_blocked_reason
     FROM conversations c
     INNER JOIN contacts ct
       ON ct.tenant_id = c.tenant_id AND ct.id = c.contact_id
     WHERE c.tenant_id = ?
       ${filterSql}
       ${searchSql}
       ${beforeSql}
     ORDER BY
       CASE WHEN c.last_message_at IS NULL THEN 1 ELSE 0 END,
       c.last_message_at DESC,
       c.updated_at DESC
     LIMIT ?`,
    tenantId,
    ...filterParams,
    ...searchParams,
    ...beforeParams,
    limit + 1,
  )

  const page = rows.slice(0, limit)
  const items: ConversationListItem[] = page.map((row) => ({
    ...mapConversation(row),
    contact: mapContactSummary({
      id: row.contact_id,
      wa_id: row.contact_wa_id,
      display_name: row.contact_display_name,
      created_at: row.contact_created_at,
      blocked_at: row.contact_blocked_at,
      blocked_by_display_name: row.contact_blocked_by,
      blocked_reason: row.contact_blocked_reason,
    }),
    needsPerson: row.needs_person === 1,
    aiDrafting: row.ai_drafting === 1,
  }))
  const nextBefore =
    rows.length > limit && page.length > 0
      ? (page[page.length - 1]!.last_message_at ?? page[page.length - 1]!.updated_at)
      : null
  return { items, nextBefore }
}

export function countInboxFilters(
  db: ClinicDb,
  tenantId: string,
  viewerClerkUserId: string | undefined,
): InboxCounts {
  assertClinicSchemaReady(db)
  const all = db.get<{ n: number }>(
    `SELECT COUNT(*) AS n FROM conversations WHERE tenant_id = ?`,
    tenantId,
  )?.n ?? 0
  const neu = db.get<{ n: number }>(
    `SELECT COUNT(*) AS n FROM conversations WHERE tenant_id = ? AND status = 'new'`,
    tenantId,
  )?.n ?? 0
  const mine = viewerClerkUserId
    ? db.get<{ n: number }>(
        `SELECT COUNT(*) AS n FROM conversations
         WHERE tenant_id = ? AND assignee_clerk_user_id = ? AND status != 'closed'`,
        tenantId,
        viewerClerkUserId,
      )?.n ?? 0
    : 0
  const unassigned = db.get<{ n: number }>(
    `SELECT COUNT(*) AS n FROM conversations
     WHERE tenant_id = ? AND assignee_clerk_user_id IS NULL AND status != 'closed'`,
    tenantId,
  )?.n ?? 0
  const closed = db.get<{ n: number }>(
    `SELECT COUNT(*) AS n FROM conversations WHERE tenant_id = ? AND status = 'closed'`,
    tenantId,
  )?.n ?? 0
  const needsPerson = db.get<{ n: number }>(
    `SELECT COUNT(*) AS n FROM conversations c
     WHERE c.tenant_id = ? AND c.status != 'closed' AND ${NEEDS_PERSON_SQL}`,
    tenantId,
  )?.n ?? 0
  return {
    all,
    new: neu,
    mine,
    unassigned,
    closed,
    unread: countUnreadConversations(db, tenantId),
    needsPerson,
  }
}

/** Nº de conversas com não lidas — badge do ícone (sem conteúdo). */
export function countUnreadConversations(db: ClinicDb, tenantId: string): number {
  return (
    db.get<{ n: number }>(
      `SELECT COUNT(*) AS n FROM conversations WHERE tenant_id = ? AND unread_count > 0`,
      tenantId,
    )?.n ?? 0
  )
}

export function getConversationWithContact(
  db: ClinicDb,
  tenantId: string,
  conversationId: string,
): ConversationListItem | undefined {
  assertClinicSchemaReady(db)
  const row = db.get<
    ConvSqlRow & {
      contact_wa_id: string
      contact_display_name: string | null
      contact_created_at: number
      contact_blocked_at: number | null
      contact_blocked_by: string | null
      contact_blocked_reason: string | null
      needs_person: number
      ai_drafting: number
    }
  >(
    `SELECT ${CONV_COLS},
       CASE WHEN ${NEEDS_PERSON_SQL} THEN 1 ELSE 0 END AS needs_person,
       CASE WHEN ${AI_DRAFTING_SQL} THEN 1 ELSE 0 END AS ai_drafting,
       ct.wa_id AS contact_wa_id,
       ct.display_name AS contact_display_name,
       ct.created_at AS contact_created_at,
       ct.blocked_at AS contact_blocked_at,
       ct.blocked_by_display_name AS contact_blocked_by,
       ct.blocked_reason AS contact_blocked_reason
     FROM conversations c
     INNER JOIN contacts ct
       ON ct.tenant_id = c.tenant_id AND ct.id = c.contact_id
     WHERE c.tenant_id = ? AND c.id = ?`,
    tenantId,
    conversationId,
  )
  if (!row) return undefined
  return {
    ...mapConversation(row),
    contact: mapContactSummary({
      id: row.contact_id,
      wa_id: row.contact_wa_id,
      display_name: row.contact_display_name,
      created_at: row.contact_created_at,
      blocked_at: row.contact_blocked_at,
      blocked_by_display_name: row.contact_blocked_by,
      blocked_reason: row.contact_blocked_reason,
    }),
    needsPerson: row.needs_person === 1,
    aiDrafting: row.ai_drafting === 1,
  }
}

export function loadContactSummary(
  db: ClinicDb,
  tenantId: string,
  contactId: string,
): ContactSummary | undefined {
  assertClinicSchemaReady(db)
  const row = db.get<{
    id: string
    wa_id: string
    display_name: string | null
    created_at: number
    blocked_at: number | null
    blocked_by_display_name: string | null
    blocked_reason: string | null
  }>(
    `SELECT id, wa_id, display_name, created_at, blocked_at, blocked_by_display_name, blocked_reason
     FROM contacts
     WHERE tenant_id = ? AND id = ?`,
    tenantId,
    contactId,
  )
  return row ? mapContactSummary(row) : undefined
}

export type ContactDirectoryFilter = 'all' | 'blocked' | 'with_appointment'

/**
 * Directório Clientes (fase 1): lista + busca por nome/telefone; filtros bloqueadas / com horário.
 * Ordenação alfabética por nome (ou wa_id). Sem sexo / campos clínicos.
 */
export function listContactsDirectory(
  db: ClinicDb,
  tenantId: string,
  input: {
    q?: string | null
    filter?: ContactDirectoryFilter
    limit?: number
    nowMs: number
  },
): { items: ContactSummary[]; nextBefore: null } {
  assertClinicSchemaReady(db)
  const limit = Math.min(Math.max(input.limit ?? 100, 1), 100)
  const q = input.q?.trim()
  const filter = input.filter ?? 'all'
  const searchSql = q
    ? `AND (
        IFNULL(ct.display_name, '') LIKE ? OR
        ct.wa_id LIKE ?
      )`
    : ''
  const searchParams = q ? [`%${q}%`, `%${q}%`] : []

  let filterSql = ''
  const filterParams: unknown[] = []
  if (filter === 'blocked') {
    filterSql = `AND ct.blocked_at IS NOT NULL`
  } else if (filter === 'with_appointment') {
    filterSql = `AND EXISTS (
      SELECT 1 FROM appointments a
      WHERE a.tenant_id = ct.tenant_id
        AND a.contact_id = ct.id
        AND a.status = 'confirmed'
        AND a.starts_at > ?
    )`
    filterParams.push(input.nowMs)
  }

  const rows = db.all<{
    id: string
    wa_id: string
    display_name: string | null
    created_at: number
    blocked_at: number | null
    blocked_by_display_name: string | null
    blocked_reason: string | null
  }>(
    `SELECT ct.id, ct.wa_id, ct.display_name, ct.created_at,
            ct.blocked_at, ct.blocked_by_display_name, ct.blocked_reason
     FROM contacts ct
     WHERE ct.tenant_id = ?
       ${searchSql}
       ${filterSql}
     ORDER BY LOWER(IFNULL(ct.display_name, ct.wa_id)), ct.id
     LIMIT ?`,
    tenantId,
    ...searchParams,
    ...filterParams,
    limit,
  )

  return {
    items: rows.map((row) => mapContactSummary(row)),
    nextBefore: null,
  }
}
