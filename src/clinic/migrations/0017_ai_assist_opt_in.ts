/**
 * Migração 17 — opt-in de IA por clínica (política de privacidade §6:
 * "somente se a clínica optar por ativá-las"). Default desligado (0):
 * nenhuma clínica chama o modelo até o responsável ativar.
 */
export const MIGRATION_ID = 17
export const MIGRATION_NAME = '0017_ai_assist_opt_in'

export const STATEMENTS: readonly string[] = [
  `ALTER TABLE clinic_settings
    ADD COLUMN ai_assist_enabled INTEGER NOT NULL DEFAULT 0
    CHECK (ai_assist_enabled IN (0, 1))`,
]
