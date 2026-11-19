/**
 * DEC-216: «Sugerir resposta» (rascunho para a equipe rever) separa-se do envio automático.
 * `ai_assist_enabled` fica como interruptor do envio automático; `ai_suggest_enabled` é o do
 * botão «Sugerir» no painel. Clínicas que já tinham a IA ligada mantêm as duas coisas.
 */
export const MIGRATION_ID = 78
export const MIGRATION_NAME = '0078_ai_suggest_opt_in'

export const STATEMENTS = [
  `ALTER TABLE clinic_settings
    ADD COLUMN ai_suggest_enabled INTEGER NOT NULL DEFAULT 0
    CHECK (ai_suggest_enabled IN (0, 1))`,
  `UPDATE clinic_settings SET ai_suggest_enabled = ai_assist_enabled`,
] as const
