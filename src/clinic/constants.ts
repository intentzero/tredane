/** Versão alvo do schema SQLite por instância do Clinic DO (issue #20/#23/#28). */
export const CLINIC_SCHEMA_VERSION = 3

/** Nome da migração fundação — distinto das migrations de classe Wrangler. */
export const CLINIC_MIGRATION_NAMES = {
  1: '0001_clinic_foundation',
  2: '0002_realtime_fence',
  3: '0003_clinic_config',
} as const

/** Fuso padrão da clínica (DEC-008). */
export const DEFAULT_CLINIC_TIMEZONE = 'America/Sao_Paulo'

/** Grade de agenda: início, duração e intervalo em múltiplos de 15 min (DEC-008). */
export const SCHEDULE_GRID_MINUTES = 15

export const BLOCK_REASONS = [
  'folga',
  'ferias',
  'feriado',
  'manutencao',
  'outro',
] as const

export type BlockReason = (typeof BLOCK_REASONS)[number]

export const RESOURCE_KINDS = ['professional', 'room', 'equipment'] as const

export type ResourceKind = (typeof RESOURCE_KINDS)[number]

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
