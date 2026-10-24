import type { SupportRequestRow, SupportSessionRow, SupportTerminationRow } from '../db/admin'

/** Resposta HTTP sem PHI/credenciais — só metadados de decisão. */
export function serializeSupportRequest(row: SupportRequestRow) {
  return {
    id: row.id,
    tenantId: row.tenantId,
    actorClerkUserId: row.actorClerkUserId,
    subjectClerkUserId: row.subjectClerkUserId,
    reason: row.reason,
    scope: row.scope,
    status: row.status,
    decidedByOwnerClerkUserId: row.decidedByOwnerClerkUserId,
    decidedAt: row.decidedAt,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
  }
}

/** Sessão sem token/handoff — metadados para painel owners/subject/actor. */
export function serializeSupportSession(row: SupportSessionRow) {
  return {
    id: row.id,
    supportAccessRequestId: row.supportAccessRequestId,
    approvedByOwnerClerkUserId: row.approvedByOwnerClerkUserId,
    actorClerkUserId: row.actorClerkUserId,
    subjectClerkUserId: row.subjectClerkUserId,
    tenantId: row.tenantId,
    reason: row.reason,
    scope: row.scope,
    status: row.status,
    createdAt: row.createdAt,
    activatedAt: row.activatedAt,
    expiresAt: row.expiresAt,
    revokedAt: row.revokedAt,
    revokedByClerkUserId: row.revokedByClerkUserId,
    endedAt: row.endedAt,
  }
}

export function serializeTerminationRequest(row: SupportTerminationRow) {
  return {
    id: row.id,
    supportSessionId: row.supportSessionId,
    tenantId: row.tenantId,
    requestedBySubjectClerkUserId: row.requestedBySubjectClerkUserId,
    requestedAt: row.requestedAt,
    status: row.status,
    decidedByOwnerClerkUserId: row.decidedByOwnerClerkUserId,
    decidedAt: row.decidedAt,
  }
}
