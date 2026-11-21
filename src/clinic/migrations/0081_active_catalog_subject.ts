/**
 * DEC-223 — sujeito activo de catálogo (informativo) por conversa.
 * Separado de schedule_sessions / BookingFrame (não é escolha de marcação).
 */
export const MIGRATION_ID = 81
export const MIGRATION_NAME = '0081_active_catalog_subject'

export const STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS active_catalog_subjects (
     tenant_id TEXT NOT NULL,
     conversation_id TEXT NOT NULL,
     service_id TEXT NOT NULL,
     variant_ids TEXT,
     audience_line TEXT CHECK (audience_line IS NULL OR audience_line IN ('feminino', 'masculino')),
     source TEXT NOT NULL CHECK (source IN (
       'faq_offer',
       'faq_clarification',
       'price',
       'named_turn',
       'agenda_preselect'
     )),
     catalog_version TEXT NOT NULL DEFAULT '',
     updated_at INTEGER NOT NULL,
     PRIMARY KEY (tenant_id, conversation_id),
     FOREIGN KEY (tenant_id, conversation_id) REFERENCES conversations (tenant_id, id)
   )`,
] as const
