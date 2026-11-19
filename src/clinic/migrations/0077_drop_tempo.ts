/**
 * DEC-213: a previsão do tempo sai da aplicação. Apagam-se as colunas do bloco Tempo no serviço
 * e o local da previsão nas definições. `appointment_proposals.tempo_*` (migração 36) ficam: a
 * tabela foi reconstruída com CHECK e estas colunas têm valor por defeito; o código já não as usa.
 */
export const MIGRATION_ID = 77
export const MIGRATION_NAME = '0077_drop_tempo'

export const STATEMENTS = [
  `ALTER TABLE services DROP COLUMN tempo_ceu`,
  `ALTER TABLE services DROP COLUMN tempo_temperatura`,
  `ALTER TABLE services DROP COLUMN tempo_celsius`,
  `ALTER TABLE clinic_settings DROP COLUMN tempo_local`,
  `ALTER TABLE clinic_settings DROP COLUMN tempo_cidade`,
  `ALTER TABLE clinic_settings DROP COLUMN tempo_latitude`,
  `ALTER TABLE clinic_settings DROP COLUMN tempo_longitude`,
] as const
