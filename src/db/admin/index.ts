/**
 * Repositórios do D1 administrativo central (DEC-038).
 * Separados do domínio operacional do Clinic DO (#20).
 * Leituras HTTP autenticadas usam adaptadores async (#21).
 */
export { fromD1, asyncFromSync, type AsyncAdminDb } from './async-store'
export {
  getTenantAsync,
  listTenantsAsync,
  getMembershipAsync,
  listActiveMembershipsForUserAsync,
  resolveActiveTenantMembership,
  type AsyncTenantRow,
  type AsyncMembershipRow,
} from './async-queries'
export { ADMIN_SCHEMA_VERSION, LEGACY_OPERATIONAL_TABLES } from './constants'
export {
  INVITATION_TTL_MS,
  INVITATION_RESEND_COOLDOWN_MS,
  INVITATION_RESEND_WINDOW_MS,
  INVITATION_RESEND_MAX,
  SUPPORT_REQUEST_TTL_MS,
  SUPPORT_SESSION_TTL_MS,
} from './constants'
export { assertAdminSchemaReady } from './gate'
export { fromNodeSqlite, type AdminDb, type SqlValue } from './store'
export {
  AdminError,
  SchemaNotReadyError,
  ConflictError,
  NotFoundError,
  ForbiddenError,
} from './errors'
export { writeAudit, listAuditForTenant, type AuditEvent, type AuditWrite } from './audit'
export {
  getTenant,
  createTenant,
  updateTenant,
  suspendTenant,
  reactivateTenant,
  markTenantPendingDeletion,
  type TenantRow,
} from './tenants'
export {
  getMembership,
  listActiveMembershipsForUser,
  listMembersForTenant,
  requireActiveOwner,
  upsertMembership,
  upsertMembershipInTx,
  revokeMembership,
  type MembershipRow,
} from './memberships'
export {
  countActiveOwners,
  createTenantWithOwner,
  assignOwner,
  removeOwner,
  replaceOwner,
  listOwnersForTenant,
} from './owners'
export {
  getOpenDeletionCommand,
  listDeletionCommandsForTenant,
  enqueueDeletionCommand,
  type DeletionCommandRow,
} from './deletion-commands'
export {
  suspendTenantLifecycle,
  reactivateTenantLifecycle,
  markTenantPendingDeletionLifecycle,
  type LifecycleSideEffects,
} from './lifecycle'
export {
  createInvitation,
  resendInvitation,
  cancelInvitation,
  acceptInvitation,
  listPendingInvitationsForTenant,
  type InvitationRow,
  type IssuedInvitation,
} from './invitations'
export {
  createSupportAccessRequest,
  approveSupportRequest,
  rejectSupportRequest,
  consumeSupportHandoff,
  revokeSupportSession,
  expireSupportSessionIfNeeded,
  requestSupportTermination,
  getSupportRequest,
  getSupportSession,
  type SupportRequestRow,
  type SupportSessionRow,
  type ApprovedSupport,
} from './support'
export { adminTenantSnapshot, adminUserTenants } from './queries'
