/**
 * Domínio operacional do Clinic Durable Object (issue #20 / DEC-038).
 * Separado do D1 administrativo (`src/db/admin`) e da auth Clerk (#21).
 */
export { CLINIC_SCHEMA_VERSION, SYNTHETIC_TENANT_PREFIX } from './constants'
export {
  ClinicError,
  SchemaNotReadyError,
  TenantMismatchError,
  UnauthorizedCallerError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from './errors'
export * as clinicConfig from './config'
export { fromNodeSqlite, fromDurableObjectSql, type ClinicDb, type SqlValue } from './store'
export {
  runClinicMigrations,
  assertClinicSchemaReady,
  markClinicSchemaFailed,
  CLINIC_MIGRATIONS,
  type MigrationResult,
} from './migrations'
export {
  type ClinicCaller,
  type EventEnvelope,
  type ConsumerResult,
  type EntityRef,
  assertValidCaller,
  assertSyntheticTenantId,
  assertCallerTenant,
  workerCaller,
  queueCaller,
} from './envelopes'
export { bindOrAssertTenant, getBoundTenant, requireTenantMatch, type ClinicMeta } from './tenant'
export {
  upsertContact,
  getContact,
  listContacts,
  type ContactRow,
} from './contacts'
export {
  insertOutboxEvent,
  listPendingOutbox,
  drainOutbox,
  acknowledgeOutboxResult,
  toEventEnvelope,
  type OutboxRow,
  type OutboxPublisher,
} from './outbox'
export { recordInboundEvent, findInboundByKey, type InboundRow } from './inbound'
export { writeOperationalAudit, listOperationalAudit, type AuditRow } from './audit'
export {
  ingestContactMessage,
  publishPendingEffects,
  type IngestContactMessageInput,
  type IngestContactMessageResult,
} from './operations'
