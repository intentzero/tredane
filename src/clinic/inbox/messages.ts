import type { Clock } from '../../db/clock'
import type { MessageDeliveryState, MessageDirection } from '../constants'
import { ConflictError } from '../errors'
import { newId } from '../ids'
import { assertClinicSchemaReady } from '../migrations'
import type { ClinicDb } from '../store'
import { mapMessage } from './rows'
import type { ListMessagesInput, MessageRow } from './types'

type MsgSqlRow = {
  id: string
  tenant_id: string
  conversation_id: string
  direction: string
  body: string
  external_message_id: string | null
  delivery_state: string
  author_clerk_user_id: string | null
  author_display_name: string | null
  created_at: number
}

export function insertMessage(
  db: ClinicDb,
  input: {
    tenantId: string
    conversationId: string
    direction: MessageDirection
    body: string
    externalMessageId?: string | null
    deliveryState: MessageDeliveryState
    authorClerkUserId?: string | null
    authorDisplayName?: string | null
    id?: string
    createdAt?: number
  },
  clock: Clock,
): MessageRow {
  assertClinicSchemaReady(db)

  if (input.externalMessageId) {
    const existing = db.get<MsgSqlRow>(
      `SELECT * FROM messages
       WHERE tenant_id = ? AND external_message_id = ?`,
      input.tenantId,
      input.externalMessageId,
    )
    if (existing) {
      throw new ConflictError(
        'message_duplicate',
        'Mensagem com este identificador externo já existe nesta clínica',
      )
    }
  }

  const id = input.id ?? newId('msg')
  const createdAt = input.createdAt ?? clock.nowMs()
  db.run(
    `INSERT INTO messages (
      id, tenant_id, conversation_id, direction, body,
      external_message_id, delivery_state,
      author_clerk_user_id, author_display_name, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    input.tenantId,
    input.conversationId,
    input.direction,
    input.body,
    input.externalMessageId ?? null,
    input.deliveryState,
    input.authorClerkUserId ?? null,
    input.authorDisplayName ?? null,
    createdAt,
  )
  return {
    id,
    tenantId: input.tenantId,
    conversationId: input.conversationId,
    direction: input.direction,
    body: input.body,
    externalMessageId: input.externalMessageId ?? null,
    deliveryState: input.deliveryState,
    authorClerkUserId: input.authorClerkUserId ?? null,
    authorDisplayName: input.authorDisplayName ?? null,
    createdAt,
  }
}

/**
 * Histórico paginado: página mais recente primeiro na query, devolve ordem cronológica.
 * `before` = created_at exclusivo para páginas mais antigas.
 */
export function listMessages(
  db: ClinicDb,
  tenantId: string,
  input: ListMessagesInput,
): { messages: MessageRow[]; hasMore: boolean; nextBefore: number | null } {
  assertClinicSchemaReady(db)
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 200)
  const beforeSql = input.before != null ? `AND created_at < ?` : ''
  const beforeParams = input.before != null ? [input.before] : []

  const rows = db.all<MsgSqlRow>(
    `SELECT * FROM messages
     WHERE tenant_id = ? AND conversation_id = ?
       ${beforeSql}
     ORDER BY created_at DESC
     LIMIT ?`,
    tenantId,
    input.conversationId,
    ...beforeParams,
    limit + 1,
  )

  const page = rows.slice(0, limit)
  const hasMore = rows.length > limit
  const nextBefore = hasMore && page.length > 0 ? page[page.length - 1]!.created_at : null
  // Ordem cronológica para a UI
  const messages = page.reverse().map(mapMessage)
  return { messages, hasMore, nextBefore }
}

export function findMessageByExternalId(
  db: ClinicDb,
  tenantId: string,
  externalMessageId: string,
): MessageRow | undefined {
  assertClinicSchemaReady(db)
  const row = db.get<MsgSqlRow>(
    `SELECT * FROM messages WHERE tenant_id = ? AND external_message_id = ?`,
    tenantId,
    externalMessageId,
  )
  return row ? mapMessage(row) : undefined
}
