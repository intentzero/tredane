import type { SupportRequestRow } from '../db/admin'

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
