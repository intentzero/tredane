/**
 * DEC-185 — FAQ / conhecimento institucional da clínica.
 * Categorias CRUD (owner) + entradas Q&A (draft|published); sem RAG.
 */
export const MIGRATION_ID = 68
export const MIGRATION_NAME = '0068_clinic_knowledge'

export const STATEMENTS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS clinic_knowledge_categories (
    tenant_id TEXT NOT NULL,
    id TEXT NOT NULL,
    name TEXT NOT NULL,
    name_folded TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (tenant_id, id),
    UNIQUE (tenant_id, name_folded)
  )`,
  `CREATE TABLE IF NOT EXISTS clinic_knowledge_entries (
    tenant_id TEXT NOT NULL,
    id TEXT NOT NULL,
    category_id TEXT NOT NULL,
    question TEXT NOT NULL,
    answer TEXT NOT NULL,
    match_cues_json TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
    source_key TEXT,
    version INTEGER NOT NULL DEFAULT 1,
    created_by TEXT,
    updated_by TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    published_at INTEGER,
    PRIMARY KEY (tenant_id, id),
    FOREIGN KEY (tenant_id, category_id)
      REFERENCES clinic_knowledge_categories(tenant_id, id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_clinic_knowledge_entries_status
    ON clinic_knowledge_entries (tenant_id, status, updated_at)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_clinic_knowledge_entries_source
    ON clinic_knowledge_entries (tenant_id, source_key)
    WHERE source_key IS NOT NULL`,
]
