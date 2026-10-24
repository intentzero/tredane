import { integer, primaryKey, sqliteTable, text, index, uniqueIndex } from 'drizzle-orm/sqlite-core'

/**
 * Schema D1 central (DEC-038 / ADR-0012).
 *
 * - Tabelas administrativas: tenants (ciclo de vida), memberships, convites,
 *   suporte e auditoria central — fonte de verdade neste D1.
 * - `services` / `professionals`: legado sintético da F0. NÃO são fonte operacional;
 *   o domínio operativo vive no SQLite do DO por clínica (#20). Mantidos sem
 *   alterar 0001; ver docs/implementation/f1-admin-d1.md.
 */

/** Ciclo de vida do tenant na Platform Admin (REQ-006). */
export const TENANT_STATUSES = ['active', 'suspended', 'pending_deletion'] as const
export type TenantStatus = (typeof TENANT_STATUSES)[number]

export const MEMBERSHIP_ROLES = ['owner', 'attendant'] as const
export type MembershipRole = (typeof MEMBERSHIP_ROLES)[number]

export const MEMBERSHIP_STATUSES = ['active', 'revoked'] as const
export type MembershipStatus = (typeof MEMBERSHIP_STATUSES)[number]

export const INVITATION_STATUSES = ['pending', 'accepted', 'cancelled', 'expired'] as const
export type InvitationStatus = (typeof INVITATION_STATUSES)[number]

export const SUPPORT_REQUEST_STATUSES = [
  'pending',
  'approved',
  'rejected',
  'expired',
  'cancelled',
] as const
export type SupportRequestStatus = (typeof SUPPORT_REQUEST_STATUSES)[number]

export const SUPPORT_SESSION_STATUSES = [
  'active',
  'expired',
  'revoked',
  'ended',
] as const
export type SupportSessionStatus = (typeof SUPPORT_SESSION_STATUSES)[number]

export const SUPPORT_TERMINATION_STATUSES = [
  'pending',
  'accepted',
  'declined',
  'closed_with_session',
] as const
export type SupportTerminationStatus = (typeof SUPPORT_TERMINATION_STATUSES)[number]

export const tenants = sqliteTable('tenants', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  timezone: text('timezone').notNull().default('America/Sao_Paulo'),
  status: text('status', { enum: TENANT_STATUSES }).notNull().default('active'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
  suspendedAt: integer('suspended_at'),
  pendingDeletionAt: integer('pending_deletion_at'),
}, (table) => [
  index('tenants_status_idx').on(table.status),
])

/**
 * Legado F0 — fixtures sintéticas. Não usar como catálogo operacional (DEC-038).
 * @deprecated domínio operacional no SQLite do Clinic DO
 */
export const services = sqliteTable('services', {
  id: text('id').notNull(),
  tenantId: text('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  durationMinutes: integer('duration_minutes').notNull(),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
}, (table) => [
  primaryKey({ columns: [table.tenantId, table.id] }),
  index('services_tenant_idx').on(table.tenantId),
])

/**
 * Legado F0 — fixtures sintéticas. Não usar como recurso de agenda (DEC-038).
 * @deprecated domínio operacional no SQLite do Clinic DO
 */
export const professionals = sqliteTable('professionals', {
  id: text('id').notNull(),
  tenantId: text('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  displayName: text('display_name').notNull(),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
}, (table) => [
  primaryKey({ columns: [table.tenantId, table.id] }),
  index('professionals_tenant_idx').on(table.tenantId),
])

/** Memberships N:N no D1 central (Confirmado, DEC-038). Sem Clerk Organizations. */
export const tenantMemberships = sqliteTable('tenant_memberships', {
  tenantId: text('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  clerkUserId: text('clerk_user_id').notNull(),
  role: text('role', { enum: MEMBERSHIP_ROLES }).notNull(),
  status: text('status', { enum: MEMBERSHIP_STATUSES }).notNull().default('active'),
  createdAt: integer('created_at').notNull(),
  revokedAt: integer('revoked_at'),
}, (table) => [
  primaryKey({ columns: [table.tenantId, table.clerkUserId] }),
  index('tenant_memberships_user_idx').on(table.clerkUserId),
  index('tenant_memberships_tenant_status_idx').on(table.tenantId, table.status),
])

/**
 * Convites de attendant (DEC-021–025 / ADR-0008).
 * Apenas `token_hash` é persistido — nunca o token em claro.
 */
export const tenantInvitations = sqliteTable('tenant_invitations', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  normalizedEmail: text('normalized_email').notNull(),
  role: text('role', { enum: ['attendant'] }).notNull().default('attendant'),
  issuedByClerkUserId: text('issued_by_clerk_user_id').notNull(),
  tokenHash: text('token_hash').notNull(),
  status: text('status', { enum: INVITATION_STATUSES }).notNull().default('pending'),
  issuedAt: integer('issued_at').notNull(),
  expiresAt: integer('expires_at').notNull(),
  acceptedAt: integer('accepted_at'),
  acceptedByClerkUserId: text('accepted_by_clerk_user_id'),
  cancelledAt: integer('cancelled_at'),
  cancelledByClerkUserId: text('cancelled_by_clerk_user_id'),
  lastResentAt: integer('last_resent_at'),
}, (table) => [
  index('tenant_invitations_tenant_email_idx').on(table.tenantId, table.normalizedEmail),
  index('tenant_invitations_tenant_status_idx').on(table.tenantId, table.status),
  uniqueIndex('tenant_invitations_token_hash_uidx').on(table.tokenHash),
])

/** Histórico de reenvios para quota DEC-024 (janela móvel 24h / cooldown 10min). */
export const tenantInvitationResends = sqliteTable('tenant_invitation_resends', {
  id: text('id').primaryKey(),
  invitationId: text('invitation_id').notNull().references(() => tenantInvitations.id, { onDelete: 'cascade' }),
  tenantId: text('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  normalizedEmail: text('normalized_email').notNull(),
  resentByClerkUserId: text('resent_by_clerk_user_id').notNull(),
  resentAt: integer('resent_at').notNull(),
}, (table) => [
  index('tenant_invitation_resends_quota_idx').on(
    table.tenantId,
    table.normalizedEmail,
    table.resentAt,
  ),
])

/** Pedidos de suporte pendentes de aprovação do owner (DEC-029–031). */
export const supportAccessRequests = sqliteTable('support_access_requests', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  actorClerkUserId: text('actor_clerk_user_id').notNull(),
  subjectClerkUserId: text('subject_clerk_user_id').notNull(),
  reason: text('reason').notNull(),
  scope: text('scope').notNull(),
  status: text('status', { enum: SUPPORT_REQUEST_STATUSES }).notNull().default('pending'),
  decidedByOwnerClerkUserId: text('decided_by_owner_clerk_user_id'),
  decidedAt: integer('decided_at'),
  createdAt: integer('created_at').notNull(),
  expiresAt: integer('expires_at').notNull(),
  cancelledAt: integer('cancelled_at'),
}, (table) => [
  index('support_access_requests_tenant_status_idx').on(table.tenantId, table.status),
  index('support_access_requests_actor_idx').on(table.actorClerkUserId),
])

/**
 * Sessões próprias de suporte (ADR-0007 / DEC-032–034).
 * Apenas `token_hash` / handoff hash — nunca o segredo em claro.
 */
export const supportSessions = sqliteTable('support_sessions', {
  id: text('id').primaryKey(),
  supportAccessRequestId: text('support_access_request_id').notNull()
    .references(() => supportAccessRequests.id, { onDelete: 'cascade' }),
  approvedByOwnerClerkUserId: text('approved_by_owner_clerk_user_id').notNull(),
  tokenHash: text('token_hash').notNull(),
  handoffHash: text('handoff_hash'),
  actorClerkUserId: text('actor_clerk_user_id').notNull(),
  actorClerkSessionId: text('actor_clerk_session_id').notNull(),
  subjectClerkUserId: text('subject_clerk_user_id').notNull(),
  tenantId: text('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  reason: text('reason').notNull(),
  scope: text('scope').notNull(),
  status: text('status', { enum: SUPPORT_SESSION_STATUSES }).notNull().default('active'),
  createdAt: integer('created_at').notNull(),
  activatedAt: integer('activated_at').notNull(),
  expiresAt: integer('expires_at').notNull(),
  revokedAt: integer('revoked_at'),
  revokedByClerkUserId: text('revoked_by_clerk_user_id'),
  endedAt: integer('ended_at'),
  lastUsedAt: integer('last_used_at'),
}, (table) => [
  index('support_sessions_tenant_status_idx').on(table.tenantId, table.status),
  index('support_sessions_actor_idx').on(table.actorClerkUserId),
  index('support_sessions_subject_idx').on(table.subjectClerkUserId),
  uniqueIndex('support_sessions_token_hash_uidx').on(table.tokenHash),
  uniqueIndex('support_sessions_request_uidx').on(table.supportAccessRequestId),
])

/** Pedido de encerramento pelo subject (DEC-037). */
export const supportTerminationRequests = sqliteTable('support_termination_requests', {
  id: text('id').primaryKey(),
  supportSessionId: text('support_session_id').notNull()
    .references(() => supportSessions.id, { onDelete: 'cascade' }),
  tenantId: text('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  requestedBySubjectClerkUserId: text('requested_by_subject_clerk_user_id').notNull(),
  requestedAt: integer('requested_at').notNull(),
  status: text('status', { enum: SUPPORT_TERMINATION_STATUSES }).notNull().default('pending'),
  decidedByOwnerClerkUserId: text('decided_by_owner_clerk_user_id'),
  decidedAt: integer('decided_at'),
}, (table) => [
  index('support_termination_session_status_idx').on(table.supportSessionId, table.status),
])

/**
 * Auditoria administrativa/de suporte central (sem conteúdo clínico).
 * Cobre platform_admin_events + support_audit_events dos ADRs.
 */
export const centralAuditEvents = sqliteTable('central_audit_events', {
  id: text('id').primaryKey(),
  occurredAt: integer('occurred_at').notNull(),
  actorClerkUserId: text('actor_clerk_user_id').notNull(),
  subjectClerkUserId: text('subject_clerk_user_id'),
  tenantId: text('tenant_id'),
  action: text('action').notNull(),
  objectType: text('object_type').notNull(),
  objectId: text('object_id'),
  outcome: text('outcome').notNull(),
  supportSessionId: text('support_session_id'),
  /** Metadados não clínicos (JSON). Nunca tokens, PHI ou corpos de mensagem. */
  metadataJson: text('metadata_json'),
}, (table) => [
  index('central_audit_tenant_occurred_idx').on(table.tenantId, table.occurredAt),
  index('central_audit_actor_occurred_idx').on(table.actorClerkUserId, table.occurredAt),
  index('central_audit_action_occurred_idx').on(table.action, table.occurredAt),
])

/** Versão de schema administrativo exigida pelos repositórios (impede uso parcial). */
export const adminSchemaState = sqliteTable('admin_schema_state', {
  id: integer('id').primaryKey(),
  version: integer('version').notNull(),
  appliedAt: integer('applied_at').notNull(),
})

/**
 * Comando durável de exclusão lógica (#24 / REQ-006).
 * A tarefa de retenção/expurgo consome `queued`; não é destruição imediata.
 */
export const DELETION_COMMAND_STATUSES = [
  'queued',
  'in_progress',
  'completed',
  'cancelled',
] as const
export type DeletionCommandStatus = (typeof DELETION_COMMAND_STATUSES)[number]

export const tenantDeletionCommands = sqliteTable('tenant_deletion_commands', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  status: text('status', { enum: DELETION_COMMAND_STATUSES }).notNull().default('queued'),
  requestedByClerkUserId: text('requested_by_clerk_user_id').notNull(),
  requestedAt: integer('requested_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
  /** Metadados não clínicos (JSON). Sem PHI/tokens. */
  payloadJson: text('payload_json'),
}, (table) => [
  index('tenant_deletion_commands_tenant_idx').on(table.tenantId),
  index('tenant_deletion_commands_status_idx').on(table.status),
])
