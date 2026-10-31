/** Versão alvo do schema SQLite por instância do Clinic DO (issue #20…#43 / #174 / #175 / abuse UI). */
export const CLINIC_SCHEMA_VERSION = 47

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
  11: '0011_scheduling_intent_pix_charge',
  12: '0012_pix_payment_confirm',
  13: '0013_pix_exceptions',
  14: '0014_ai_suggestions',
  15: '0015_contact_retention',
  16: '0016_schedule_holds',
  17: '0017_ai_assist_opt_in',
  18: '0018_holds_require_time',
  19: '0019_ai_autodraft_read_receipts',
  20: '0020_adjustable_duration',
  21: '0021_room_capacity',
  22: '0022_contact_block',
  23: '0023_room_requirement_any',
  24: '0024_clinic_hours',
  25: '0025_google_business_url',
  26: '0026_resource_history_indexes',
  27: '0027_service_weekly_windows',
  28: '0028_appointment_proposals',
  29: '0029_proposal_whatsapp_send',
  30: '0030_clinic_abuse_limits',
  31: '0031_service_audience',
  32: '0032_drop_adjustable_duration',
  33: '0033_service_tempo',
  34: '0034_service_zones',
  35: '0035_variant_kind_audience',
  36: '0036_proposal_tempo_state',
  37: '0037_professional_home_room',
  38: '0038_room_same_sex',
  39: '0039_variant_kind_plural',
  40: '0040_service_combos',
  41: '0041_variant_same_name',
} as const

/**
 * Estados da proposta de agendamento por botão (DEC-061 / S3 #174).
 * `preparada` / `envio_*` = extensão de engenharia (Proposto) até o envio WhatsApp (S4).
 * Só `enviada` (e não expirada) aceita clique (S5).
 */
export const APPOINTMENT_PROPOSAL_STATES = [
  'preparada',
  'envio_pendente',
  'envio_incerto',
  'enviada',
  'confirmada',
  'substituida',
  'expirada',
  'recusada_vaga',
  'recusada_tempo',
  'encaminhada',
] as const

export type AppointmentProposalState = (typeof APPOINTMENT_PROPOSAL_STATES)[number]

/** Estados ainda não consumidos / terminais — candidatos a substituição. */
export const APPOINTMENT_PROPOSAL_OPEN_STATES = [
  'preparada',
  'envio_pendente',
  'envio_incerto',
  'enviada',
] as const

export type AppointmentProposalOpenState =
  (typeof APPOINTMENT_PROPOSAL_OPEN_STATES)[number]

/** Vigência após envio — Decidido (Paulo, 28/10/2026): 30 minutos. */
export const APPOINTMENT_PROPOSAL_VALIDITY_MS = 30 * 60 * 1000

/**
 * Alerta H7 / DEC-061 — comunicação pendente após N minutos sem envio/resposta.
 * Decidido (Paulo, 28/10/2026): 5 minutos.
 */
export const PENDING_COMMUNICATION_ALERT_MS = 5 * 60 * 1000

export const PENDING_COMMUNICATION_KINDS = [
  'proposal_send',
  'result_send',
  'alter_awaiting_team',
] as const

export type PendingCommunicationKind = (typeof PENDING_COMMUNICATION_KINDS)[number]

export const PENDING_COMMUNICATION_STATUSES = ['open', 'alerted', 'resolved'] as const

export type PendingCommunicationStatus = (typeof PENDING_COMMUNICATION_STATUSES)[number]

/** Actor de sistema para envio determinístico da proposta / resultado (S4). */
export const PROPOSAL_SEND_ACTOR = 'system:proposal-send'

export const PROPOSAL_SEND_ACTOR_DISPLAY = 'Sistema'

export const APPOINTMENT_PROPOSAL_BENEFICIARY_KINDS = ['titular', 'terceiro'] as const

export type AppointmentProposalBeneficiaryKind =
  (typeof APPOINTMENT_PROPOSAL_BENEFICIARY_KINDS)[number]

/** Resultados determinísticos anunciados após commit (S4 / DEC-061). */
export const PROPOSAL_RESULT_KINDS = [
  'booked',
  'slot_refused',
  'pix_signal',
  'expired',
  'tempo_refused',
  'tempo_unconfirmed',
] as const

export type ProposalResultKind = (typeof PROPOSAL_RESULT_KINDS)[number]

/** Estados de sugestão IA (#41 / ADR-0004). */
export const AI_SUGGESTION_KINDS = ['reply', 'summary'] as const
export type AiSuggestionKindConst = (typeof AI_SUGGESTION_KINDS)[number]

export const AI_SUGGESTION_STATUSES = [
  'pending',
  'used',
  'edited',
  'discarded',
  'failed',
  'superseded',
] as const

export const AI_SUGGESTION_DECISIONS = [
  'use',
  'edit',
  'discard',
  'regenerate',
] as const

/** Resolução do pagamento no DO (#39 / DEC-047). */
export const PIX_PAYMENT_RESOLUTIONS = [
  'appointment_confirmed',
  'paid_without_slot',
] as const

export type PixPaymentResolution = (typeof PIX_PAYMENT_RESOLUTIONS)[number]

export const PIX_PAID_WITHOUT_SLOT_REASONS = [
  'slot_occupied',
  'payment_after_expiry',
  'intent_unavailable',
  'charge_not_awaiting',
] as const

export type PixPaidWithoutSlotReason =
  (typeof PIX_PAID_WITHOUT_SLOT_REASONS)[number]

export const PIX_PAYMENT_ALERT_STATUSES = ['open', 'resolved'] as const

export type PixPaymentAlertStatus = (typeof PIX_PAYMENT_ALERT_STATUSES)[number]

/** Como o alerta M-32 foi resolvido (#40 / REQ-080). */
export const PIX_ALERT_RESOLUTION_KINDS = [
  'alt_slot_confirmed',
  'refunded',
] as const

export type PixAlertResolutionKind =
  (typeof PIX_ALERT_RESOLUTION_KINDS)[number]

/** Decisão humana sobre sinal pago ao cancelar (#40 / REQ-082). */
export const PIX_SIGNAL_DISPOSITIONS = ['refund', 'retain'] as const

export type PixSignalDisposition = (typeof PIX_SIGNAL_DISPOSITIONS)[number]

/** Intenção de horário sem alocação (#38 / DEC-047). */
export const SCHEDULING_INTENT_STATUSES = [
  'awaiting_signal',
  'confirmed',
  'expired',
  'cancelled',
  'waived',
  'failed',
] as const

export type SchedulingIntentStatus = (typeof SCHEDULING_INTENT_STATUSES)[number]

/** Estado da criação no provedor (separado do status da cobrança e da mensagem). */
export const PIX_PROVIDER_CREATE_STATES = [
  'pending',
  'uncertain',
  'confirmed',
  'failed',
] as const

export type PixProviderCreateState = (typeof PIX_PROVIDER_CREATE_STATES)[number]

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

/**
 * Reserva por bloco (DEC do fundador 27/10/2026): período reservado na agenda
 * de uma profissional, sempre com hora definida na criação (migração 17); o
 * compromisso ocupa a duração do bloco.
 */
export const SCHEDULE_HOLD_STATUSES = [
  'active',
  'resolved',
  'expired',
  'cancelled',
] as const

export type ScheduleHoldStatus = (typeof SCHEDULE_HOLD_STATUSES)[number]


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
  'needs_person',
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

/** Actor das marcações feitas pela IA após confirmação explícita da cliente (28/10/2026). */
export const AI_AUTOBOOK_ACTOR = 'system:ai-autobook'

/** Prefixo estável de clientRequestId / botão (S4 → S5). */
export const PROPOSAL_SEND_CLIENT_REQUEST_PREFIX = 'proposal.send:'
export const PROPOSAL_RESULT_CLIENT_REQUEST_PREFIX = 'proposal.result:'
/** Idempotência S5: confirmação de compromisso a partir do clique. */
export const PROPOSAL_BOOK_CLIENT_REQUEST_PREFIX = 'proposal.book:'
/** Idempotência S5: cobrança Pix de sinal a partir do clique (sem hold). */
export const PROPOSAL_PIX_CLIENT_REQUEST_PREFIX = 'proposal.pix:'
