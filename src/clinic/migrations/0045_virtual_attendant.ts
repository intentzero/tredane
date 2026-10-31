/**
 * Migração 45 — atendente virtual (DEC-089 / épico #354).
 * Nome e género opcionais na persona/copy da IA; só a responsável grava.
 */
export const MIGRATION_ID = 45
export const MIGRATION_NAME = '0045_virtual_attendant'

export const STATEMENTS: readonly string[] = [
  `ALTER TABLE clinic_settings
    ADD COLUMN virtual_attendant_name TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE clinic_settings
    ADD COLUMN virtual_attendant_gender TEXT
      CHECK (
        virtual_attendant_gender IS NULL
        OR virtual_attendant_gender IN ('masculino', 'feminino')
      )`,
]
