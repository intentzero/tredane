/**
 * Página web da cliente: interruptor da owner por clínica (DEC-199, ADR-0018).
 * Tabela própria de uma linha por clínica; ausência de linha = desligado (fail-closed).
 */
export const MIGRATION_ID = 73
export const MIGRATION_NAME = '0073_clinic_client_web'

export const STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS clinic_client_web (
    tenant_id TEXT NOT NULL PRIMARY KEY,
    enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
    updated_by TEXT,
    updated_at INTEGER NOT NULL
  )`,
] as const
