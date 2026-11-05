/**
 * Migração 52 — termos que a cliente usou e não casaram nenhum serviço (DEC-141).
 * Guarda só o termo (eco do `catalogMissHint`), contagem e datas: sem conversa,
 * contato nem texto da mensagem. A owner grava como sinónimo ou descarta (DEC-042).
 */
export const MIGRATION_ID = 52
export const MIGRATION_NAME = '0052_unmatched_terms'

export const STATEMENTS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS unmatched_terms (
    tenant_id TEXT NOT NULL,
    id TEXT NOT NULL,
    term TEXT NOT NULL,
    term_folded TEXT NOT NULL,
    hits INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'aberto' CHECK (status IN ('aberto', 'gravado', 'descartado')),
    first_seen_at INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL,
    resolved_at INTEGER,
    resolved_by TEXT,
    resolved_service_id TEXT,
    PRIMARY KEY (tenant_id, id),
    UNIQUE (tenant_id, term_folded)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_unmatched_terms_status ON unmatched_terms (tenant_id, status, last_seen_at)`,
]
