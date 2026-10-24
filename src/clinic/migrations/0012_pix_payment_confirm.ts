/**
 * Migração 12 — pagamento Pix → confirmação atómica / pago sem horário (#39).
 * Sem expiração/estorno end-to-end (#40).
 */
export const MIGRATION_ID = 12
export const MIGRATION_NAME = '0012_pix_payment_confirm'

export const STATEMENTS: readonly string[] = [
  /** Resolução após pagamento: confirmado vs pago sem horário (status ledger = paid). */
  `ALTER TABLE pix_charges ADD COLUMN payment_resolution TEXT
    CHECK (
      payment_resolution IS NULL OR payment_resolution IN (
        'appointment_confirmed', 'paid_without_slot'
      )
    )`,
  `ALTER TABLE pix_charges ADD COLUMN appointment_id TEXT`,
  `ALTER TABLE pix_charges ADD COLUMN paid_without_slot_reason TEXT
    CHECK (
      paid_without_slot_reason IS NULL OR paid_without_slot_reason IN (
        'slot_occupied', 'payment_after_expiry', 'intent_unavailable', 'charge_not_awaiting'
      )
    )`,

  `CREATE INDEX IF NOT EXISTS idx_pix_charges_appointment
    ON pix_charges (tenant_id, appointment_id)`,

  /**
   * Idempotência de eventos de webhook no DO (reentrega / ordem).
   * event_id = chave estável do provedor (não contém dados bancários).
   */
  `CREATE TABLE IF NOT EXISTS pix_webhook_events (
    tenant_id TEXT NOT NULL,
    event_id TEXT NOT NULL,
    charge_id TEXT,
    outcome TEXT NOT NULL CHECK (
      outcome IN (
        'appointment_confirmed',
        'paid_without_slot',
        'ignored_duplicate',
        'ignored_unsupported',
        'rejected'
      )
    ),
    appointment_id TEXT,
    alert_id TEXT,
    processed_at INTEGER NOT NULL,
    PRIMARY KEY (tenant_id, event_id)
  )`,

  `CREATE INDEX IF NOT EXISTS idx_pix_webhook_events_charge
    ON pix_webhook_events (tenant_id, charge_id)`,

  /**
   * Alerta durável M-32 — sobrevive a falha WS; reconcilia em reconnect.
   * Resolução (escolher horário / devolver) = #40.
   */
  `CREATE TABLE IF NOT EXISTS pix_payment_alerts (
    id TEXT NOT NULL,
    tenant_id TEXT NOT NULL,
    charge_id TEXT NOT NULL,
    conversation_id TEXT,
    contact_id TEXT,
    opportunity_id TEXT,
    reason TEXT NOT NULL CHECK (
      reason IN (
        'slot_occupied',
        'payment_after_expiry',
        'intent_unavailable',
        'charge_not_awaiting'
      )
    ),
    status TEXT NOT NULL CHECK (status IN ('open', 'resolved')),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    resolved_at INTEGER,
    PRIMARY KEY (tenant_id, id),
    UNIQUE (tenant_id, charge_id)
  )`,

  `CREATE INDEX IF NOT EXISTS idx_pix_payment_alerts_open
    ON pix_payment_alerts (tenant_id, status, created_at DESC)`,

  `CREATE INDEX IF NOT EXISTS idx_pix_payment_alerts_conversation
    ON pix_payment_alerts (tenant_id, conversation_id, status)`,
]
