/** Versão alvo do schema SQLite por instância do Clinic DO (issue #20…#37). */
export const CLINIC_SCHEMA_VERSION = 10

/** Nome da migração fundação — distinto das migrations de classe Wrangler. */
export const CLINIC_MIGRATION_NAMES = {
  1: '0001_clinic_foundation',
  2: '0002_realtime_fence',
  3: '0003_clinic_config',
  4: '0004_inbox',
  5: '0005_pipeline',
  6: '0006_whatsapp_channel',
  7: '0007_outbound_send',
  8: '0008_attachments',
  9: '0009_appointments_booking',
  10: '0010_pix_signal',
} as const

/**
 * Motivos de cancelamento/reagendamento (REQ-032 / DEC-008).
 * Lista inicial **Proposta** — validar com clínica piloto.
 */
export const APPOINTMENT_CHANGE_REASONS = [
  'contato_desistiu',
  'contato_remarcou',
  'clinica_cancelou',
  'nao_compareceu',
  'outro',
] as const

export type AppointmentChangeReason = (typeof APPOINTMENT_CHANGE_REASONS)[number]

export const APPOINTMENT_CHANGE_REASON_LABELS: Record<
  AppointmentChangeReason,
  string
> = {
  contato_desistiu: 'Contacto desistiu',
  contato_remarcou: 'Contacto remarcou',
  clinica_cancelou: 'Clínica cancelou',
  nao_compareceu: 'Não compareceu',
  outro: 'Outro',
}

/** Conta Pix da clínica (#37 / DEC-049). */
export const PIX_ACCOUNT_STATUSES = [
  'disconnected',
  'connected',
  'revoked',
] as const

export type PixAccountStatus = (typeof PIX_ACCOUNT_STATUSES)[number]

export const PIX_ENVIRONMENTS = ['synthetic', 'sandbox', 'live'] as const

export type PixEnvironment = (typeof PIX_ENVIRONMENTS)[number]

export const PIX_CHARGE_STATUSES = [
  'awaiting_payment',
  'paid',
  'expired',
  'cancelled',
  'refund_requested',
  'refunded',
  'refund_failed',
] as const

export type PixChargeStatus = (typeof PIX_CHARGE_STATUSES)[number]

/** Estados de anexo (#34) — carregando / pronto / indisponível / falhou. */
export const ATTACHMENT_STATUSES = [
  'pending',
  'ready',
  'unavailable',
  'failed',
] as const

export type AttachmentStatus = (typeof ATTACHMENT_STATUSES)[number]

export const ATTACHMENT_SOURCES = [
  'whatsapp_inbound',
  'human_upload',
  'synthetic',
] as const

export type AttachmentSource = (typeof ATTACHMENT_SOURCES)[number]

/** Janela de atendimento WhatsApp (DEC-040) — ms desde a última inbound do contacto. */
export const WHATSAPP_MESSAGING_WINDOW_MS = 24 * 60 * 60 * 1000

/** Estados do espelho WhatsApp no DO (#31 / REQ-051). */
export const WHATSAPP_CHANNEL_STATUSES = [
  'disconnected',
  'connected',
  'interrupted',
] as const

export type WhatsappChannelStatus = (typeof WHATSAPP_CHANNEL_STATUSES)[number]

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
  'delivered',
  'read',
  'failed',
  'unknown',
] as const

export type MessageDeliveryState = (typeof MESSAGE_DELIVERY_STATES)[number]

/** Estados de entrega outbound (sem `received`, que é só inbound). */
export const OUTBOUND_DELIVERY_STATES = [
  'pending',
  'accepted',
  'delivered',
  'read',
  'failed',
  'unknown',
] as const

export type OutboundDeliveryState = (typeof OUTBOUND_DELIVERY_STATES)[number]

/**
 * Ordem monotónica de progresso (states.md): nunca regredir.
 * `unknown` pode avançar para aceite/falha após reconciliação; `failed` é terminal.
 */
export const OUTBOUND_DELIVERY_RANK: Record<OutboundDeliveryState, number> = {
  pending: 0,
  unknown: 1,
  accepted: 2,
  delivered: 3,
  read: 4,
  failed: 100,
}

export const WHATSAPP_TEMPLATE_STATUSES = [
  'approved',
  'pending',
  'rejected',
  'paused',
] as const

export type WhatsappTemplateStatus = (typeof WHATSAPP_TEMPLATE_STATUSES)[number]

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
