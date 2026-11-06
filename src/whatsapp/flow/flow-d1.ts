/**
 * Operações D1 async para Flow tokens (#514 / Finding 2).
 * Espelha `webhook-d1.ts`: produção usa `env.DB` sem AdminDb síncrono.
 */
import type { Clock } from '../../db/clock'
import { ADMIN_SCHEMA_VERSION } from '../../db/admin/constants'
import type { FlowBookingSnapshot } from './screens'
import {
  EMPTY_FLOW_SESSION,
  FLOW_TOKEN_TTL_MS,
  parseFlowSessionJson,
  serializeFlowSession,
  type FlowTokenRow,
} from './tokens'

type SqlRow = {
  token: string
  tenant_id: string
  binding_id: string
  phone_number_id: string
  waba_id: string
  conversation_id: string
  catalog_version: string
  created_at: number
  expires_at: number
  replaced_by: string | null
  consumed_at: number | null
  session_json: string | null
}

function mapRow(row: SqlRow): FlowTokenRow {
  return {
    token: row.token,
    tenantId: row.tenant_id,
    bindingId: row.binding_id,
    phoneNumberId: row.phone_number_id,
    wabaId: row.waba_id,
    conversationId: row.conversation_id,
    catalogVersion: row.catalog_version,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    replacedBy: row.replaced_by,
    consumedAt: row.consumed_at,
    session: parseFlowSessionJson(row.session_json),
  }
}

async function assertSchema(db: D1Database): Promise<void> {
  const row = await db
    .prepare('SELECT version FROM admin_schema_state WHERE id = 1')
    .first<{ version: number }>()
  if (!row || row.version !== ADMIN_SCHEMA_VERSION) {
    throw new Error(
      `admin schema ${row?.version ?? 'ausente'}; esperada ${ADMIN_SCHEMA_VERSION}`,
    )
  }
}

export type D1FlowOps = {
  getToken(token: string): Promise<FlowTokenRow | null>
  saveSession(token: string, session: FlowBookingSnapshot): Promise<void>
  insertToken(input: {
    token: string
    tenantId: string
    bindingId: string
    phoneNumberId: string
    wabaId: string
    conversationId: string
    catalogVersion: string
    session?: FlowBookingSnapshot
  }): Promise<FlowTokenRow>
  consumeToken(token: string): Promise<void>
}

export function createD1FlowOps(db: D1Database, clock: Clock): D1FlowOps {
  return {
    async getToken(token) {
      await assertSchema(db)
      const row = await db
        .prepare(`SELECT * FROM whatsapp_flow_tokens WHERE token = ? LIMIT 1`)
        .bind(token)
        .first<SqlRow>()
      return row ? mapRow(row) : null
    },

    async saveSession(token, session) {
      await assertSchema(db)
      await db
        .prepare(
          // DEC-143: a primeira chamada do endpoint marca a abertura do Flow.
          `UPDATE whatsapp_flow_tokens
           SET session_json = ?, opened_at = COALESCE(opened_at, ?)
           WHERE token = ?`,
        )
        .bind(serializeFlowSession(session), clock.nowMs(), token)
        .run()
    },

    async insertToken(input) {
      await assertSchema(db)
      const now = clock.nowMs()
      const expiresAt = now + FLOW_TOKEN_TTL_MS
      const session = input.session ?? { ...EMPTY_FLOW_SESSION }
      await db
        .prepare(
          `UPDATE whatsapp_flow_tokens
           SET replaced_by = ?, consumed_at = COALESCE(consumed_at, ?)
           WHERE conversation_id = ? AND replaced_by IS NULL AND consumed_at IS NULL`,
        )
        .bind(input.token, now, input.conversationId)
        .run()
      await db
        .prepare(
          `INSERT INTO whatsapp_flow_tokens (
            token, tenant_id, binding_id, phone_number_id, waba_id,
            conversation_id, catalog_version, created_at, expires_at, replaced_by, consumed_at,
            session_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?)`,
        )
        .bind(
          input.token,
          input.tenantId,
          input.bindingId,
          input.phoneNumberId,
          input.wabaId,
          input.conversationId,
          input.catalogVersion,
          now,
          expiresAt,
          serializeFlowSession(session),
        )
        .run()
      return {
        token: input.token,
        tenantId: input.tenantId,
        bindingId: input.bindingId,
        phoneNumberId: input.phoneNumberId,
        wabaId: input.wabaId,
        conversationId: input.conversationId,
        catalogVersion: input.catalogVersion,
        createdAt: now,
        expiresAt,
        replacedBy: null,
        consumedAt: null,
        session,
      }
    },

    async consumeToken(token) {
      await assertSchema(db)
      await db
        .prepare(
          `UPDATE whatsapp_flow_tokens
           SET consumed_at = ?
           WHERE token = ? AND consumed_at IS NULL`,
        )
        .bind(clock.nowMs(), token)
        .run()
    },
  }
}
