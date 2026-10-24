/**
 * Migração 11 — intenção de agendamento + cobrança Pix na conversa (#38 / DEC-047).
 * Sem alocações enquanto aguarda sinal. Confirmação de pagamento = #39; expiração/estorno = #40.
 */
export const MIGRATION_ID = 11
export const MIGRATION_NAME = '0011_scheduling_intent_pix_charge'

export const STATEMENTS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS scheduling_intents (
    id TEXT NOT NULL,
    tenant_id TEXT NOT NULL,
    conversation_id TEXT NOT NULL,
    contact_id TEXT NOT NULL,
    opportunity_id TEXT,
    service_id TEXT NOT NULL,
    professional_id TEXT NOT NULL,
    room_resource_id TEXT,
    starts_at INTEGER NOT NULL,
    ends_at INTEGER NOT NULL,
    occupies_until INTEGER NOT NULL,
    timezone TEXT NOT NULL,
    status TEXT NOT NULL CHECK (
      status IN (
        'awaiting_signal',
        'confirmed',
        'expired',
        'cancelled',
        'waived',
        'failed'
      )
    ),
    active_charge_id TEXT,
    waived_reason TEXT,
    waived_by_clerk_user_id TEXT,
    waived_at INTEGER,
    appointment_id TEXT,
    created_by_clerk_user_id TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (tenant_id, id)
  )`,

  `CREATE INDEX IF NOT EXISTS idx_scheduling_intents_conv
    ON scheduling_intents (tenant_id, conversation_id, created_at DESC)`,

  `CREATE INDEX IF NOT EXISTS idx_scheduling_intents_status
    ON scheduling_intents (tenant_id, status, starts_at)`,

  `CREATE INDEX IF NOT EXISTS idx_scheduling_intents_opp
    ON scheduling_intents (tenant_id, opportunity_id, created_at DESC)`,

  /** Snapshot + ligação conversa/mensagem; estado de criação no provedor. */
  `ALTER TABLE pix_charges ADD COLUMN scheduling_intent_id TEXT`,
  `ALTER TABLE pix_charges ADD COLUMN conversation_id TEXT`,
  `ALTER TABLE pix_charges ADD COLUMN contact_id TEXT`,
  `ALTER TABLE pix_charges ADD COLUMN opportunity_id TEXT`,
  `ALTER TABLE pix_charges ADD COLUMN message_id TEXT`,
  `ALTER TABLE pix_charges ADD COLUMN outbound_message_id TEXT`,
  `ALTER TABLE pix_charges ADD COLUMN professional_id TEXT`,
  `ALTER TABLE pix_charges ADD COLUMN room_resource_id TEXT`,
  `ALTER TABLE pix_charges ADD COLUMN starts_at INTEGER`,
  `ALTER TABLE pix_charges ADD COLUMN ends_at INTEGER`,
  `ALTER TABLE pix_charges ADD COLUMN occupies_until INTEGER`,
  `ALTER TABLE pix_charges ADD COLUMN timezone TEXT`,
  `ALTER TABLE pix_charges ADD COLUMN cancellation_policy_snapshot TEXT`,
  `ALTER TABLE pix_charges ADD COLUMN deadline_seconds_snapshot INTEGER`,
  `ALTER TABLE pix_charges ADD COLUMN signal_kind_snapshot TEXT`,
  `ALTER TABLE pix_charges ADD COLUMN signal_fixed_cents_snapshot INTEGER`,
  `ALTER TABLE pix_charges ADD COLUMN signal_percent_snapshot INTEGER`,
  `ALTER TABLE pix_charges ADD COLUMN service_price_cents_snapshot INTEGER`,
  `ALTER TABLE pix_charges ADD COLUMN idempotency_key TEXT`,
  `ALTER TABLE pix_charges ADD COLUMN provider_create_state TEXT NOT NULL DEFAULT 'confirmed'
    CHECK (
      provider_create_state IN ('pending', 'uncertain', 'confirmed', 'failed')
    )`,
  `ALTER TABLE pix_charges ADD COLUMN created_by_clerk_user_id TEXT`,
  `ALTER TABLE pix_charges ADD COLUMN whatsapp_send_error TEXT`,

  `CREATE UNIQUE INDEX IF NOT EXISTS idx_pix_charges_idempotency
    ON pix_charges (tenant_id, idempotency_key)`,

  `CREATE INDEX IF NOT EXISTS idx_pix_charges_intent
    ON pix_charges (tenant_id, scheduling_intent_id)`,

  `CREATE INDEX IF NOT EXISTS idx_pix_charges_conversation
    ON pix_charges (tenant_id, conversation_id, created_at DESC)`,

  `CREATE INDEX IF NOT EXISTS idx_pix_charges_message
    ON pix_charges (tenant_id, message_id)`,

  /**
   * Idempotência de clique/retry (criar+enviar / confirmar sem sinal / cancelar).
   * Timeout/uncertain reconcilia sem nova cobrança cega.
   */
  `CREATE TABLE IF NOT EXISTS pix_charge_commands (
    tenant_id TEXT NOT NULL,
    client_request_id TEXT NOT NULL,
    command TEXT NOT NULL CHECK (
      command IN ('create_and_send', 'confirm_without_signal', 'cancel_charge', 'reconcile_create')
    ),
    scheduling_intent_id TEXT,
    charge_id TEXT,
    appointment_id TEXT,
    result_json TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (tenant_id, client_request_id)
  )`,

  `CREATE INDEX IF NOT EXISTS idx_pix_charge_commands_charge
    ON pix_charge_commands (tenant_id, charge_id)`,
]
