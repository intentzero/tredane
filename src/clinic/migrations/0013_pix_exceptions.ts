/**
 * Migração 13 — exceções Pix (#40): resolver pago sem horário, expiração,
 * cancelamento de cobrança e estorno idempotente (DEC-047 / REQ-080–082).
 */
export const MIGRATION_ID = 13
export const MIGRATION_NAME = '0013_pix_exceptions'

export const STATEMENTS: readonly string[] = [
  /** Decisão humana Devolver/Reter (REQ-082) — independente do sucesso financeiro. */
  `ALTER TABLE pix_charges ADD COLUMN signal_disposition TEXT
    CHECK (
      signal_disposition IS NULL OR signal_disposition IN ('refund', 'retain')
    )`,
  `ALTER TABLE pix_charges ADD COLUMN signal_disposition_by TEXT`,
  `ALTER TABLE pix_charges ADD COLUMN signal_disposition_at INTEGER`,
  `ALTER TABLE pix_charges ADD COLUMN signal_disposition_note TEXT`,

  /** Estorno: chave estável + ids do provedor; UI só mostra Devolvido após confirmação. */
  `ALTER TABLE pix_charges ADD COLUMN refund_idempotency_key TEXT`,
  `ALTER TABLE pix_charges ADD COLUMN refund_provider_id TEXT`,
  `ALTER TABLE pix_charges ADD COLUMN refund_requested_at INTEGER`,
  `ALTER TABLE pix_charges ADD COLUMN refund_completed_at INTEGER`,
  `ALTER TABLE pix_charges ADD COLUMN refund_failure_reason TEXT`,

  `CREATE UNIQUE INDEX IF NOT EXISTS idx_pix_charges_refund_idem
    ON pix_charges (tenant_id, refund_idempotency_key)`,

  `CREATE INDEX IF NOT EXISTS idx_pix_charges_awaiting_expires
    ON pix_charges (tenant_id, status, expires_at)`,

  /** Resolução do alerta M-32 — só quando alt horário / devolução efectiva. */
  `ALTER TABLE pix_payment_alerts ADD COLUMN resolution_kind TEXT
    CHECK (
      resolution_kind IS NULL OR resolution_kind IN (
        'alt_slot_confirmed', 'refunded'
      )
    )`,
  `ALTER TABLE pix_payment_alerts ADD COLUMN resolved_by_clerk_user_id TEXT`,
  `ALTER TABLE pix_payment_alerts ADD COLUMN resolved_appointment_id TEXT`,

  /**
   * Idempotência de clique/retry para #40 (separado de pix_charge_commands
   * para não recriar CHECK da migração 11).
   */
  `CREATE TABLE IF NOT EXISTS pix_exception_commands (
    tenant_id TEXT NOT NULL,
    client_request_id TEXT NOT NULL,
    command TEXT NOT NULL CHECK (
      command IN (
        'cancel_unpaid_charge',
        'expire_charge',
        'resolve_alert_alt_slot',
        'resolve_alert_refund',
        'request_refund',
        'retry_refund',
        'cancel_paid_with_signal'
      )
    ),
    charge_id TEXT,
    alert_id TEXT,
    appointment_id TEXT,
    result_json TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (tenant_id, client_request_id)
  )`,

  `CREATE INDEX IF NOT EXISTS idx_pix_exception_commands_charge
    ON pix_exception_commands (tenant_id, charge_id)`,

  /**
   * Eventos de ciclo de vida do provedor (expiração / cancel / estorno).
   * Separado de pix_webhook_events (#39) para não recriar CHECK de outcome.
   */
  `CREATE TABLE IF NOT EXISTS pix_lifecycle_events (
    tenant_id TEXT NOT NULL,
    event_id TEXT NOT NULL,
    charge_id TEXT,
    event_type TEXT NOT NULL CHECK (
      event_type IN (
        'charge.expired',
        'charge.cancelled',
        'refund.updated'
      )
    ),
    outcome TEXT NOT NULL CHECK (
      outcome IN (
        'expired',
        'cancelled',
        'refund_requested',
        'refunded',
        'refund_failed',
        'ignored_duplicate',
        'ignored_late_paid_trace',
        'ignored_state',
        'rejected'
      )
    ),
    detail_json TEXT,
    processed_at INTEGER NOT NULL,
    PRIMARY KEY (tenant_id, event_id)
  )`,

  `CREATE INDEX IF NOT EXISTS idx_pix_lifecycle_events_charge
    ON pix_lifecycle_events (tenant_id, charge_id)`,
]
