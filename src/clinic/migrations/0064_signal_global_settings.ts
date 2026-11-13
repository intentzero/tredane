/**
 * DEC-180 — sinal global em Recebimento + isenção durável no Contato.
 * Valor/política deixam de ser só por serviço; texto à cliente gerado (ou Outro…).
 */
export const MIGRATION_ID = 64
export const MIGRATION_NAME = '0064_signal_global_settings'

export const STATEMENTS: readonly string[] = [
  `ALTER TABLE clinic_settings ADD COLUMN signal_enabled INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE clinic_settings ADD COLUMN signal_amount_kind TEXT NOT NULL DEFAULT 'fixed'`,
  `ALTER TABLE clinic_settings ADD COLUMN signal_fixed_cents INTEGER`,
  `ALTER TABLE clinic_settings ADD COLUMN signal_percent INTEGER`,
  `ALTER TABLE clinic_settings ADD COLUMN signal_policy_kind TEXT NOT NULL DEFAULT 'credit_next'`,
  `ALTER TABLE clinic_settings ADD COLUMN signal_credit_window_hours INTEGER NOT NULL DEFAULT 24`,
  `ALTER TABLE clinic_settings ADD COLUMN signal_custom_policy_text TEXT NOT NULL DEFAULT ''`,

  `ALTER TABLE contacts ADD COLUMN signal_waived INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE contacts ADD COLUMN signal_waive_reason TEXT`,
  `ALTER TABLE contacts ADD COLUMN signal_waived_by_clerk_user_id TEXT`,
  `ALTER TABLE contacts ADD COLUMN signal_waived_by_display_name TEXT`,
  `ALTER TABLE contacts ADD COLUMN signal_waived_at INTEGER`,

  // Semear global a partir do primeiro serviço com sinal (migração única).
  `UPDATE clinic_settings
   SET signal_enabled = 1,
       signal_amount_kind = COALESCE(
         (SELECT signal_kind FROM services WHERE requires_signal = 1 AND signal_kind IS NOT NULL LIMIT 1),
         'fixed'
       ),
       signal_fixed_cents = (
         SELECT signal_fixed_cents FROM services
         WHERE requires_signal = 1 AND signal_kind = 'fixed' AND signal_fixed_cents IS NOT NULL
         LIMIT 1
       ),
       signal_percent = (
         SELECT signal_percent FROM services
         WHERE requires_signal = 1 AND signal_kind = 'percent' AND signal_percent IS NOT NULL
         LIMIT 1
       )
   WHERE EXISTS (SELECT 1 FROM services WHERE requires_signal = 1)
     AND signal_enabled = 0`,
]
