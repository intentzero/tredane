/**
 * Pedidos e sessões de suporte vistos pela Platform Admin (#831, PA-05 e PA-10).
 * Só metadados: quem pediu, para quem, motivo, estado e prazos — nunca tokens, handoff ou conteúdo.
 * O mesmo SQL corre no store síncrono (testes) e no D1 (`AsyncAdminDb`).
 */
import type { AsyncAdminDb } from '../db/admin/async-store'

export type SupportItemState =
  | 'awaiting_owner'
  | 'approved'
  | 'active'
  | 'session_expired'
  | 'ended'
  | 'revoked'
  | 'rejected'
  | 'request_expired'
  | 'cancelled'

/** Estados em que o pedido ainda está a andar (filtro «Abertos»). */
export const OPEN_SUPPORT_STATES: readonly SupportItemState[] = ['awaiting_owner', 'approved', 'active']

export type SupportItemRow = {
  requestId: string
  tenantId: string
  tenantName: string
  actorClerkUserId: string
  subjectClerkUserId: string
  deciderClerkUserId: string | null
  reason: string
  scope: string
  state: SupportItemState
  createdAt: number
  decidedAt: number | null
  /** Fim do prazo do pedido (24 h) ou da sessão (30 min), conforme o estado. */
  expiresAt: number
  sessionId: string | null
  activatedAt: number | null
  endedAt: number | null
  revokedByClerkUserId: string | null
  /** Só em estados finais de sessão: tempo efetivamente usado. */
  durationMs: number | null
  /** Só em estados abertos com prazo: tempo que falta, a partir de `nowMs`. */
  remainingMs: number | null
}

type Raw = {
  id: string
  tenant_id: string
  tenant_name: string
  actor_clerk_user_id: string
  subject_clerk_user_id: string
  decided_by_owner_clerk_user_id: string | null
  reason: string
  scope: string
  status: string
  decided_at: number | null
  created_at: number
  expires_at: number
  session_id: string | null
  session_status: string | null
  activated_at: number | null
  session_expires_at: number | null
  revoked_at: number | null
  revoked_by_clerk_user_id: string | null
  ended_at: number | null
}

const SELECT = `
  SELECT r.id, r.tenant_id, t.name AS tenant_name, r.actor_clerk_user_id, r.subject_clerk_user_id,
         r.decided_by_owner_clerk_user_id, r.reason, r.scope, r.status, r.decided_at, r.created_at,
         r.expires_at, s.id AS session_id, s.status AS session_status, s.activated_at,
         s.expires_at AS session_expires_at, s.revoked_at, s.revoked_by_clerk_user_id, s.ended_at
  FROM support_access_requests r
  INNER JOIN tenants t ON t.id = r.tenant_id
  LEFT JOIN support_sessions s ON s.support_access_request_id = r.id`

/** Estado mostrado ao operador. O prazo vencido conta mesmo que ninguém tenha tocado na linha ainda. */
export function deriveSupportState(r: Raw, nowMs: number): SupportItemState {
  if (r.session_id) {
    // O actor que encerra a própria sessão também a grava como «revoked» (revoked_by = actor): é «encerrada».
    // Revogada por owner (ou pela suspensão da clínica) tem outro `revoked_by`.
    if (r.session_status === 'revoked') {
      return r.revoked_by_clerk_user_id === r.actor_clerk_user_id ? 'ended' : 'revoked'
    }
    if (r.session_status === 'ended') return 'ended'
    if (r.session_status === 'expired') return 'session_expired'
    return nowMs < Number(r.session_expires_at) ? 'active' : 'session_expired'
  }
  switch (r.status) {
    case 'approved':
      return 'approved'
    case 'rejected':
      return 'rejected'
    case 'cancelled':
      return 'cancelled'
    case 'expired':
      return 'request_expired'
    default:
      return nowMs >= Number(r.expires_at) ? 'request_expired' : 'awaiting_owner'
  }
}

function map(r: Raw, nowMs: number): SupportItemRow {
  const state = deriveSupportState(r, nowMs)
  const activatedAt = r.activated_at === null ? null : Number(r.activated_at)
  const sessionEnd =
    state === 'ended' || state === 'revoked'
      ? (r.ended_at ?? r.revoked_at)
      : state === 'session_expired'
        ? r.session_expires_at
        : null
  const expiresAt = r.session_id ? Number(r.session_expires_at) : Number(r.expires_at)
  return {
    requestId: r.id,
    tenantId: r.tenant_id,
    tenantName: r.tenant_name,
    actorClerkUserId: r.actor_clerk_user_id,
    subjectClerkUserId: r.subject_clerk_user_id,
    deciderClerkUserId: r.decided_by_owner_clerk_user_id,
    reason: r.reason,
    scope: r.scope,
    state,
    createdAt: Number(r.created_at),
    decidedAt: r.decided_at === null ? null : Number(r.decided_at),
    expiresAt,
    sessionId: r.session_id,
    activatedAt,
    endedAt: sessionEnd === null || sessionEnd === undefined ? null : Number(sessionEnd),
    revokedByClerkUserId: r.revoked_by_clerk_user_id,
    durationMs:
      activatedAt !== null && sessionEnd !== null && sessionEnd !== undefined
        ? Math.max(0, Math.min(Number(sessionEnd), expiresAt) - activatedAt)
        : null,
    remainingMs: OPEN_SUPPORT_STATES.includes(state) ? Math.max(0, expiresAt - nowMs) : null,
  }
}

const LIMIT = 200

export async function listSupportItems(
  db: AsyncAdminDb,
  nowMs: number,
  opts: { tenantId?: string } = {},
): Promise<SupportItemRow[]> {
  const rows = opts.tenantId
    ? await db.all<Raw>(`${SELECT} WHERE r.tenant_id = ? ORDER BY r.created_at DESC LIMIT ${LIMIT}`, opts.tenantId)
    : await db.all<Raw>(`${SELECT} ORDER BY r.created_at DESC LIMIT ${LIMIT}`)
  return rows.map((r) => map(r, nowMs))
}

export function clerkIdsOf(items: readonly SupportItemRow[]): string[] {
  const ids = new Set<string>()
  for (const i of items) {
    ids.add(i.actorClerkUserId)
    ids.add(i.subjectClerkUserId)
    if (i.deciderClerkUserId) ids.add(i.deciderClerkUserId)
    if (i.revokedByClerkUserId) ids.add(i.revokedByClerkUserId)
  }
  return [...ids]
}
