/**
 * Migração 33 — bloco Tempo no serviço (DEC-077 / S1).
 * Padrão «Tanto faz» e local nenhum. Não infere pelo nome do serviço
 * e não copia clinic_address. Contato e compromisso não ganham coluna.
 */
export const MIGRATION_ID = 33
export const MIGRATION_NAME = '0033_service_tempo'

export const STATEMENTS: readonly string[] = [
  `ALTER TABLE services
    ADD COLUMN tempo_ceu TEXT NOT NULL DEFAULT 'tanto_faz'
    CHECK (tempo_ceu IN ('tanto_faz', 'sol', 'chuva'))`,
  `ALTER TABLE services
    ADD COLUMN tempo_temperatura TEXT NOT NULL DEFAULT 'tanto_faz'
    CHECK (tempo_temperatura IN ('tanto_faz', 'acima', 'abaixo'))`,
  `ALTER TABLE services
    ADD COLUMN tempo_celsius INTEGER`,
  `ALTER TABLE clinic_settings
    ADD COLUMN tempo_local TEXT NOT NULL DEFAULT 'nenhum'
    CHECK (tempo_local IN ('nenhum', 'cidade', 'coordenadas'))`,
  `ALTER TABLE clinic_settings
    ADD COLUMN tempo_cidade TEXT`,
  `ALTER TABLE clinic_settings
    ADD COLUMN tempo_latitude REAL`,
  `ALTER TABLE clinic_settings
    ADD COLUMN tempo_longitude REAL`,
]
