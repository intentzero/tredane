/**
 * Migração 25 — link do Google Business da clínica (contexto da IA, junto do
 * endereço). Vazio = sem link. Validado no servidor (só https, até 500 caracteres).
 */
export const MIGRATION_ID = 25
export const MIGRATION_NAME = '0025_google_business_url'

export const STATEMENTS: readonly string[] = [
  `ALTER TABLE clinic_settings ADD COLUMN google_business_url TEXT NOT NULL DEFAULT ''`,
]
