/**
 * Leitura da auditoria central para a Platform Admin (#832, PA-11 e atividade recente da PA-01).
 * Só leitura. Paginação por cursor `(occurred_at, id)`: estável mesmo com eventos novos a entrar.
 * O mesmo SQL corre no store síncrono (testes) e no D1 (`AsyncAdminDb`).
 */
import type { AsyncAdminDb } from '../db/admin/async-store'
import { redactSecrets } from '../db/tokens'

export const AUDIT_CATEGORIES = ['clinic', 'members', 'support', 'email'] as const
export type AuditCategory = (typeof AUDIT_CATEGORIES)[number]

/** Prefixos de `action` por categoria (spec §6.1). «Tudo» não filtra. */
const CATEGORY_PREFIXES: Record<AuditCategory, readonly string[]> = {
  clinic: ['tenant.'],
  members: ['owner.', 'membership.', 'invitation.'],
  support: ['support.'],
  email: ['email.'],
}

export const AUDIT_PERIOD_DAYS = [7, 30, 90] as const
export const AUDIT_DEFAULT_DAYS = 30
export const AUDIT_DEFAULT_LIMIT = 50
export const AUDIT_MAX_LIMIT = 100
const DAY_MS = 24 * 60 * 60 * 1000

export type AuditRow = {
  id: string
  occurredAt: number
  actorClerkUserId: string
  subjectClerkUserId: string | null
  tenantId: string | null
  tenantName: string | null
  action: string
  objectType: string
  objectId: string | null
  outcome: string
  supportSessionId: string | null
  /** Pares chave–valor planos, já redigidos; nunca texto clínico (a auditoria não o guarda). */
  metadata: Record<string, string | number | boolean | null>
}

type Raw = {
  id: string
  occurred_at: number
  actor_clerk_user_id: string
  subject_clerk_user_id: string | null
  tenant_id: string | null
  tenant_name: string | null
  action: string
  object_type: string
  object_id: string | null
  outcome: string
  support_session_id: string | null
  metadata_json: string | null
}

const CURSOR_RE = /^(\d{1,16})\.([A-Za-z0-9_-]{1,64})$/

export function encodeCursor(row: Pick<AuditRow, 'occurredAt' | 'id'>): string {
  return `${row.occurredAt}.${row.id}`
}

export function parseCursor(raw: string | undefined | null): { occurredAt: number; id: string } | null | 'invalid' {
  if (!raw) return null
  const m = CURSOR_RE.exec(raw)
  return m ? { occurredAt: Number(m[1]), id: m[2]! } : 'invalid'
}

/** Achata o JSON gravado em pares simples; valores aninhados viram texto; segredos redigidos. */
export function flattenMetadata(json: string | null): AuditRow['metadata'] {
  if (!json) return {}
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    return {}
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
  const out: AuditRow['metadata'] = {}
  for (const [k, v] of Object.entries(redactSecrets(parsed as Record<string, unknown>))) {
    out[k] = v === null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' ? v : JSON.stringify(v)
  }
  return out
}

function map(r: Raw): AuditRow {
  return {
    id: r.id,
    occurredAt: Number(r.occurred_at),
    actorClerkUserId: r.actor_clerk_user_id,
    subjectClerkUserId: r.subject_clerk_user_id,
    tenantId: r.tenant_id,
    tenantName: r.tenant_name,
    action: r.action,
    objectType: r.object_type,
    objectId: r.object_id,
    outcome: r.outcome,
    supportSessionId: r.support_session_id,
    metadata: flattenMetadata(r.metadata_json),
  }
}

export async function listAuditPage(
  db: AsyncAdminDb,
  opts: {
    tenantId?: string
    category?: AuditCategory
    nowMs: number
    days?: number
    cursor?: { occurredAt: number; id: string } | null
    limit?: number
  },
): Promise<{ rows: AuditRow[]; nextCursor: string | null }> {
  const limit = Math.min(Math.max(1, opts.limit ?? AUDIT_DEFAULT_LIMIT), AUDIT_MAX_LIMIT)
  const where: string[] = ['e.occurred_at >= ?']
  const params: Array<string | number> = [opts.nowMs - (opts.days ?? AUDIT_DEFAULT_DAYS) * DAY_MS]
  if (opts.tenantId) {
    where.push('e.tenant_id = ?')
    params.push(opts.tenantId)
  }
  if (opts.category) {
    const prefixes = CATEGORY_PREFIXES[opts.category]
    where.push(`(${prefixes.map(() => 'e.action LIKE ?').join(' OR ')})`)
    params.push(...prefixes.map((p) => `${p}%`))
  }
  if (opts.cursor) {
    where.push('(e.occurred_at < ? OR (e.occurred_at = ? AND e.id < ?))')
    params.push(opts.cursor.occurredAt, opts.cursor.occurredAt, opts.cursor.id)
  }
  // Pede mais um para saber se há página seguinte sem uma contagem à parte.
  const rows = await db.all<Raw>(
    `SELECT e.id, e.occurred_at, e.actor_clerk_user_id, e.subject_clerk_user_id, e.tenant_id,
            t.name AS tenant_name, e.action, e.object_type, e.object_id, e.outcome,
            e.support_session_id, e.metadata_json
     FROM central_audit_events e
     LEFT JOIN tenants t ON t.id = e.tenant_id
     WHERE ${where.join(' AND ')}
     ORDER BY e.occurred_at DESC, e.id DESC
     LIMIT ${limit + 1}`,
    ...params,
  )
  const page = rows.slice(0, limit).map(map)
  return { rows: page, nextCursor: rows.length > limit ? encodeCursor(page[page.length - 1]!) : null }
}

export function auditClerkIds(rows: readonly AuditRow[]): string[] {
  const ids = new Set<string>()
  for (const r of rows) {
    ids.add(r.actorClerkUserId)
    if (r.subjectClerkUserId) ids.add(r.subjectClerkUserId)
  }
  return [...ids]
}
