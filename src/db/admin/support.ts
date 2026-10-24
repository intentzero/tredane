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

export type ActivatedSupport = {
  request: SupportRequestRow
  session: SupportSessionRow
  /** Código de handoff de uso único — nunca persistido em claro nem auditado. */
  handoffCode: string
  /** Token de sessão (cookie) — devolvido uma vez; só hash no D1. */
  sessionToken: string
}

/** @deprecated Prefer ActivatedSupport — aprovação (#26) já não cria sessão. */
export type ApprovedSupport = ActivatedSupport

/**
 * DEC-029/031 (#26): aprovação atómica pending→approved.
 * Não cria sessão, handoff nem cookie — ativação fica na #27 / activateSupportSession.
 */
export function approveSupportRequest(
  db: AdminDb,
  clock: Clock,
  input: {
    requestId: string
    ownerClerkUserId: string
  },
): SupportRequestRow {
  assertAdminSchemaReady(db)
  const preview = getSupportRequest(db, input.requestId)
  if (!preview) throw new NotFoundError('support_request_not_found', 'Pedido inexistente')
  requireActiveOwner(db, preview.tenantId, input.ownerClerkUserId)

  const now = clock.nowMs()

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

    writeAudit(db, clock, {
      actorClerkUserId: input.ownerClerkUserId,
      subjectClerkUserId: current.subjectClerkUserId,
      tenantId: current.tenantId,
      action: 'support.request.approve',
      objectType: 'support_access_request',
      objectId: current.id,
      outcome: 'success',
    })

    return getSupportRequest(db, current.id)!
  })
}

/**
 * DEC-032 (#27): ativa sessão 30min a partir de pedido já approved.
 * Domínio pronto; HTTP de ativação/handoff permanece fora de #26.
 */
export async function activateSupportSession(
  db: AdminDb,
  clock: Clock,
  input: {
    requestId: string
    actorClerkSessionId: string
    /** Superadmin actor — deve coincidir com o pedido. */
    actorClerkUserId: string
  },
): Promise<ActivatedSupport> {
  assertAdminSchemaReady(db)
  const preview = getSupportRequest(db, input.requestId)
  if (!preview) throw new NotFoundError('support_request_not_found', 'Pedido inexistente')
  if (preview.actorClerkUserId !== input.actorClerkUserId) {
    throw new ForbiddenError('not_request_actor', 'Apenas o actor do pedido pode ativar')
  }

  const now = clock.nowMs()
  const sessionToken = generateOpaqueToken()
  const handoffCode = generateOpaqueToken(24)
  const tokenHash = await hashToken(sessionToken)
  const handoffHash = await hashToken(handoffCode)
  const sessionId = newId('ssn')

  return db.immediate(() => {
    const current = getSupportRequest(db, input.requestId)
    if (!current || current.status !== 'approved') {
      throw new ConflictError('support_request_not_approved', 'Pedido não aprovado')
    }
    if (!current.decidedByOwnerClerkUserId) {
      throw new ConflictError('support_request_missing_approver', 'Aprovador em falta')
    }

    const existing = db.get<{ id: string }>(
      `SELECT id FROM support_sessions WHERE support_access_request_id = ?`,
      current.id,
    )
    if (existing) {
      throw new ConflictError('support_session_already_active', 'Sessão já criada para este pedido')
    }

    const subject = getMembership(db, current.tenantId, current.subjectClerkUserId)
    if (!subject || subject.status !== 'active') {
      throw new ForbiddenError('subject_not_member', 'Subject sem membership ativo')
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
      current.decidedByOwnerClerkUserId,
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
      actorClerkUserId: current.actorClerkUserId,
      subjectClerkUserId: current.subjectClerkUserId,
      tenantId: current.tenantId,
      action: 'support.session.activate',
      objectType: 'support_session',
      objectId: sessionId,
      outcome: 'success',
      supportSessionId: sessionId,
      metadata: { approvedBy: current.decidedByOwnerClerkUserId },
    })

    return {
      request: getSupportRequest(db, current.id)!,
      session: getSupportSession(db, sessionId)!,
      handoffCode,
      sessionToken,
    }
  })
}

export function listSupportRequestsForTenant(
  db: AdminDb,
  tenantId: string,
  opts: { status?: SupportRequestRow['status']; limit?: number } = {},
): SupportRequestRow[] {
  assertAdminSchemaReady(db)
  const limit = opts.limit ?? 50
  if (opts.status) {
    const rows = db.all<{
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
       FROM support_access_requests
       WHERE tenant_id = ? AND status = ?
       ORDER BY created_at DESC
       LIMIT ?`,
      tenantId,
      opts.status,
      limit,
    )
    return rows.map(mapRequest)
  }
  const rows = db.all<{
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
     FROM support_access_requests
     WHERE tenant_id = ?
     ORDER BY created_at DESC
     LIMIT ?`,
    tenantId,
    limit,
  )
  return rows.map(mapRequest)
}

/** Marca pending expirado se now >= expires_at (idempotente). */
export function expireSupportRequestIfNeeded(
  db: AdminDb,
  clock: Clock,
  requestId: string,
): SupportRequestRow {
  assertAdminSchemaReady(db)
  const now = clock.nowMs()
  return db.immediate(() => {
    const current = getSupportRequest(db, requestId)
    if (!current) throw new NotFoundError('support_request_not_found', 'Pedido inexistente')
    if (current.status !== 'pending') return current
    if (now < current.expiresAt) return current

    db.run(
      `UPDATE support_access_requests SET status = 'expired' WHERE id = ? AND status = 'pending'`,
      requestId,
    )
    writeAudit(db, clock, {
      actorClerkUserId: current.actorClerkUserId,
      subjectClerkUserId: current.subjectClerkUserId,
      tenantId: current.tenantId,
      action: 'support.request.expire',
      objectType: 'support_access_request',
      objectId: requestId,
      outcome: 'success',
    })
    return getSupportRequest(db, requestId)!
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
    const current = getSupportRequest(db, input.requestId)
    if (!current || current.status !== 'pending') {
      throw new ConflictError('support_reject_conflict', 'Rejeição não aplicada')
    }
    if (now >= current.expiresAt) {
      db.run(
        `UPDATE support_access_requests SET status = 'expired' WHERE id = ? AND status = 'pending'`,
        current.id,
      )
      throw new ConflictError('support_request_expired', 'Pedido expirado (24h)')
    }

    const result = db.run(
      `UPDATE support_access_requests
       SET status = 'rejected', decided_by_owner_clerk_user_id = ?, decided_at = ?
       WHERE id = ? AND status = 'pending' AND expires_at > ?`,
      input.ownerClerkUserId,
      now,
      input.requestId,
      now,
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

export type ConsumedHandoff = {
  session: SupportSessionRow
  /** Token opaco para cookie HttpOnly — devolvido uma vez; só hash no D1. */
  sessionToken: string
}

/**
 * Consome handoff de uso único e emite token de cookie (rotação).
 * Replay do mesmo handoff falha. Não renova `expires_at` (DEC-032/033).
 */
export async function consumeSupportHandoff(
  db: AdminDb,
  clock: Clock,
  input: {
    handoffCode: string
    actorClerkUserId: string
    /** Sessão Clerk atual do actor — deve coincidir com a gravada na ativação. */
    actorClerkSessionId: string
    claimedTenantId?: string
    claimedSubjectClerkUserId?: string
  },
): Promise<ConsumedHandoff> {
  assertAdminSchemaReady(db)
  const now = clock.nowMs()
  const handoffHash = await hashToken(input.handoffCode)
  const sessionToken = generateOpaqueToken()
  const tokenHash = await hashToken(sessionToken)

  return db.immediate(() => {
    const row = db.get<{
      id: string
      actor_clerk_user_id: string
      actor_clerk_session_id: string
      tenant_id: string
      subject_clerk_user_id: string
      status: string
      expires_at: number
    }>(
      `SELECT id, actor_clerk_user_id, actor_clerk_session_id, tenant_id, subject_clerk_user_id,
              status, expires_at
       FROM support_sessions WHERE handoff_hash = ?`,
      handoffHash,
    )
    if (!row || row.status !== 'active') {
      throw new ConflictError('handoff_invalid', 'Handoff inválido ou já consumido')
    }
    if (row.actor_clerk_user_id !== input.actorClerkUserId) {
      throw new ForbiddenError('handoff_actor_mismatch', 'Handoff não pertence ao actor')
    }
    if (row.actor_clerk_session_id !== input.actorClerkSessionId) {
      throw new ForbiddenError(
        'handoff_clerk_session_mismatch',
        'Handoff vinculado a outra sessão Clerk do actor',
      )
    }
    if (input.claimedTenantId && input.claimedTenantId !== row.tenant_id) {
      throw new ForbiddenError('support_tenant_forged', 'Tenant forjado')
    }
    if (
      input.claimedSubjectClerkUserId
      && input.claimedSubjectClerkUserId !== row.subject_clerk_user_id
    ) {
      throw new ForbiddenError('support_subject_forged', 'Subject forjado')
    }
    if (now >= row.expires_at) {
      db.run(
        `UPDATE support_sessions
         SET status = 'expired', ended_at = ?, handoff_hash = NULL
         WHERE id = ? AND status = 'active'`,
        now,
        row.id,
      )
      closeOpenTerminationRequestsInTx(db, clock, row.id, now)
      throw new ConflictError('support_session_expired', 'Sessão expirada')
    }

    const consumed = db.run(
      `UPDATE support_sessions
       SET handoff_hash = NULL, token_hash = ?, last_used_at = ?
       WHERE id = ? AND status = 'active' AND handoff_hash = ?`,
      tokenHash,
      now,
      row.id,
      handoffHash,
    )
    if (consumed.changes !== 1) {
      throw new ConflictError('handoff_consume_conflict', 'Consumo concorrente negado')
    }

    const session = getSupportSession(db, row.id)!
    writeAudit(db, clock, {
      actorClerkUserId: input.actorClerkUserId,
      tenantId: session.tenantId,
      subjectClerkUserId: session.subjectClerkUserId,
      action: 'support.handoff.consume',
      objectType: 'support_session',
      objectId: row.id,
      outcome: 'success',
      supportSessionId: row.id,
    })

    return { session, sessionToken }
  })
}

function closeOpenTerminationRequestsInTx(
  db: AdminDb,
  clock: Clock,
  sessionId: string,
  now: number,
): void {
  const open = db.all<{ id: string }>(
    `SELECT id FROM support_termination_requests
     WHERE support_session_id = ? AND status = 'pending'`,
    sessionId,
  )
  for (const row of open) {
    db.run(
      `UPDATE support_termination_requests
       SET status = 'closed_with_session', decided_at = ?
       WHERE id = ? AND status = 'pending'`,
      now,
      row.id,
    )
    writeAudit(db, clock, {
      actorClerkUserId: 'system:support',
      tenantId: getSupportSession(db, sessionId)?.tenantId ?? null,
      action: 'support.termination.close_with_session',
      objectType: 'support_termination_request',
      objectId: row.id,
      outcome: 'success',
      supportSessionId: sessionId,
    })
  }
}

/** DEC-034: owner ou actor encerra sessão ativa. */
export function revokeSupportSession(
  db: AdminDb,
  clock: Clock,
  input: {
    sessionId: string
    actorClerkUserId: string
    asOwner?: boolean
    reason?: string
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
    closeOpenTerminationRequestsInTx(db, clock, input.sessionId, now)
    writeAudit(db, clock, {
      actorClerkUserId: input.actorClerkUserId,
      subjectClerkUserId: preview.subjectClerkUserId,
      tenantId: preview.tenantId,
      action: 'support.session.revoke',
      objectType: 'support_session',
      objectId: input.sessionId,
      outcome: 'success',
      supportSessionId: input.sessionId,
      metadata: input.reason ? { reason: input.reason } : undefined,
    })
    return getSupportSession(db, input.sessionId)!
  })
}

/** Expira sessão se now >= expires_at (idempotente). Não renova por uso. */
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
    closeOpenTerminationRequestsInTx(db, clock, sessionId, now)
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

/**
 * Resolve cookie opaco → sessão ativa.
 * Valida actor, sessão Clerk, membership do subject, tenant e TTL exacto.
 * Atualiza `last_used_at` sem alterar `expires_at` (DEC-032/033).
 */
export async function resolveSupportSessionByToken(
  db: AdminDb,
  clock: Clock,
  input: {
    sessionToken: string
    actorClerkUserId: string
    actorClerkSessionId: string
    /** Tenant declarado pelo cliente — forja ≠ sessão. */
    claimedTenantId?: string
    /** Subject declarado pelo cliente — forja ≠ sessão. */
    claimedSubjectClerkUserId?: string
  },
): Promise<SupportSessionRow> {
  assertAdminSchemaReady(db)
  const tokenHash = await hashToken(input.sessionToken)
  const now = clock.nowMs()

  const row = db.get<{ id: string }>(
    `SELECT id FROM support_sessions WHERE token_hash = ?`,
    tokenHash,
  )
  if (!row) {
    throw new ForbiddenError('support_cookie_invalid', 'Cookie de suporte inválido')
  }

  let session = expireSupportSessionIfNeeded(db, clock, row.id)
  if (session.status !== 'active') {
    throw new ForbiddenError('support_session_not_active', 'Sessão de suporte inativa')
  }
  if (session.actorClerkUserId !== input.actorClerkUserId) {
    throw new ForbiddenError('support_actor_mismatch', 'Cookie não pertence ao actor')
  }
  if (session.actorClerkSessionId !== input.actorClerkSessionId) {
    throw new ForbiddenError(
      'support_clerk_session_mismatch',
      'Cookie vinculado a outra sessão Clerk',
    )
  }
  if (input.claimedTenantId && input.claimedTenantId !== session.tenantId) {
    throw new ForbiddenError('support_tenant_forged', 'Tenant forjado')
  }
  if (
    input.claimedSubjectClerkUserId
    && input.claimedSubjectClerkUserId !== session.subjectClerkUserId
  ) {
    throw new ForbiddenError('support_subject_forged', 'Subject forjado')
  }

  const tenant = getTenant(db, session.tenantId)
  if (!tenant || tenant.status !== 'active') {
    revokeSupportSession(db, clock, {
      sessionId: session.id,
      actorClerkUserId: session.actorClerkUserId,
      reason: 'tenant_not_active',
    })
    throw new ForbiddenError('tenant_not_active', 'Tenant inativo')
  }

  const subject = getMembership(db, session.tenantId, session.subjectClerkUserId)
  if (!subject || subject.status !== 'active') {
    revokeSupportSession(db, clock, {
      sessionId: session.id,
      actorClerkUserId: session.actorClerkUserId,
      reason: 'subject_membership_revoked',
    })
    throw new ForbiddenError('subject_not_member', 'Subject sem membership ativo')
  }

  if (now >= session.expiresAt) {
    session = expireSupportSessionIfNeeded(db, clock, session.id)
    throw new ForbiddenError('support_session_expired', 'Sessão expirada')
  }

  // Touch sem renovar TTL.
  db.run(
    `UPDATE support_sessions SET last_used_at = ? WHERE id = ? AND status = 'active'`,
    now,
    session.id,
  )
  return getSupportSession(db, session.id)!
}

/** Capacidades iniciais: só leitura/diagnóstico até política explícita (ADR-0007). */
const SUPPORT_ALLOWED_OPS = new Set([
  'support.session.read',
  'support.diagnostics.read',
  'clinic.context.read',
])

export function assertSupportOperationAllowed(
  session: SupportSessionRow,
  operation: string,
): void {
  if (!SUPPORT_ALLOWED_OPS.has(operation)) {
    throw new ForbiddenError(
      'support_write_blocked',
      'Escrita sensível bloqueada até política de capacidades',
    )
  }
  // Intersecção mínima: scope de leitura + role atual do subject (revalidada no caller).
  if (!session.scope.includes('read') && session.scope !== 'read_diagnostics') {
    throw new ForbiddenError('support_scope_denied', 'Escopo de suporte insuficiente')
  }
}

export function listActiveSupportSessionsForTenant(
  db: AdminDb,
  clock: Clock,
  tenantId: string,
): SupportSessionRow[] {
  assertAdminSchemaReady(db)
  const rows = db.all<{ id: string }>(
    `SELECT id FROM support_sessions WHERE tenant_id = ? AND status = 'active'
     ORDER BY activated_at DESC`,
    tenantId,
  )
  return rows
    .map((r) => expireSupportSessionIfNeeded(db, clock, r.id))
    .filter((s) => s.status === 'active')
}

export function getActiveSupportSessionForSubject(
  db: AdminDb,
  clock: Clock,
  tenantId: string,
  subjectClerkUserId: string,
): SupportSessionRow | undefined {
  assertAdminSchemaReady(db)
  const row = db.get<{ id: string }>(
    `SELECT id FROM support_sessions
     WHERE tenant_id = ? AND subject_clerk_user_id = ? AND status = 'active'
     ORDER BY activated_at DESC LIMIT 1`,
    tenantId,
    subjectClerkUserId,
  )
  if (!row) return undefined
  const session = expireSupportSessionIfNeeded(db, clock, row.id)
  return session.status === 'active' ? session : undefined
}

export type SupportTerminationRow = {
  id: string
  supportSessionId: string
  tenantId: string
  requestedBySubjectClerkUserId: string
  requestedAt: number
  status: 'pending' | 'accepted' | 'declined' | 'closed_with_session'
  decidedByOwnerClerkUserId: string | null
  decidedAt: number | null
}

export function getSupportTerminationRequest(
  db: AdminDb,
  id: string,
): SupportTerminationRow | undefined {
  assertAdminSchemaReady(db)
  const row = db.get<{
    id: string
    support_session_id: string
    tenant_id: string
    requested_by_subject_clerk_user_id: string
    requested_at: number
    status: string
    decided_by_owner_clerk_user_id: string | null
    decided_at: number | null
  }>(
    `SELECT id, support_session_id, tenant_id, requested_by_subject_clerk_user_id,
            requested_at, status, decided_by_owner_clerk_user_id, decided_at
     FROM support_termination_requests WHERE id = ?`,
    id,
  )
  if (!row) return undefined
  return {
    id: row.id,
    supportSessionId: row.support_session_id,
    tenantId: row.tenant_id,
    requestedBySubjectClerkUserId: row.requested_by_subject_clerk_user_id,
    requestedAt: row.requested_at,
    status: row.status as SupportTerminationRow['status'],
    decidedByOwnerClerkUserId: row.decided_by_owner_clerk_user_id,
    decidedAt: row.decided_at,
  }
}

export function requestSupportTermination(
  db: AdminDb,
  clock: Clock,
  input: { sessionId: string; subjectClerkUserId: string },
): { id: string; status: string; created: boolean } {
  assertAdminSchemaReady(db)
  let session = getSupportSession(db, input.sessionId)
  if (!session) throw new NotFoundError('support_session_not_found', 'Sessão inexistente')
  session = expireSupportSessionIfNeeded(db, clock, session.id)
  if (session.status !== 'active') {
    throw new ConflictError('support_session_not_active', 'Sessão não ativa')
  }
  if (session.subjectClerkUserId !== input.subjectClerkUserId) {
    throw new ForbiddenError('not_session_subject', 'Apenas o subject pode pedir encerramento')
  }
  const membership = getMembership(db, session.tenantId, input.subjectClerkUserId)
  if (!membership || membership.status !== 'active') {
    throw new ForbiddenError('subject_not_member', 'Subject sem membership ativo')
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

/**
 * DEC-037: owner decide Encerrar (revoga DEC-034) ou Manter (sem pausa/TTL).
 */
export function decideSupportTermination(
  db: AdminDb,
  clock: Clock,
  input: {
    terminationRequestId: string
    ownerClerkUserId: string
    decision: 'end' | 'keep'
  },
): {
  termination: SupportTerminationRow
  session: SupportSessionRow
} {
  assertAdminSchemaReady(db)
  const preview = getSupportTerminationRequest(db, input.terminationRequestId)
  if (!preview) {
    throw new NotFoundError('termination_request_not_found', 'Pedido de encerramento inexistente')
  }
  requireActiveOwner(db, preview.tenantId, input.ownerClerkUserId)

  const now = clock.nowMs()
  return db.immediate(() => {
    const current = getSupportTerminationRequest(db, input.terminationRequestId)
    if (!current || current.status !== 'pending') {
      throw new ConflictError('termination_not_pending', 'Pedido de encerramento não pendente')
    }

    let session = getSupportSession(db, current.supportSessionId)
    if (!session) throw new NotFoundError('support_session_not_found', 'Sessão inexistente')
    if (session.status === 'active' && now >= session.expiresAt) {
      session = expireSupportSessionIfNeeded(db, clock, session.id)
    }

    if (input.decision === 'keep') {
      if (session.status !== 'active') {
        throw new ConflictError('support_session_not_active', 'Sessão não ativa')
      }
      const declined = db.run(
        `UPDATE support_termination_requests
         SET status = 'declined', decided_by_owner_clerk_user_id = ?, decided_at = ?
         WHERE id = ? AND status = 'pending'`,
        input.ownerClerkUserId,
        now,
        current.id,
      )
      if (declined.changes !== 1) {
        throw new ConflictError('termination_decide_conflict', 'Decisão concorrente negada')
      }
      writeAudit(db, clock, {
        actorClerkUserId: input.ownerClerkUserId,
        subjectClerkUserId: session.subjectClerkUserId,
        tenantId: session.tenantId,
        action: 'support.termination.keep',
        objectType: 'support_termination_request',
        objectId: current.id,
        outcome: 'success',
        supportSessionId: session.id,
      })
      return {
        termination: getSupportTerminationRequest(db, current.id)!,
        session: getSupportSession(db, session.id)!,
      }
    }

    // end → aceitar + revogar (DEC-034). Sessão já encerrada: só fecha o pedido.
    const accepted = db.run(
      `UPDATE support_termination_requests
       SET status = 'accepted', decided_by_owner_clerk_user_id = ?, decided_at = ?
       WHERE id = ? AND status = 'pending'`,
      input.ownerClerkUserId,
      now,
      current.id,
    )
    if (accepted.changes !== 1) {
      throw new ConflictError('termination_decide_conflict', 'Decisão concorrente negada')
    }

    if (session.status === 'active') {
      const revoked = db.run(
        `UPDATE support_sessions
         SET status = 'revoked', revoked_at = ?, revoked_by_clerk_user_id = ?, ended_at = ?,
             handoff_hash = NULL
         WHERE id = ? AND status = 'active'`,
        now,
        input.ownerClerkUserId,
        now,
        session.id,
      )
      if (revoked.changes === 1) {
        writeAudit(db, clock, {
          actorClerkUserId: input.ownerClerkUserId,
          subjectClerkUserId: session.subjectClerkUserId,
          tenantId: session.tenantId,
          action: 'support.session.revoke',
          objectType: 'support_session',
          objectId: session.id,
          outcome: 'success',
          supportSessionId: session.id,
          metadata: { reason: 'termination_accepted' },
        })
      }
    }

    writeAudit(db, clock, {
      actorClerkUserId: input.ownerClerkUserId,
      subjectClerkUserId: session.subjectClerkUserId,
      tenantId: session.tenantId,
      action: 'support.termination.end',
      objectType: 'support_termination_request',
      objectId: current.id,
      outcome: 'success',
      supportSessionId: session.id,
    })

    return {
      termination: getSupportTerminationRequest(db, current.id)!,
      session: getSupportSession(db, session.id)!,
    }
  })
}

/**
 * DEC-026/AC-24: membership do subject revogada → cortar sessões ativas nesse tenant.
 * Não afeta Clerk nem outros tenants.
 */
export function revokeSupportSessionsForSubject(
  db: AdminDb,
  clock: Clock,
  input: {
    tenantId: string
    subjectClerkUserId: string
    actorClerkUserId: string
  },
): string[] {
  assertAdminSchemaReady(db)
  const now = clock.nowMs()
  return db.immediate(() => {
    const rows = db.all<{ id: string }>(
      `SELECT id FROM support_sessions
       WHERE tenant_id = ? AND subject_clerk_user_id = ? AND status = 'active'`,
      input.tenantId,
      input.subjectClerkUserId,
    )
    const revokedIds: string[] = []
    for (const row of rows) {
      const result = db.run(
        `UPDATE support_sessions
         SET status = 'revoked', revoked_at = ?, revoked_by_clerk_user_id = ?, ended_at = ?,
             handoff_hash = NULL
         WHERE id = ? AND status = 'active'`,
        now,
        input.actorClerkUserId,
        now,
        row.id,
      )
      if (result.changes === 1) {
        closeOpenTerminationRequestsInTx(db, clock, row.id, now)
        writeAudit(db, clock, {
          actorClerkUserId: input.actorClerkUserId,
          subjectClerkUserId: input.subjectClerkUserId,
          tenantId: input.tenantId,
          action: 'support.session.revoke',
          objectType: 'support_session',
          objectId: row.id,
          outcome: 'success',
          supportSessionId: row.id,
          metadata: { reason: 'subject_membership_revoked' },
        })
        revokedIds.push(row.id)
      }
    }
    return revokedIds
  })
}
