/**
 * DEC-182 — prazo do sinal só 15/30 min; credit window em minutos (Outro… min|h);
 * antecedência mínima exposta via booking_lead_minutes (já existente).
 */
export const MIGRATION_ID = 66
export const MIGRATION_NAME = '0066_sinal_timing_lead_credit'

export const STATEMENTS: readonly string[] = [
  `ALTER TABLE clinic_settings ADD COLUMN signal_credit_window_minutes INTEGER NOT NULL DEFAULT 1440`,
  `UPDATE clinic_settings
   SET signal_credit_window_minutes = CASE
     WHEN signal_credit_window_hours IS NULL OR signal_credit_window_hours <= 0 THEN 1440
     ELSE signal_credit_window_hours * 60
   END`,
  // Prazo > 30 min → 30 min (DEC-182). Cobranças já enviadas mantêm o snapshot.
  `UPDATE clinic_settings
   SET signal_deadline_seconds = 1800
   WHERE signal_deadline_seconds IS NULL
      OR signal_deadline_seconds < 900
      OR signal_deadline_seconds > 1800
      OR (signal_deadline_seconds != 900 AND signal_deadline_seconds != 1800)`,
]
