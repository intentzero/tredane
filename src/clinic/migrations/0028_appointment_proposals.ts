/**
 * Migração 28 — propostas de agendamento versionadas (S3 / #174 / DEC-061).
 * Autorização por botão; não reserva horário (DEC-008 / DEC-047).
 * Estados de preparação/envio são extensão de engenharia (Proposto) sobre
 * «Proposta de agendamento por botão» em docs/product/states.md.
 * (0027 já é service_weekly_windows na main.)
 */
export const MIGRATION_ID = 28
export const MIGRATION_NAME = '0028_appointment_proposals'

export const STATEMENTS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS appointment_proposals (
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
    PRIMARY KEY (tenant_id, id)
  )`,

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
