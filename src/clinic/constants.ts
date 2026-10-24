/** Versão alvo do schema SQLite por instância do Clinic DO (issue #20). */
export const CLINIC_SCHEMA_VERSION = 1

/** Nome da migração fundação — distinto das migrations de classe Wrangler. */
export const CLINIC_MIGRATION_NAMES = {
  1: '0001_clinic_foundation',
} as const

/** Prefixos sintéticos permitidos no harness até auth Clerk (#21). */
export const SYNTHETIC_TENANT_PREFIX = 'clinic-demo-'

export const OUTBOX_STATES = [
  'pending',
  'publishing',
  'published',
  'failed',
  'acknowledged',
] as const

export type OutboxState = (typeof OUTBOX_STATES)[number]

export const INBOUND_STATES = ['received', 'processed', 'duplicate'] as const

export type InboundState = (typeof INBOUND_STATES)[number]
