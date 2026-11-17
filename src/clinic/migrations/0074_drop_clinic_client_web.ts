/**
 * DEC-202: a página web da cliente fica sempre ligada; o interruptor da owner por clínica
 * (tabela da migração 0073) sai.
 */
export const MIGRATION_ID = 74
export const MIGRATION_NAME = '0074_drop_clinic_client_web'

export const STATEMENTS = [`DROP TABLE IF EXISTS clinic_client_web`] as const
