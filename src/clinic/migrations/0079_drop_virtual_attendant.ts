/**
 * Remove nome e género do atendente virtual (DEC-089 revista).
 * Paulo: sem interesse em manter persona configurável; copy da IA fica neutra/fixixa.
 * A migração 45 permanece no histórico; estas colunas deixam de existir.
 */
export const MIGRATION_ID = 79
export const MIGRATION_NAME = '0079_drop_virtual_attendant'

export const STATEMENTS = [
  `ALTER TABLE clinic_settings DROP COLUMN virtual_attendant_name`,
  `ALTER TABLE clinic_settings DROP COLUMN virtual_attendant_gender`,
] as const
