/**
 * Migração 30 — limites de abuso por clínica (UI owner, Paulo 29/10/2026).
 * Persistência no SQLite do Clinic DO; defaults Confirmados; enabled=0 (fail-closed).
 */
export const MIGRATION_ID = 30
export const MIGRATION_NAME = '0030_clinic_abuse_limits'

export const STATEMENTS: readonly string[] = [
  `ALTER TABLE clinic_settings
    ADD COLUMN abuse_limits_enabled INTEGER NOT NULL DEFAULT 0
    CHECK (abuse_limits_enabled IN (0, 1))`,
  `ALTER TABLE clinic_settings
    ADD COLUMN auto_book_paused INTEGER NOT NULL DEFAULT 0
    CHECK (auto_book_paused IN (0, 1))`,
  `ALTER TABLE clinic_settings
    ADD COLUMN abuse_window_hours INTEGER NOT NULL DEFAULT 24
    CHECK (abuse_window_hours >= 1)`,
  `ALTER TABLE clinic_settings
    ADD COLUMN abuse_auto_drafts_per_contact INTEGER NOT NULL DEFAULT 20
    CHECK (abuse_auto_drafts_per_contact >= 1)`,
  `ALTER TABLE clinic_settings
    ADD COLUMN abuse_ai_bookings_per_contact INTEGER NOT NULL DEFAULT 1
    CHECK (abuse_ai_bookings_per_contact >= 1)`,
  `ALTER TABLE clinic_settings
    ADD COLUMN abuse_ai_bookings_per_clinic INTEGER NOT NULL DEFAULT 20
    CHECK (abuse_ai_bookings_per_clinic >= 1)`,
  `ALTER TABLE clinic_settings
    ADD COLUMN abuse_future_appointments_per_contact INTEGER NOT NULL DEFAULT 3
    CHECK (abuse_future_appointments_per_contact >= 1)`,
  `ALTER TABLE clinic_settings
    ADD COLUMN abuse_pending_pix_per_contact INTEGER NOT NULL DEFAULT 2
    CHECK (abuse_pending_pix_per_contact >= 1)`,
  `ALTER TABLE clinic_settings
    ADD COLUMN abuse_pending_proposals_per_contact INTEGER NOT NULL DEFAULT 1
    CHECK (abuse_pending_proposals_per_contact >= 1)`,
  `ALTER TABLE clinic_settings
    ADD COLUMN abuse_proposals_per_contact INTEGER NOT NULL DEFAULT 5
    CHECK (abuse_proposals_per_contact >= 1)`,
  `ALTER TABLE clinic_settings
    ADD COLUMN abuse_proposals_per_clinic INTEGER NOT NULL DEFAULT 100
    CHECK (abuse_proposals_per_clinic >= 1)`,
]
