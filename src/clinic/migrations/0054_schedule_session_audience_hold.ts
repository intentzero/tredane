/**
 * Migração 54 — a conversa pode guardar só a audiência (DEC-142).
 * `service_id` deixa de ser obrigatório: ao limpar o frame de marcação
 * (serviço, variantes, oferta, proposta) a linha feminino/masculino fica.
 * SQLite não tira NOT NULL com ALTER — rebuild da tabela.
 */
export const MIGRATION_ID = 54
export const MIGRATION_NAME = '0054_schedule_session_audience_hold'

export const STATEMENTS: readonly string[] = [
  `CREATE TABLE schedule_sessions__m54 (
    tenant_id TEXT NOT NULL,
    conversation_id TEXT NOT NULL,
    service_id TEXT,
    audience_line TEXT CHECK (audience_line IS NULL OR audience_line IN ('feminino', 'masculino')),
    day_label TEXT CHECK (day_label IS NULL OR day_label IN (
      'hoje', 'amanhã', 'depois de amanhã',
      'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado', 'domingo'
    )),
    period TEXT CHECK (period IS NULL OR period IN ('manha', 'tarde', 'noite')),
    updated_at INTEGER NOT NULL,
    variant_ids TEXT,
    clock_time TEXT,
    phase TEXT,
    line TEXT,
    professional_pref TEXT,
    date TEXT,
    time TEXT,
    pending_json TEXT,
    last_offer_json TEXT,
    proposal_json TEXT,
    reschedule_appointment_id TEXT,
    catalog_version TEXT,
    provenance_json TEXT,
    PRIMARY KEY (tenant_id, conversation_id),
    FOREIGN KEY (tenant_id, conversation_id) REFERENCES conversations (tenant_id, id)
  )`,

  `INSERT INTO schedule_sessions__m54 (
     tenant_id, conversation_id, service_id, audience_line, day_label, period, updated_at,
     variant_ids, clock_time, phase, line, professional_pref, date, time,
     pending_json, last_offer_json, proposal_json, reschedule_appointment_id,
     catalog_version, provenance_json
   )
   SELECT
     tenant_id, conversation_id, service_id, audience_line, day_label, period, updated_at,
     variant_ids, clock_time, phase, line, professional_pref, date, time,
     pending_json, last_offer_json, proposal_json, reschedule_appointment_id,
     catalog_version, provenance_json
   FROM schedule_sessions`,

  `DROP TABLE schedule_sessions`,

  `ALTER TABLE schedule_sessions__m54 RENAME TO schedule_sessions`,
]
