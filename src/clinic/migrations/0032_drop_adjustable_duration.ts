/**
 * Migração 32 — DEC-076: a duração ajustável sai de todos os procedimentos.
 * As colunas ficam (compromissos antigos guardam a duração com que foram
 * marcados). O cadastro deixa de as usar.
 */
export const MIGRATION_ID = 32
export const MIGRATION_NAME = '0032_drop_adjustable_duration'

export const STATEMENTS: readonly string[] = [
  `UPDATE services
     SET duration_adjustable = 0,
         duration_min_minutes = NULL,
         duration_max_minutes = NULL`,
]
