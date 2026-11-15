/**
 * Migração 70 — explicação comum da variante + override opcional por género
 * (DEC-189; espelho DEC-176 nos sinónimos do grupo).
 *
 * `client_explanation` passa a ser o texto **comum** (partilhado pelo nome).
 * `client_explanation_audience` é o override opcional só daquela linha de género.
 *
 * Dados já gravados: o texto actual move-se para o override (comportamento
 * preservado); a owner pode promover para comum na ficha.
 */
export const MIGRATION_ID = 70
export const MIGRATION_NAME = '0070_zone_explanation_audience'

export const STATEMENTS: readonly string[] = [
  `ALTER TABLE service_zones ADD COLUMN client_explanation_audience TEXT`,
  `UPDATE service_zones
   SET client_explanation_audience = trim(client_explanation)
   WHERE client_explanation IS NOT NULL AND trim(client_explanation) != ''`,
  `UPDATE service_zones
   SET client_explanation = NULL
   WHERE client_explanation_audience IS NOT NULL`,
]
