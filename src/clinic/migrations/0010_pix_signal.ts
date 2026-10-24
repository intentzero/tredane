/**
 * Migração 10 — conta Pix da clínica + configuração de sinais (#37 / DEC-047/049).
 * Credenciais cifradas; histórico de cobranças preservado ao desconectar.
 * Criação de cobrança na conversa = #38; confirmação de pagamento = #39.
 */
export const MIGRATION_ID = 10
export const MIGRATION_NAME = '0010_pix_signal'

export const STATEMENTS: readonly string[] = [
  `ALTER TABLE clinic_settings ADD COLUMN signal_deadline_seconds INTEGER NOT NULL DEFAULT 7200`,
  `ALTER TABLE clinic_settings ADD COLUMN signal_cancellation_policy TEXT NOT NULL DEFAULT ''`,

  `ALTER TABLE services ADD COLUMN requires_signal INTEGER NOT NULL DEFAULT 0 CHECK (requires_signal IN (0, 1))`,
  `ALTER TABLE services ADD COLUMN signal_kind TEXT CHECK (
    signal_kind IS NULL OR signal_kind IN ('fixed', 'percent')
  )`,
  `ALTER TABLE services ADD COLUMN signal_fixed_cents INTEGER`,
  `ALTER TABLE services ADD COLUMN signal_percent INTEGER`,

  `CREATE TABLE IF NOT EXISTS pix_account (
    id INTEGER PRIMARY KEY NOT NULL CHECK (id = 1),
    tenant_id TEXT NOT NULL UNIQUE,
    provider TEXT NOT NULL CHECK (provider IN ('woovi')),
    status TEXT NOT NULL CHECK (status IN ('disconnected', 'connected', 'revoked')),
    account_id TEXT,
    app_id_cipher TEXT,
    app_id_hint TEXT,
    environment TEXT NOT NULL CHECK (environment IN ('synthetic', 'sandbox', 'live')),
    credential_version INTEGER NOT NULL DEFAULT 0,
    connected_at INTEGER,
    connected_by_clerk_user_id TEXT,
    disconnected_at INTEGER,
    revoked_at INTEGER,
    revoke_reason TEXT,
    updated_at INTEGER NOT NULL
  )`,

  /**
   * Ledger local — sobrevive a desconexão (AC #37).
   * Envio na conversa / estados de domínio completos = #38/#39.
   */
  `CREATE TABLE IF NOT EXISTS pix_charges (
    id TEXT NOT NULL,
    tenant_id TEXT NOT NULL,
    account_id TEXT NOT NULL,
    provider TEXT NOT NULL,
    provider_charge_id TEXT,
    external_reference TEXT NOT NULL,
    amount_cents INTEGER NOT NULL,
    status TEXT NOT NULL CHECK (
      status IN (
        'awaiting_payment', 'paid', 'expired', 'cancelled',
        'refund_requested', 'refunded', 'refund_failed'
      )
    ),
    pix_copy_paste TEXT,
    expires_at INTEGER,
    paid_at INTEGER,
    cancelled_at INTEGER,
    service_id TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (tenant_id, id)
  )`,

  `CREATE INDEX IF NOT EXISTS idx_pix_charges_account
    ON pix_charges (tenant_id, account_id, created_at)`,

  `CREATE UNIQUE INDEX IF NOT EXISTS idx_pix_charges_external
    ON pix_charges (tenant_id, external_reference)`,

  `CREATE INDEX IF NOT EXISTS idx_pix_charges_provider
    ON pix_charges (tenant_id, provider_charge_id)`,
]
