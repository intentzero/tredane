/**
 * Sessão do Flow: `flow_token` opaco no D1 central (ADR-0016 §5).
 * Não leva tenant_id em claro no token; o Worker resolve pela linha.
 */
import type { Clock } from '../../db/clock'
import { assertAdminSchemaReady } from '../../db/admin/gate'
import type { AdminDb } from '../../db/admin/store'

/** Mesmo horizonte da oferta DEC-127 / ADR-0016: 24 h. */
export const FLOW_TOKEN_TTL_MS = 24 * 60 * 60 * 1000

export type FlowTokenRow = {
  token: string
  tenantId: string
  bindingId: string
  phoneNumberId: string
  wabaId: string
  conversationId: string
  catalogVersion: string
  createdAt: number
  expiresAt: number
  replacedBy: string | null
  consumedAt: number | null
}

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
  }
}

/** Token opaco imprevisível (não embute tenant). */
export function generateFlowToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  let out = ''
  for (const b of bytes) out += b.toString(16).padStart(2, '0')
  return `fl1_${out}`
}

export function insertFlowToken(
  db: AdminDb,
  input: {
    token: string
    tenantId: string
    bindingId: string
    phoneNumberId: string
    wabaId: string
    conversationId: string
    catalogVersion: string
  },
  clock: Clock,
): FlowTokenRow {
  assertAdminSchemaReady(db)
  const now = clock.nowMs()
  const expiresAt = now + FLOW_TOKEN_TTL_MS
  // Substitui tokens activos da mesma conversa.
  db.run(
    `UPDATE whatsapp_flow_tokens
     SET replaced_by = ?, consumed_at = COALESCE(consumed_at, ?)
     WHERE conversation_id = ? AND replaced_by IS NULL AND consumed_at IS NULL`,
    input.token,
    now,
    input.conversationId,
  )
  db.run(
    `INSERT INTO whatsapp_flow_tokens (
      token, tenant_id, binding_id, phone_number_id, waba_id,
      conversation_id, catalog_version, created_at, expires_at, replaced_by, consumed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)`,
    input.token,
    input.tenantId,
    input.bindingId,
    input.phoneNumberId,
    input.wabaId,
    input.conversationId,
    input.catalogVersion,
    now,
    expiresAt,
  )
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
  }
}

export function getFlowToken(db: AdminDb, token: string): FlowTokenRow | null {
  assertAdminSchemaReady(db)
  const row = db.get<SqlRow>(
    `SELECT * FROM whatsapp_flow_tokens WHERE token = ?`,
    token,
  )
  return row ? mapRow(row) : null
}

export function isFlowTokenUsable(row: FlowTokenRow, nowMs: number): boolean {
  if (row.replacedBy) return false
  if (row.consumedAt != null) return false
  if (row.expiresAt <= nowMs) return false
  return true
}

export function consumeFlowToken(db: AdminDb, token: string, clock: Clock): void {
  assertAdminSchemaReady(db)
  db.run(
    `UPDATE whatsapp_flow_tokens
     SET consumed_at = ?
     WHERE token = ? AND consumed_at IS NULL`,
    clock.nowMs(),
    token,
  )
}

/** Store em memória para testes L1 (sem D1). */
export function createMemoryFlowTokenStore(): {
  insert: typeof insertFlowToken
  get: typeof getFlowToken
  consume: typeof consumeFlowToken
  rows: Map<string, FlowTokenRow>
} {
  const rows = new Map<string, FlowTokenRow>()
  return {
    rows,
    insert(_db, input, clock) {
      const now = clock.nowMs()
      for (const [k, v] of rows) {
        if (v.conversationId === input.conversationId && !v.replacedBy && v.consumedAt == null) {
          rows.set(k, { ...v, replacedBy: input.token, consumedAt: now })
        }
      }
      const row: FlowTokenRow = {
        token: input.token,
        tenantId: input.tenantId,
        bindingId: input.bindingId,
        phoneNumberId: input.phoneNumberId,
        wabaId: input.wabaId,
        conversationId: input.conversationId,
        catalogVersion: input.catalogVersion,
        createdAt: now,
        expiresAt: now + FLOW_TOKEN_TTL_MS,
        replacedBy: null,
        consumedAt: null,
      }
      rows.set(input.token, row)
      return row
    },
    get(_db, token) {
      return rows.get(token) ?? null
    },
    consume(_db, token, clock) {
      const row = rows.get(token)
      if (row && row.consumedAt == null) {
        rows.set(token, { ...row, consumedAt: clock.nowMs() })
      }
    },
  }
}
