/**
 * Migração 38 — mesmo sexo no horário e excepção «Permitir os dois» (DEC-075 / S5).
 * same_sex_in_slot: só salas; padrão desligado. Capacidade 1 ignora o interruptor.
 * room_sex_block_exceptions: excepção pontual por sala e intervalo, só pela responsável.
 */
export const MIGRATION_ID = 38
export const MIGRATION_NAME = '0038_room_same_sex'

export const STATEMENTS: readonly string[] = [
  `ALTER TABLE resources ADD COLUMN same_sex_in_slot INTEGER NOT NULL DEFAULT 0`,
  `CREATE TABLE room_sex_block_exceptions (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    room_resource_id TEXT NOT NULL,
    starts_at INTEGER NOT NULL,
    ends_at INTEGER NOT NULL,
    actor_clerk_user_id TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    CHECK (ends_at > starts_at)
  )`,
  `CREATE INDEX idx_room_sex_exceptions_room
    ON room_sex_block_exceptions (tenant_id, room_resource_id, starts_at, ends_at)`,
]
