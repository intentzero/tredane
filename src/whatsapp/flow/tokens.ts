/**
 * Sessão do Flow: `flow_token` opaco no D1 central (ADR-0016 §5).
 * `session_json` guarda o snapshot multi-ecrã (Finding 1 / #527).
 */
import type { Clock } from '../../db/clock'
import { assertAdminSchemaReady } from '../../db/admin/gate'
import type { AdminDb } from '../../db/admin/store'
import type { FlowBookingSnapshot } from './screens'

/** Mesmo horizonte da oferta DEC-127 / ADR-0016: 24 h. */
export const FLOW_TOKEN_TTL_MS = 24 * 60 * 60 * 1000

export const EMPTY_FLOW_SESSION: FlowBookingSnapshot = {
  serviceId: null,
  line: null,
  variantIds: null,
  slotKey: null,
}

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
  /** DEC-143: primeira chamada Meta ao endpoint (INIT/data_exchange); null = ainda não aberto. */
  openedAt: number | null
  /** Snapshot SERVICO/GENERO/VARIANTES/HORARIO persistido no D1. */
  session: FlowBookingSnapshot
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
  opened_at?: number | null
  session_json?: string | null
}

export function parseFlowSessionJson(raw: string | null | undefined): FlowBookingSnapshot {
  if (!raw) return { ...EMPTY_FLOW_SESSION }
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const line =
      parsed.line === 'feminino' || parsed.line === 'masculino' ? parsed.line : null
    const variantIds = Array.isArray(parsed.variantIds)
      ? parsed.variantIds.filter((x): x is string => typeof x === 'string')
      : null
    return {
      serviceId: typeof parsed.serviceId === 'string' ? parsed.serviceId : null,
      line,
      variantIds: variantIds && variantIds.length > 0 ? variantIds : null,
      slotKey: typeof parsed.slotKey === 'string' ? parsed.slotKey : null,
    }
  } catch {
    return { ...EMPTY_FLOW_SESSION }
  }
}

export function serializeFlowSession(session: FlowBookingSnapshot): string {
  return JSON.stringify({
    serviceId: session.serviceId,
    line: session.line,
    variantIds: session.variantIds,
    slotKey: session.slotKey,
  })
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
    openedAt: row.opened_at ?? null,
    session: parseFlowSessionJson(row.session_json),
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
    session?: FlowBookingSnapshot
  },
  clock: Clock,
): FlowTokenRow {
  assertAdminSchemaReady(db)
  const now = clock.nowMs()
  const expiresAt = now + FLOW_TOKEN_TTL_MS
  const session = input.session ?? { ...EMPTY_FLOW_SESSION }
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
      conversation_id, catalog_version, created_at, expires_at, replaced_by, consumed_at,
      session_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?)`,
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
    openedAt: null,
    session,
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

export function saveFlowTokenSession(
  db: AdminDb,
  token: string,
  session: FlowBookingSnapshot,
  nowMs: number = Date.now(),
): void {
  assertAdminSchemaReady(db)
  db.run(
    // DEC-143: a primeira chamada do endpoint marca a abertura do Flow.
    `UPDATE whatsapp_flow_tokens
     SET session_json = ?, opened_at = COALESCE(opened_at, ?)
     WHERE token = ?`,
    serializeFlowSession(session),
    nowMs,
    token,
  )
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

/**
 * DEC-149: ao mudar serviço para `uma`, invalida tokens Flow em voo desse serviço
 * (session_json.serviceId). O próximo data_exchange / nfm não reutiliza o multi.
 */
export function expireOpenFlowTokensForService(
  db: AdminDb,
  tenantId: string,
  serviceId: string,
  clock: Clock,
): number {
  assertAdminSchemaReady(db)
  const now = clock.nowMs()
  const rows = db.all<SqlRow>(
    `SELECT * FROM whatsapp_flow_tokens
     WHERE tenant_id = ? AND replaced_by IS NULL AND consumed_at IS NULL AND expires_at > ?`,
    tenantId,
    now,
  )
  let n = 0
  for (const row of rows) {
    const session = parseFlowSessionJson(row.session_json)
    if (session.serviceId !== serviceId) continue
    db.run(
      `UPDATE whatsapp_flow_tokens
       SET consumed_at = ?, expires_at = ?
       WHERE token = ? AND consumed_at IS NULL`,
      now,
      now,
      row.token,
    )
    n += 1
  }
  return n
}

/** Store em memória para testes L1 (sem D1). Inclui session por token. */
export function createMemoryFlowTokenStore(): {
  insert: typeof insertFlowToken
  get: typeof getFlowToken
  saveSession: typeof saveFlowTokenSession
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
      const session = input.session ?? { ...EMPTY_FLOW_SESSION }
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
        openedAt: null,
        session: { ...session },
      }
      rows.set(input.token, row)
      return row
    },
    get(_db, token) {
      const row = rows.get(token)
      return row ? { ...row, session: { ...row.session } } : null
    },
    saveSession(_db, token, session, nowMs = Date.now()) {
      const row = rows.get(token)
      // DEC-143: espelha COALESCE(opened_at, ?) do D1 / saveFlowTokenSession.
      if (row) {
        rows.set(token, {
          ...row,
          session: { ...session },
          openedAt: row.openedAt ?? nowMs,
        })
      }
    },
    consume(_db, token, clock) {
      const row = rows.get(token)
      if (row && row.consumedAt == null) {
        rows.set(token, { ...row, consumedAt: clock.nowMs() })
      }
    },
  }
}
