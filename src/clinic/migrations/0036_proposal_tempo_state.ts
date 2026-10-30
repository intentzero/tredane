/**
 * Migração 36 — estado `recusada_tempo` e snapshot do bloco Tempo na proposta (DEC-077 S5).
 * SQLite não altera CHECK: a tabela é reconstruída. O corpo da previsão não é gravado.
 * Propostas já existentes ficam em Tanto faz (não havia snapshot).
 */
export const MIGRATION_ID = 36
export const MIGRATION_NAME = '0036_proposal_tempo_state'

export const STATEMENTS: readonly string[] = [
  `CREATE TABLE appointment_proposals_v36 (
    id TEXT NOT NULL,
    tenant_id TEXT NOT NULL,
    lineage_id TEXT NOT NULL,
    version INTEGER NOT NULL CHECK (version >= 1),
    contact_id TEXT NOT NULL,
    conversation_id TEXT NOT NULL,
    state TEXT NOT NULL CHECK (
      state IN (
        'preparada',
        'envio_pendente',
        'envio_incerto',
        'enviada',
        'confirmada',
        'substituida',
        'expirada',
        'recusada_vaga',
        'recusada_tempo',
        'encaminhada'
      )
    ),
    clinic_location_text TEXT NOT NULL DEFAULT '',
    beneficiary_kind TEXT NOT NULL CHECK (beneficiary_kind IN ('titular', 'terceiro')),
    beneficiary_name TEXT NOT NULL,
    service_id TEXT NOT NULL,
    service_name TEXT NOT NULL,
    professional_id TEXT,
    professional_name TEXT,
    starts_at INTEGER NOT NULL,
    ends_at INTEGER NOT NULL,
    duration_minutes INTEGER NOT NULL CHECK (duration_minutes > 0),
    timezone TEXT NOT NULL,
    price_cents INTEGER,
    requires_signal INTEGER NOT NULL DEFAULT 0 CHECK (requires_signal IN (0, 1)),
    signal_kind TEXT,
    signal_fixed_cents INTEGER,
    signal_percent INTEGER,
    signal_conditions_text TEXT NOT NULL DEFAULT '',
    expires_at INTEGER,
    sent_at INTEGER,
    superseded_by_id TEXT,
    appointment_id TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    send_outbound_id TEXT,
    send_message_id TEXT,
    send_provider_message_id TEXT,
    result_outbound_id TEXT,
    result_kind TEXT,
    tempo_ceu TEXT NOT NULL DEFAULT 'tanto_faz' CHECK (tempo_ceu IN ('tanto_faz', 'sol', 'chuva')),
    tempo_temperatura TEXT NOT NULL DEFAULT 'tanto_faz' CHECK (tempo_temperatura IN ('tanto_faz', 'acima', 'abaixo')),
    tempo_celsius INTEGER,
    PRIMARY KEY (tenant_id, id)
  )`,

  `INSERT INTO appointment_proposals_v36 (
    id, tenant_id, lineage_id, version, contact_id, conversation_id, state,
    clinic_location_text, beneficiary_kind, beneficiary_name,
    service_id, service_name, professional_id, professional_name,
    starts_at, ends_at, duration_minutes, timezone, price_cents,
    requires_signal, signal_kind, signal_fixed_cents, signal_percent, signal_conditions_text,
    expires_at, sent_at, superseded_by_id, appointment_id, created_at, updated_at,
    send_outbound_id, send_message_id, send_provider_message_id, result_outbound_id, result_kind,
    tempo_ceu, tempo_temperatura, tempo_celsius
  )
  SELECT
    id, tenant_id, lineage_id, version, contact_id, conversation_id, state,
    clinic_location_text, beneficiary_kind, beneficiary_name,
    service_id, service_name, professional_id, professional_name,
    starts_at, ends_at, duration_minutes, timezone, price_cents,
    requires_signal, signal_kind, signal_fixed_cents, signal_percent, signal_conditions_text,
    expires_at, sent_at, superseded_by_id, appointment_id, created_at, updated_at,
    send_outbound_id, send_message_id, send_provider_message_id, result_outbound_id, result_kind,
    'tanto_faz', 'tanto_faz', NULL
  FROM appointment_proposals`,

  `DROP TABLE appointment_proposals`,

  `ALTER TABLE appointment_proposals_v36 RENAME TO appointment_proposals`,

  `CREATE INDEX IF NOT EXISTS idx_appointment_proposals_lineage
    ON appointment_proposals (tenant_id, lineage_id, version DESC)`,

  `CREATE INDEX IF NOT EXISTS idx_appointment_proposals_contact_state
    ON appointment_proposals (tenant_id, contact_id, state, created_at DESC)`,

  `CREATE INDEX IF NOT EXISTS idx_appointment_proposals_conversation
    ON appointment_proposals (tenant_id, conversation_id, created_at DESC)`,

  `CREATE INDEX IF NOT EXISTS idx_appointment_proposals_active
    ON appointment_proposals (tenant_id, conversation_id, state, expires_at)`,

  `CREATE INDEX IF NOT EXISTS idx_appointment_proposals_service
    ON appointment_proposals (tenant_id, service_id)`,

  `CREATE INDEX IF NOT EXISTS idx_appointment_proposals_professional
    ON appointment_proposals (tenant_id, professional_id)`,
]
