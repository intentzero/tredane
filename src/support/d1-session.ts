/**
 * Ciclo da sessão de suporte sobre `AsyncAdminDb` (#853, ADR-0017 §6, DEC-195).
 *
 * Espelha `src/db/admin/support.ts` (store síncrono) para o D1 de produção, onde estas rotas respondiam 503.
 * Sem transações interativas: cada transição é um `UPDATE … WHERE status = 'active'` (ou um `INSERT … SELECT`
 * condicional) e `changes = 1` é a barreira de concorrência. A auditoria grava-se a seguir à transição.
 * O mesmo SQL corre no D1 (`fromD1`) e nos testes (`asyncFromSync`).
 */
import type { Clock } from '../db/clock'
import { SUPPORT_SESSION_TTL_MS } from '../db/admin/constants'
import type { AsyncAdminDb } from '../db/admin/async-store'
import { ConflictError, ForbiddenError, NotFoundError } from '../db/admin/errors'
import { newId } from '../db/admin/ids'
import { generateOpaqueToken, hashToken } from '../db/tokens'
import {
  mapRequest,
  mapSession,
  type ActivatedSupport,
  type ConsumedHandoff,
  type SupportRequestRow,
  type SupportSessionRow,
} from '../db/admin/support'

const REQUEST_SELECT = `
  SELECT id, tenant_id, actor_clerk_user_id, subject_clerk_user_id, reason, scope, status,
         decided_by_owner_clerk_user_id, decided_at, created_at, expires_at
  FROM support_access_requests`

const SESSION_SELECT = `
  SELECT id, support_access_request_id, approved_by_owner_clerk_user_id, actor_clerk_user_id,
         actor_clerk_session_id, subject_clerk_user_id, tenant_id, reason, scope, status,
         created_at, activated_at, expires_at, revoked_at, revoked_by_clerk_user_id, ended_at
  FROM support_sessions`

type RequestRaw = Parameters<typeof mapRequest>[0]
type SessionRaw = Parameters<typeof mapSession>[0]

export async function getSupportRequestAsync(db: AsyncAdminDb, id: string): Promise<SupportRequestRow | undefined> {
  const row = await db.get<RequestRaw>(`${REQUEST_SELECT} WHERE id = ?`, id)
  return row ? mapRequest(row) : undefined
}

export async function getSupportSessionAsync(db: AsyncAdminDb, id: string): Promise<SupportSessionRow | undefined> {
  const row = await db.get<SessionRaw>(`${SESSION_SELECT} WHERE id = ?`, id)
  return row ? mapSession(row) : undefined
}

async function audit(
  db: AsyncAdminDb,
  input: {
    actorClerkUserId: string
    subjectClerkUserId?: string | null
    tenantId: string | null
    action: string
    objectType: string
    objectId: string
    supportSessionId?: string | null
    metadata?: Record<string, unknown>
    now: number
  },
): Promise<void> {
  await db.run(
    `INSERT INTO central_audit_events (
       id, occurred_at, actor_clerk_user_id, subject_clerk_user_id, tenant_id,
       action, object_type, object_id, outcome, support_session_id, metadata_json
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'success', ?, ?)`,
    newId('aud'),
    input.now,
    input.actorClerkUserId,
    input.subjectClerkUserId ?? null,
    input.tenantId,
    input.action,
    input.objectType,
    input.objectId,
    input.supportSessionId ?? null,
    input.metadata ? JSON.stringify(input.metadata) : null,
  )
}

/** Um pedido de fim a pedido do subject fecha-se com a sessão (DEC-037). */
async function closeOpenTerminations(db: AsyncAdminDb, sessionId: string, tenantId: string, now: number): Promise<void> {
  const open = await db.all<{ id: string }>(
    `SELECT id FROM support_termination_requests WHERE support_session_id = ? AND status = 'pending'`,
    sessionId,
  )
  for (const row of open) {
    const r = await db.run(
      `UPDATE support_termination_requests SET status = 'closed_with_session', decided_at = ?
       WHERE id = ? AND status = 'pending'`,
      now,
      row.id,
    )
    if (r.changes === 1) {
      await audit(db, {
        actorClerkUserId: 'system:support',
        tenantId,
        action: 'support.termination.close_with_session',
        objectType: 'support_termination_request',
        objectId: row.id,
        supportSessionId: sessionId,
        now,
      })
    }
  }
}

/** DEC-032: ativa a sessão de 30 min a partir de um pedido já aprovado, numa só instrução condicional. */
export async function activateSupportSessionAsync(
  db: AsyncAdminDb,
  clock: Clock,
  input: { requestId: string; actorClerkUserId: string; actorClerkSessionId: string },
): Promise<ActivatedSupport> {
  const preview = await getSupportRequestAsync(db, input.requestId)
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

  // Atómico: só insere se o pedido está aprovado, com aprovador, sem sessão, com subject membro ativo e clínica ativa.
  const inserted = await db.run(
    `INSERT INTO support_sessions (
       id, support_access_request_id, approved_by_owner_clerk_user_id, token_hash, handoff_hash,
       actor_clerk_user_id, actor_clerk_session_id, subject_clerk_user_id, tenant_id,
       reason, scope, status, created_at, activated_at, expires_at,
       revoked_at, revoked_by_clerk_user_id, ended_at, last_used_at
     )
     SELECT ?, r.id, r.decided_by_owner_clerk_user_id, ?, ?,
            r.actor_clerk_user_id, ?, r.subject_clerk_user_id, r.tenant_id,
            r.reason, r.scope, 'active', ?, ?, ?, NULL, NULL, NULL, NULL
     FROM support_access_requests r
     WHERE r.id = ?
       AND r.status = 'approved'
       AND r.decided_by_owner_clerk_user_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM support_sessions s WHERE s.support_access_request_id = r.id)
       AND EXISTS (SELECT 1 FROM tenant_memberships m
                   WHERE m.tenant_id = r.tenant_id AND m.clerk_user_id = r.subject_clerk_user_id AND m.status = 'active')
       AND EXISTS (SELECT 1 FROM tenants t WHERE t.id = r.tenant_id AND t.status = 'active')`,
    sessionId,
    tokenHash,
    handoffHash,
    input.actorClerkSessionId,
    now,
    now,
    now + SUPPORT_SESSION_TTL_MS,
    input.requestId,
  )

  if (inserted.changes !== 1) {
    // Diagnostica porquê, para devolver o mesmo código que o store síncrono.
    const current = await getSupportRequestAsync(db, input.requestId)
    if (!current || current.status !== 'approved') {
      throw new ConflictError('support_request_not_approved', 'Pedido não aprovado')
    }
    if (!current.decidedByOwnerClerkUserId) {
      throw new ConflictError('support_request_missing_approver', 'Aprovador em falta')
    }
    if (await db.get(`SELECT id FROM support_sessions WHERE support_access_request_id = ?`, current.id)) {
      throw new ConflictError('support_session_already_active', 'Sessão já criada para este pedido')
    }
    const tenant = await db.get<{ status: string }>(`SELECT status FROM tenants WHERE id = ?`, current.tenantId)
    if (!tenant || tenant.status !== 'active') throw new ForbiddenError('tenant_not_active', 'Tenant inativo')
    throw new ForbiddenError('subject_not_member', 'Subject sem membership ativo')
  }

  const session = (await getSupportSessionAsync(db, sessionId))!
  await audit(db, {
    actorClerkUserId: session.actorClerkUserId,
    subjectClerkUserId: session.subjectClerkUserId,
    tenantId: session.tenantId,
    action: 'support.session.activate',
    objectType: 'support_session',
    objectId: sessionId,
    supportSessionId: sessionId,
    metadata: { approvedBy: session.approvedByOwnerClerkUserId },
    now,
  })
  return { request: (await getSupportRequestAsync(db, input.requestId))!, session, handoffCode, sessionToken }
}

/** Expira a sessão se `now >= expires_at` (idempotente; nunca renova por uso). */
export async function expireSupportSessionIfNeededAsync(
  db: AsyncAdminDb,
  clock: Clock,
  sessionId: string,
): Promise<SupportSessionRow> {
  const now = clock.nowMs()
  const current = await getSupportSessionAsync(db, sessionId)
  if (!current) throw new NotFoundError('support_session_not_found', 'Sessão inexistente')
  if (current.status !== 'active' || now < current.expiresAt) return current
  const r = await db.run(
    `UPDATE support_sessions SET status = 'expired', ended_at = ?, handoff_hash = NULL
     WHERE id = ? AND status = 'active'`,
    now,
    sessionId,
  )
  if (r.changes === 1) {
    await closeOpenTerminations(db, sessionId, current.tenantId, now)
    await audit(db, {
      actorClerkUserId: current.actorClerkUserId,
      subjectClerkUserId: current.subjectClerkUserId,
      tenantId: current.tenantId,
      action: 'support.session.expire',
      objectType: 'support_session',
      objectId: sessionId,
      supportSessionId: sessionId,
      now,
    })
  }
  return (await getSupportSessionAsync(db, sessionId))!
}

/** DEC-034: o actor encerra a sua sessão, ou uma owner ativa da clínica revoga-a. */
export async function revokeSupportSessionAsync(
  db: AsyncAdminDb,
  clock: Clock,
  input: {
    sessionId: string
    actorClerkUserId: string
    asOwner?: boolean
    reason?: string
    /** Rota de clínica: a sessão tem de ser desta clínica (verificado **antes** de revogar). */
    expectedTenantId?: string
  },
): Promise<SupportSessionRow> {
  const preview = await getSupportSessionAsync(db, input.sessionId)
  if (!preview) throw new NotFoundError('support_session_not_found', 'Sessão inexistente')
  if (input.expectedTenantId && preview.tenantId !== input.expectedTenantId) {
    throw new ForbiddenError('support_tenant_mismatch', 'Sessão de outro tenant')
  }
  if (input.asOwner) {
    const owner = await db.get<{ ok: number }>(
      `SELECT 1 AS ok FROM tenant_memberships m INNER JOIN tenants t ON t.id = m.tenant_id
       WHERE m.tenant_id = ? AND m.clerk_user_id = ? AND m.role = 'owner' AND m.status = 'active' AND t.status = 'active'`,
      preview.tenantId,
      input.actorClerkUserId,
    )
    if (!owner) throw new ForbiddenError('owner_required', 'Owner ativo do tenant exigido')
  } else if (preview.actorClerkUserId !== input.actorClerkUserId) {
    throw new ForbiddenError('not_session_actor', 'Apenas o actor da sessão pode encerrar assim')
  }

  const now = clock.nowMs()
  const r = await db.run(
    `UPDATE support_sessions
     SET status = 'revoked', revoked_at = ?, revoked_by_clerk_user_id = ?, ended_at = ?, handoff_hash = NULL
     WHERE id = ? AND status = 'active'`,
    now,
    input.actorClerkUserId,
    now,
    input.sessionId,
  )
  if (r.changes !== 1) throw new ConflictError('support_revoke_conflict', 'Revogação não aplicada')
  await closeOpenTerminations(db, input.sessionId, preview.tenantId, now)
  await audit(db, {
    actorClerkUserId: input.actorClerkUserId,
    subjectClerkUserId: preview.subjectClerkUserId,
    tenantId: preview.tenantId,
    action: 'support.session.revoke',
    objectType: 'support_session',
    objectId: input.sessionId,
    supportSessionId: input.sessionId,
    metadata: input.reason ? { reason: input.reason } : undefined,
    now,
  })
  return (await getSupportSessionAsync(db, input.sessionId))!
}

/** Troca o código de handoff (uso único) por um token de cookie novo. */
export async function consumeSupportHandoffAsync(
  db: AsyncAdminDb,
  clock: Clock,
  input: {
    handoffCode: string
    actorClerkUserId: string
    actorClerkSessionId: string
    claimedTenantId?: string
    claimedSubjectClerkUserId?: string
  },
): Promise<ConsumedHandoff> {
  const now = clock.nowMs()
  const handoffHash = await hashToken(input.handoffCode)
  const sessionToken = generateOpaqueToken()
  const tokenHash = await hashToken(sessionToken)

  const row = await db.get<{
    id: string
    actor_clerk_user_id: string
    actor_clerk_session_id: string
    tenant_id: string
    subject_clerk_user_id: string
    status: string
    expires_at: number
  }>(
    `SELECT id, actor_clerk_user_id, actor_clerk_session_id, tenant_id, subject_clerk_user_id, status, expires_at
     FROM support_sessions WHERE handoff_hash = ?`,
    handoffHash,
  )
  if (!row || row.status !== 'active') throw new ConflictError('handoff_invalid', 'Handoff inválido ou já consumido')
  if (row.actor_clerk_user_id !== input.actorClerkUserId) {
    throw new ForbiddenError('handoff_actor_mismatch', 'Handoff não pertence ao actor')
  }
  if (row.actor_clerk_session_id !== input.actorClerkSessionId) {
    throw new ForbiddenError('handoff_clerk_session_mismatch', 'Handoff vinculado a outra sessão Clerk do actor')
  }
  if (input.claimedTenantId && input.claimedTenantId !== row.tenant_id) {
    throw new ForbiddenError('support_tenant_forged', 'Tenant forjado')
  }
  if (input.claimedSubjectClerkUserId && input.claimedSubjectClerkUserId !== row.subject_clerk_user_id) {
    throw new ForbiddenError('support_subject_forged', 'Subject forjado')
  }
  if (now >= Number(row.expires_at)) {
    await expireSupportSessionIfNeededAsync(db, clock, row.id)
    throw new ConflictError('support_session_expired', 'Sessão expirada')
  }

  // Uso único: só um consumo concorrente obtém changes = 1.
  const consumed = await db.run(
    `UPDATE support_sessions SET handoff_hash = NULL, token_hash = ?, last_used_at = ?
     WHERE id = ? AND status = 'active' AND handoff_hash = ?`,
    tokenHash,
    now,
    row.id,
    handoffHash,
  )
  if (consumed.changes !== 1) throw new ConflictError('handoff_consume_conflict', 'Consumo concorrente negado')

  const session = (await getSupportSessionAsync(db, row.id))!
  await audit(db, {
    actorClerkUserId: input.actorClerkUserId,
    subjectClerkUserId: session.subjectClerkUserId,
    tenantId: session.tenantId,
    action: 'support.handoff.consume',
    objectType: 'support_session',
    objectId: row.id,
    supportSessionId: row.id,
    now,
  })
  return { session, sessionToken }
}

/** Cookie opaco → sessão ativa, com todas as verificações do pedido atual (ADR-0007 §4). Não renova o prazo. */
export async function resolveSupportSessionByTokenAsync(
  db: AsyncAdminDb,
  clock: Clock,
  input: {
    sessionToken: string
    actorClerkUserId: string
    actorClerkSessionId: string
    claimedTenantId?: string
    claimedSubjectClerkUserId?: string
  },
): Promise<SupportSessionRow> {
  const tokenHash = await hashToken(input.sessionToken)
  const found = await db.get<{ id: string }>(`SELECT id FROM support_sessions WHERE token_hash = ?`, tokenHash)
  if (!found) throw new ForbiddenError('support_cookie_invalid', 'Cookie de suporte inválido')

  const session = await expireSupportSessionIfNeededAsync(db, clock, found.id)
  if (session.status !== 'active') throw new ForbiddenError('support_session_not_active', 'Sessão de suporte inativa')
  if (session.actorClerkUserId !== input.actorClerkUserId) {
    throw new ForbiddenError('support_actor_mismatch', 'Cookie não pertence ao actor')
  }
  if (session.actorClerkSessionId !== input.actorClerkSessionId) {
    throw new ForbiddenError('support_clerk_session_mismatch', 'Cookie vinculado a outra sessão Clerk')
  }
  if (input.claimedTenantId && input.claimedTenantId !== session.tenantId) {
    throw new ForbiddenError('support_tenant_forged', 'Tenant forjado')
  }
  if (input.claimedSubjectClerkUserId && input.claimedSubjectClerkUserId !== session.subjectClerkUserId) {
    throw new ForbiddenError('support_subject_forged', 'Subject forjado')
  }

  const tenant = await db.get<{ status: string }>(`SELECT status FROM tenants WHERE id = ?`, session.tenantId)
  if (!tenant || tenant.status !== 'active') {
    await revokeSupportSessionAsync(db, clock, { sessionId: session.id, actorClerkUserId: session.actorClerkUserId, reason: 'tenant_not_active' })
    throw new ForbiddenError('tenant_not_active', 'Tenant inativo')
  }
  const subject = await db.get<{ status: string }>(
    `SELECT status FROM tenant_memberships WHERE tenant_id = ? AND clerk_user_id = ?`,
    session.tenantId,
    session.subjectClerkUserId,
  )
  if (!subject || subject.status !== 'active') {
    await revokeSupportSessionAsync(db, clock, { sessionId: session.id, actorClerkUserId: session.actorClerkUserId, reason: 'subject_membership_revoked' })
    throw new ForbiddenError('subject_not_member', 'Subject sem membership ativo')
  }

  // Toque sem renovar o prazo (DEC-032/033).
  await db.run(`UPDATE support_sessions SET last_used_at = ? WHERE id = ? AND status = 'active'`, clock.nowMs(), session.id)
  return (await getSupportSessionAsync(db, session.id))!
}

/** A superadmin cancela o seu próprio pedido enquanto não há sessão ativa (pendente ou aprovado por ativar). */
export async function cancelSupportRequestAsync(
  db: AsyncAdminDb,
  clock: Clock,
  input: { requestId: string; actorClerkUserId: string },
): Promise<SupportRequestRow> {
  const preview = await getSupportRequestAsync(db, input.requestId)
  if (!preview) throw new NotFoundError('support_request_not_found', 'Pedido inexistente')
  if (preview.actorClerkUserId !== input.actorClerkUserId) {
    throw new ForbiddenError('not_request_actor', 'Apenas o actor do pedido o pode cancelar')
  }
  const now = clock.nowMs()
  const r = await db.run(
    `UPDATE support_access_requests SET status = 'cancelled', cancelled_at = ?
     WHERE id = ? AND status IN ('pending', 'approved')
       AND NOT EXISTS (SELECT 1 FROM support_sessions s WHERE s.support_access_request_id = support_access_requests.id)`,
    now,
    input.requestId,
  )
  if (r.changes !== 1) throw new ConflictError('support_request_not_cancellable', 'O pedido já não se pode cancelar')
  await audit(db, {
    actorClerkUserId: input.actorClerkUserId,
    subjectClerkUserId: preview.subjectClerkUserId,
    tenantId: preview.tenantId,
    action: 'support.request.cancel',
    objectType: 'support_access_request',
    objectId: input.requestId,
    now,
  })
  return (await getSupportRequestAsync(db, input.requestId))!
}
