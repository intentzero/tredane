/** Versão alvo do schema SQLite por instância do Clinic DO (issue #20/#23/#28/#29/#30). */
export const CLINIC_SCHEMA_VERSION = 5

/** Nome da migração fundação — distinto das migrations de classe Wrangler. */
export const CLINIC_MIGRATION_NAMES = {
  1: '0001_clinic_foundation',
  2: '0002_realtime_fence',
  3: '0003_clinic_config',
  4: '0004_inbox',
  5: '0005_pipeline',
} as const

/**
 * Etapas iniciais do Acompanhamento (Proposto em states.md; DEC-040/045).
 * UI: «contato em andamento»; código/docs: oportunidade / pipeline.
 */
export const OPPORTUNITY_STAGES = [
  'novo_contato',
  'em_atendimento',
  'horario_proposto',
  'agendado',
  'concluido',
  'perdido',
] as const

export type OpportunityStage = (typeof OPPORTUNITY_STAGES)[number]

/** Etapas terminais — fecham o ciclo (VAL-02 hipótese / Em aberto). */
export const TERMINAL_OPPORTUNITY_STAGES: readonly OpportunityStage[] = [
  'concluido',
  'perdido',
]

export const OPPORTUNITY_STATUSES = ['open', 'closed'] as const

export type OpportunityStatus = (typeof OPPORTUNITY_STATUSES)[number]

/** Rótulos de UI (DEC-045) — nunca «pipeline»/«oportunidade» no painel. */
export const OPPORTUNITY_STAGE_LABELS: Record<OpportunityStage, string> = {
  novo_contato: 'Novo contato',
  em_atendimento: 'Em atendimento',
  horario_proposto: 'Horário proposto',
  agendado: 'Agendado',
  concluido: 'Concluído',
  perdido: 'Perdido',
}

/** Estados de conversa (Proposto em states.md; implementação #29). */
export const CONVERSATION_STATUSES = ['new', 'open', 'closed'] as const

export type ConversationStatus = (typeof CONVERSATION_STATUSES)[number]

export const MESSAGE_DIRECTIONS = ['inbound', 'outbound', 'system'] as const

export type MessageDirection = (typeof MESSAGE_DIRECTIONS)[number]

export const MESSAGE_DELIVERY_STATES = [
  'received',
  'pending',
  'accepted',
  'failed',
  'unknown',
] as const

export type MessageDeliveryState = (typeof MESSAGE_DELIVERY_STATES)[number]

/** Filtros da caixa de entrada (TEL-01 / ux-ui.md). */
export const INBOX_FILTERS = [
  'all',
  'new',
  'mine',
  'unassigned',
  'closed',
] as const

export type InboxFilter = (typeof INBOX_FILTERS)[number]

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
