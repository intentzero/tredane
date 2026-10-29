/**
 * Migração 31 — audiência do serviço (DEC-075 / S2).
 * Padrão qualquer; não inferir pelo nome. Contato sem sexo.
 */
export const MIGRATION_ID = 31
export const MIGRATION_NAME = '0031_service_audience'

export const STATEMENTS: readonly string[] = [
  `ALTER TABLE services
    ADD COLUMN audiencia TEXT NOT NULL DEFAULT 'qualquer'
    CHECK (audiencia IN ('feminino', 'masculino', 'qualquer'))`,
]
