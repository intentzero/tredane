/**
 * Migração 49 — BookingFrame (ADR-0015 / DEC-127 / #412 M2).
 * Estende `schedule_sessions` com data absoluta, pending, lastOffer, phase, etc.
 * Copia serviço/linha/variantes/período/hora; NÃO copia `day_label` (date fica NULL).
 * `day_label` fica órfã (sem DROP COLUMN) — o código novo ignora-a após o cutover.
 */
export const MIGRATION_ID = 49
export const MIGRATION_NAME = '0049_booking_frame'

export const STATEMENTS: readonly string[] = [
  `ALTER TABLE schedule_sessions ADD COLUMN phase TEXT`,
  `ALTER TABLE schedule_sessions ADD COLUMN line TEXT`,
  `ALTER TABLE schedule_sessions ADD COLUMN professional_pref TEXT`,
  `ALTER TABLE schedule_sessions ADD COLUMN date TEXT`,
  `ALTER TABLE schedule_sessions ADD COLUMN time TEXT`,
  `ALTER TABLE schedule_sessions ADD COLUMN pending_json TEXT`,
  `ALTER TABLE schedule_sessions ADD COLUMN last_offer_json TEXT`,
  `ALTER TABLE schedule_sessions ADD COLUMN proposal_json TEXT`,
  `ALTER TABLE schedule_sessions ADD COLUMN reschedule_appointment_id TEXT`,
  `ALTER TABLE schedule_sessions ADD COLUMN catalog_version TEXT`,
  `ALTER TABLE schedule_sessions ADD COLUMN provenance_json TEXT`,
  // DEC-127.4: descarta só o dia relativo; resto preservado. date permanece NULL.
  `UPDATE schedule_sessions SET
     phase = COALESCE(phase, 'coletando'),
     line = COALESCE(line, audience_line),
     time = COALESCE(time, clock_time),
     date = NULL,
     catalog_version = COALESCE(catalog_version, ''),
     provenance_json = COALESCE(provenance_json, '{}')
   WHERE service_id IS NOT NULL`,
]
