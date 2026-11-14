/**
 * Migração 67 — «Explicação para a IA» por variante de zona (espelho de DEC-046
 * / `services.client_explanation` nas linhas de `service_zones`, DEC-078/079).
 * Texto opcional; a IA só descreve a variante com este campo.
 */
export const MIGRATION_ID = 67
export const MIGRATION_NAME = '0067_zone_client_explanation'

export const STATEMENTS: readonly string[] = [
  `ALTER TABLE service_zones ADD COLUMN client_explanation TEXT`,
]
