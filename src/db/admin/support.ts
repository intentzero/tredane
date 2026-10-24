import type { Clock } from '../clock'
import { generateOpaqueToken, hashToken } from '../tokens'
import { writeAudit } from './audit'
import { SUPPORT_REQUEST_TTL_MS, SUPPORT_SESSION_TTL_MS } from './constants'
import { ConflictError, ForbiddenError, NotFoundError } from './errors'
import { assertAdminSchemaReady } from './gate'
import { newId } from './ids'
import { getMembership, requireActiveOwner } from './memberships'
import type { AdminDb } from './store'
import { getTenant } from './tenants'

export type SupportRequestRow = {
  id: string
  tenantId: string
  actorClerkUserId: string
  subjectClerkUserId: string
  reason: string
  scope: string
  status: 'pending' | 'approved' | 'rejected' | 'expired' | 'cancelled'
  decidedByOwnerClerkUserId: string | null
  decidedAt: number | null
  createdAt: number
  expiresAt: number
}

export type SupportSessionRow = {
  id: string
  supportAccessRequestId: string
  approvedByOwnerClerkUserId: string
  actorClerkUserId: string
  actorClerkSessionId: string
  subjectClerkUserId: string
  tenantId: string
  reason: string
  scope: string
  status: 'active' | 'expired' | 'revoked' | 'ended'
  createdAt: number
  activatedAt: number
  expiresAt: number
  revokedAt: number | null
  revokedByClerkUserId: string | null
  endedAt: number | null
}

function mapRequest(row: {
  id: string
  tenant_id: string
  actor_clerk_user_id: string
  subject_clerk_user_id: string
  reason: string
  scope: string
  status: string
  decided_by_owner_clerk_user_id: string | null
  decided_at: number | null
  created_at: number
  expires_at: number
}): SupportRequestRow {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    actorClerkUserId: row.actor_clerk_user_id,
    subjectClerkUserId: row.subject_clerk_user_id,
    reason: row.reason,
    scope: row.scope,
    status: row.status as SupportRequestRow['status'],
    decidedByOwnerClerkUserId: row.decided_by_owner_clerk_user_id,
    decidedAt: row.decided_at,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  }
}

function mapSession(row: {
  id: string
  support_access_request_id: string
  approved_by_owner_clerk_user_id: string
  actor_clerk_user_id: string
  actor_clerk_session_id: string
  subject_clerk_user_id: string
  tenant_id: string
  reason: string
  scope: string
  status: string
  created_at: number
  activated_at: number
  expires_at: number
  revoked_at: number | null
  revoked_by_clerk_user_id: string | null
  ended_at: number | null
}): SupportSessionRow {
  return {
    id: row.id,
    supportAccessRequestId: row.support_access_request_id,
    approvedByOwnerClerkUserId: row.approved_by_owner_clerk_user_id,
    actorClerkUserId: row.actor_clerk_user_id,
    actorClerkSessionId: row.actor_clerk_session_id,
    subjectClerkUserId: row.subject_clerk_user_id,
    tenantId: row.tenant_id,
    reason: row.reason,
    scope: row.scope,
    status: row.status as SupportSessionRow['status'],
    createdAt: row.created_at,
    activatedAt: row.activated_at,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
    revokedByClerkUserId: row.revoked_by_clerk_user_id,
    endedAt: row.ended_at,
  }
}

export function getSupportRequest(db: AdminDb, id: string): SupportRequestRow | undefined {
  assertAdminSchemaReady(db)
  const row = db.get<{
    id: string
    tenant_id: string
    actor_clerk_user_id: string
    subject_clerk_user_id: string
    reason: string
    scope: string
    status: string
    decided_by_owner_clerk_user_id: string | null
    decided_at: number | null
    created_at: number
    expires_at: number
  }>(
    `SELECT id, tenant_id, actor_clerk_user_id, subject_clerk_user_id, reason, scope, status,
            decided_by_owner_clerk_user_id, decided_at, created_at, expires_at
     FROM support_access_requests WHERE id = ?`,
    id,
  )
  return row ? mapRequest(row) : undefined
}

export function getSupportSession(db: AdminDb, id: string): SupportSessionRow | undefined {
  assertAdminSchemaReady(db)
  const row = db.get<{
    id: string
    support_access_request_id: string
    approved_by_owner_clerk_user_id: string
    actor_clerk_user_id: string
    actor_clerk_session_id: string
    subject_clerk_user_id: string
    tenant_id: string
    reason: string
    scope: string
    status: string
    created_at: number
    activated_at: number
    expires_at: number
    revoked_at: number | null
    revoked_by_clerk_user_id: string | null
    ended_at: number | null
  }>(
    `SELECT id, support_access_request_id, approved_by_owner_clerk_user_id,
            actor_clerk_user_id, actor_clerk_session_id, subject_clerk_user_id,
            tenant_id, reason, scope, status, created_at, activated_at, expires_at,
            revoked_at, revoked_by_clerk_user_id, ended_at
     FROM support_sessions WHERE id = ?`,
    id,
  )
  return row ? mapSession(row) : undefined
}

export function createSupportAccessRequest(
  db: AdminDb,
  clock: Clock,
  input: {
    tenantId: string
    actorClerkUserId: string
    subjectClerkUserId: string
    reason: string
    scope: string
  },
): SupportRequestRow {
  assertAdminSchemaReady(db)
  const tenant = getTenant(db, input.tenantId)
  if (!tenant || tenant.status !== 'active') {
    throw new ForbiddenError('tenant_not_active', 'Tenant inativo')
  }
  const subject = getMembership(db, input.tenantId, input.subjectClerkUserId)
  if (!subject || subject.status !== 'active') {
    throw new ForbiddenError('subject_not_member', 'Subject sem membership ativo')
  }
  const now = clock.nowMs()
  const id = newId('sar')

  return db.immediate(() => {
    db.run(
      `INSERT INTO support_access_requests (
        id, tenant_id, actor_clerk_user_id, subject_clerk_user_id, reason, scope,
        status, decided_by_owner_clerk_user_id, decided_at, created_at, expires_at, cancelled_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'pending', NULL, NULL, ?, ?, NULL)`,
      id,
      input.tenantId,
      input.actorClerkUserId,
      input.subjectClerkUserId,
      input.reason,
      input.scope,
      now,
      now + SUPPORT_REQUEST_TTL_MS,
    )
    writeAudit(db, clock, {
      actorClerkUserId: input.actorClerkUserId,
      subjectClerkUserId: input.subjectClerkUserId,
      tenantId: input.tenantId,
      action: 'support.request.create',
      objectType: 'support_access_request',
      objectId: id,
      outcome: 'success',
      metadata: { scope: input.scope },
    })
    return getSupportRequest(db, id)!
  })
}

export type ApprovedSupport = {
  request: SupportRequestRow
  session: SupportSessionRow
  /** Código de handoff de uso único — nunca persistido em claro nem auditado. */
  handoffCode: string
  /** Token de sessão (cookie) — devolvido uma vez; só hash no D1. */
  sessionToken: string
}

/**
 * DEC-029/032: aprovação atómica pending→approved + criação de sessão 30min.
 * Pedido expirado ou já decidido falha sem criar sessão.
 */
export async function approveSupportRequest(
  db: AdminDb,
  clock: Clock,
  input: {
    requestId: string
    ownerClerkUserId: string
    actorClerkSessionId: string
  },
): Promise<ApprovedSupport> {
  assertAdminSchemaReady(db)
  const preview = getSupportRequest(db, input.requestId)
  if (!preview) throw new NotFoundError('support_request_not_found', 'Pedido inexistente')
  requireActiveOwner(db, preview.tenantId, input.ownerClerkUserId)

  const now = clock.nowMs()
  const sessionToken = generateOpaqueToken()
  const handoffCode = generateOpaqueToken(24)
  const tokenHash = await hashToken(sessionToken)
  const handoffHash = await hashToken(handoffCode)
  const sessionId = newId('ssn')

  return db.immediate(() => {
    const current = getSupportRequest(db, input.requestId)
    if (!current || current.status !== 'pending') {
      throw new ConflictError('support_request_not_pending', 'Pedido não pendente')
    }
    if (now >= current.expiresAt) {
      db.run(
        `UPDATE support_access_requests SET status = 'expired' WHERE id = ? AND status = 'pending'`,
        current.id,
      )
      throw new ConflictError('support_request_expired', 'Pedido expirado (24h)')
    }

    const subject = getMembership(db, current.tenantId, current.subjectClerkUserId)
    if (!subject || subject.status !== 'active') {
      throw new ForbiddenError('subject_not_member', 'Subject sem membership ativo')
    }

    const decided = db.run(
      `UPDATE support_access_requests
       SET status = 'approved', decided_by_owner_clerk_user_id = ?, decided_at = ?
       WHERE id = ? AND status = 'pending' AND expires_at > ?`,
      input.ownerClerkUserId,
      now,
      current.id,
      now,
    )
    if (decided.changes !== 1) {
      throw new ConflictError('support_approve_conflict', 'Aprovação concorrente negada')
    }

    db.run(
      `INSERT INTO support_sessions (
        id, support_access_request_id, approved_by_owner_clerk_user_id, token_hash, handoff_hash,
        actor_clerk_user_id, actor_clerk_session_id, subject_clerk_user_id, tenant_id,
        reason, scope, status, created_at, activated_at, expires_at,
        revoked_at, revoked_by_clerk_user_id, ended_at, last_used_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, NULL, NULL, NULL, NULL)`,
      sessionId,
      current.id,
      input.ownerClerkUserId,
      tokenHash,
      handoffHash,
      current.actorClerkUserId,
      input.actorClerkSessionId,
      current.subjectClerkUserId,
      current.tenantId,
      current.reason,
      current.scope,
      now,
      now,
      now + SUPPORT_SESSION_TTL_MS,
    )

    writeAudit(db, clock, {
      actorClerkUserId: input.ownerClerkUserId,
      subjectClerkUserId: current.subjectClerkUserId,
      tenantId: current.tenantId,
      action: 'support.request.approve',
      objectType: 'support_access_request',
      objectId: current.id,
      outcome: 'success',
      supportSessionId: sessionId,
    })
    writeAudit(db, clock, {
      actorClerkUserId: current.actorClerkUserId,
      subjectClerkUserId: current.subjectClerkUserId,
      tenantId: current.tenantId,
      action: 'support.session.activate',
      objectType: 'support_session',
      objectId: sessionId,
      outcome: 'success',
      supportSessionId: sessionId,
      metadata: { approvedBy: input.ownerClerkUserId },
    })

    return {
      request: getSupportRequest(db, current.id)!,
      session: getSupportSession(db, sessionId)!,
      handoffCode,
      sessionToken,
    }
  })
}

export function rejectSupportRequest(
  db: AdminDb,
  clock: Clock,
  input: { requestId: string; ownerClerkUserId: string },
): SupportRequestRow {
  assertAdminSchemaReady(db)
  const preview = getSupportRequest(db, input.requestId)
  if (!preview) throw new NotFoundError('support_request_not_found', 'Pedido inexistente')
  requireActiveOwner(db, preview.tenantId, input.ownerClerkUserId)
  const now = clock.nowMs()

  return db.immediate(() => {
    const result = db.run(
      `UPDATE support_access_requests
       SET status = 'rejected', decided_by_owner_clerk_user_id = ?, decided_at = ?
       WHERE id = ? AND status = 'pending'`,
      input.ownerClerkUserId,
      now,
      input.requestId,
    )
    if (result.changes !== 1) {
      throw new ConflictError('support_reject_conflict', 'Rejeição não aplicada')
    }
    writeAudit(db, clock, {
      actorClerkUserId: input.ownerClerkUserId,
      subjectClerkUserId: preview.subjectClerkUserId,
      tenantId: preview.tenantId,
      action: 'support.request.reject',
      objectType: 'support_access_request',
      objectId: input.requestId,
      outcome: 'success',
    })
    return getSupportRequest(db, input.requestId)!
  })
}

/**
 * Consome handoff de uso único (hash) — segundo consumo falha.
 */
export async function consumeSupportHandoff(
  db: AdminDb,
  clock: Clock,
  input: { handoffCode: string; actorClerkUserId: string },
): Promise<SupportSessionRow> {
  assertAdminSchemaReady(db)
  const now = clock.nowMs()
  const handoffHash = await hashToken(input.handoffCode)

  return db.immediate(() => {
    const row = db.get<{
      id: string
      actor_clerk_user_id: string
      status: string
      expires_at: number
    }>(
      `SELECT id, actor_clerk_user_id, status, expires_at
       FROM support_sessions WHERE handoff_hash = ?`,
      handoffHash,
    )
    if (!row || row.status !== 'active') {
      throw new ConflictError('handoff_invalid', 'Handoff inválido ou já consumido')
    }
    if (row.actor_clerk_user_id !== input.actorClerkUserId) {
      throw new ForbiddenError('handoff_actor_mismatch', 'Handoff não pertence ao actor')
    }
    if (now >= row.expires_at) {
      db.run(
        `UPDATE support_sessions SET status = 'expired', ended_at = ? WHERE id = ? AND status = 'active'`,
        now,
        row.id,
      )
      throw new ConflictError('support_session_expired', 'Sessão expirada')
    }

    const consumed = db.run(
      `UPDATE support_sessions
       SET handoff_hash = NULL, last_used_at = ?
       WHERE id = ? AND status = 'active' AND handoff_hash = ?`,
      now,
      row.id,
      handoffHash,
    )
    if (consumed.changes !== 1) {
      throw new ConflictError('handoff_consume_conflict', 'Consumo concorrente negado')
    }

    writeAudit(db, clock, {
      actorClerkUserId: input.actorClerkUserId,
      tenantId: getSupportSession(db, row.id)!.tenantId,
      subjectClerkUserId: getSupportSession(db, row.id)!.subjectClerkUserId,
      action: 'support.handoff.consume',
      objectType: 'support_session',
      objectId: row.id,
      outcome: 'success',
      supportSessionId: row.id,
    })

    return getSupportSession(db, row.id)!
  })
}

/** DEC-034: owner ou actor encerra sessão ativa. */
export function revokeSupportSession(
  db: AdminDb,
  clock: Clock,
  input: {
    sessionId: string
    actorClerkUserId: string
    asOwner?: boolean
  },
): SupportSessionRow {
  assertAdminSchemaReady(db)
  const preview = getSupportSession(db, input.sessionId)
  if (!preview) throw new NotFoundError('support_session_not_found', 'Sessão inexistente')

  if (input.asOwner) {
    requireActiveOwner(db, preview.tenantId, input.actorClerkUserId)
  } else if (preview.actorClerkUserId !== input.actorClerkUserId) {
    throw new ForbiddenError('not_session_actor', 'Apenas o actor da sessão pode encerrar assim')
  }

  const now = clock.nowMs()
  return db.immediate(() => {
    const result = db.run(
      `UPDATE support_sessions
       SET status = 'revoked', revoked_at = ?, revoked_by_clerk_user_id = ?, ended_at = ?,
           handoff_hash = NULL
       WHERE id = ? AND status = 'active'`,
      now,
      input.actorClerkUserId,
      now,
      input.sessionId,
    )
    if (result.changes !== 1) {
      throw new ConflictError('support_revoke_conflict', 'Revogação não aplicada')
    }
    writeAudit(db, clock, {
      actorClerkUserId: input.actorClerkUserId,
      subjectClerkUserId: preview.subjectClerkUserId,
      tenantId: preview.tenantId,
      action: 'support.session.revoke',
      objectType: 'support_session',
      objectId: input.sessionId,
      outcome: 'success',
      supportSessionId: input.sessionId,
    })
    return getSupportSession(db, input.sessionId)!
  })
}

/** Expira sessão se now >= expires_at (idempotente). */
export function expireSupportSessionIfNeeded(
  db: AdminDb,
  clock: Clock,
  sessionId: string,
): SupportSessionRow {
  assertAdminSchemaReady(db)
  const now = clock.nowMs()
  return db.immediate(() => {
    const current = getSupportSession(db, sessionId)
    if (!current) throw new NotFoundError('support_session_not_found', 'Sessão inexistente')
    if (current.status !== 'active') return current
    if (now < current.expiresAt) return current

    db.run(
      `UPDATE support_sessions
       SET status = 'expired', ended_at = ?, handoff_hash = NULL
       WHERE id = ? AND status = 'active'`,
      now,
      sessionId,
    )
    writeAudit(db, clock, {
      actorClerkUserId: current.actorClerkUserId,
      subjectClerkUserId: current.subjectClerkUserId,
      tenantId: current.tenantId,
      action: 'support.session.expire',
      objectType: 'support_session',
      objectId: sessionId,
      outcome: 'success',
      supportSessionId: sessionId,
    })
    return getSupportSession(db, sessionId)!
  })
}

export function requestSupportTermination(
  db: AdminDb,
  clock: Clock,
  input: { sessionId: string; subjectClerkUserId: string },
): { id: string; status: string; created: boolean } {
  assertAdminSchemaReady(db)
  const session = getSupportSession(db, input.sessionId)
  if (!session || session.status !== 'active') {
    throw new ConflictError('support_session_not_active', 'Sessão não ativa')
  }
  if (session.subjectClerkUserId !== input.subjectClerkUserId) {
    throw new ForbiddenError('not_session_subject', 'Apenas o subject pode pedir encerramento')
  }
  const now = clock.nowMs()

  return db.immediate(() => {
    const existing = db.get<{ id: string; status: string }>(
      `SELECT id, status FROM support_termination_requests
       WHERE support_session_id = ? AND status = 'pending'`,
      input.sessionId,
    )
    if (existing) {
      return { id: existing.id, status: existing.status, created: false }
    }
    const id = newId('str')
    db.run(
      `INSERT INTO support_termination_requests (
        id, support_session_id, tenant_id, requested_by_subject_clerk_user_id,
        requested_at, status, decided_by_owner_clerk_user_id, decided_at
      ) VALUES (?, ?, ?, ?, ?, 'pending', NULL, NULL)`,
      id,
      input.sessionId,
      session.tenantId,
      input.subjectClerkUserId,
      now,
    )
    writeAudit(db, clock, {
      actorClerkUserId: input.subjectClerkUserId,
      subjectClerkUserId: input.subjectClerkUserId,
      tenantId: session.tenantId,
      action: 'support.termination.request',
      objectType: 'support_termination_request',
      objectId: id,
      outcome: 'success',
      supportSessionId: input.sessionId,
    })
    return { id, status: 'pending', created: true }
  })
}
