import { CLINIC_SCHEMA_VERSION } from './constants'
import { SchemaNotReadyError } from './errors'
import {
  MIGRATION_ID as M1_ID,
  MIGRATION_NAME as M1_NAME,
  STATEMENTS as M1_STATEMENTS,
} from './migrations/0001_clinic_foundation'
import {
  MIGRATION_ID as M2_ID,
  MIGRATION_NAME as M2_NAME,
  STATEMENTS as M2_STATEMENTS,
} from './migrations/0002_realtime_fence'
import {
  MIGRATION_ID as M3_ID,
  MIGRATION_NAME as M3_NAME,
  STATEMENTS as M3_STATEMENTS,
} from './migrations/0003_clinic_config'
import {
  MIGRATION_ID as M4_ID,
  MIGRATION_NAME as M4_NAME,
  STATEMENTS as M4_STATEMENTS,
} from './migrations/0004_inbox'
import {
  MIGRATION_ID as M5_ID,
  MIGRATION_NAME as M5_NAME,
  STATEMENTS as M5_STATEMENTS,
} from './migrations/0005_pipeline'
import {
  MIGRATION_ID as M6_ID,
  MIGRATION_NAME as M6_NAME,
  STATEMENTS as M6_STATEMENTS,
} from './migrations/0006_whatsapp_channel'
import {
  MIGRATION_ID as M7_ID,
  MIGRATION_NAME as M7_NAME,
  STATEMENTS as M7_STATEMENTS,
} from './migrations/0007_outbound_send'
import type { ClinicDb } from './store'
import type { Clock } from '../db/clock'

export type ClinicMigration = {
  id: number
  name: string
  statements: readonly string[]
}

/** Catálogo ordenado — acrescentar migrações futuras aqui (nunca reescrever aplicadas). */
export const CLINIC_MIGRATIONS: readonly ClinicMigration[] = [
  { id: M1_ID, name: M1_NAME, statements: M1_STATEMENTS },
  { id: M2_ID, name: M2_NAME, statements: M2_STATEMENTS },
  { id: M3_ID, name: M3_NAME, statements: M3_STATEMENTS },
  { id: M4_ID, name: M4_NAME, statements: M4_STATEMENTS },
  { id: M5_ID, name: M5_NAME, statements: M5_STATEMENTS },
  { id: M6_ID, name: M6_NAME, statements: M6_STATEMENTS },
  { id: M7_ID, name: M7_NAME, statements: M7_STATEMENTS },
]

export type MigrationResult = {
  fromVersion: number
  toVersion: number
  applied: string[]
  status: 'ready' | 'already_ready'
}

function readState(db: ClinicDb): { version: number; status: string } | undefined {
  try {
    return db.get<{ version: number; status: string }>(
      'SELECT version, status FROM clinic_schema_state WHERE id = 1',
    )
  } catch {
    return undefined
  }
}

function ensureBootstrapTables(db: ClinicDb): void {
  // Tabelas de controlo criadas fora das migrações numeradas só se ainda
  // não existirem — permite retomar após falha a meio da migração 1.
  db.exec(`
    CREATE TABLE IF NOT EXISTS clinic_schema_migrations (
      id INTEGER PRIMARY KEY NOT NULL,
      name TEXT NOT NULL UNIQUE,
      applied_at INTEGER NOT NULL
    )
  `)
  db.exec(`
    CREATE TABLE IF NOT EXISTS clinic_schema_state (
      id INTEGER PRIMARY KEY NOT NULL CHECK (id = 1),
      version INTEGER NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('ready', 'migrating', 'failed')),
      updated_at INTEGER NOT NULL
    )
  `)
}

/**
 * Runner SQL versionado por instância do DO.
 * Diferente das migrations de classe Wrangler (`new_sqlite_classes`).
 * Falha deixa `status=failed|migrating` e bloqueia operações de negócio.
 * Retentativa é segura: statements usam IF NOT EXISTS / criação idempotente
 * via controlo de versão (só corre migrações com id > version).
 */
export function runClinicMigrations(db: ClinicDb, clock: Clock): MigrationResult {
  ensureBootstrapTables(db)

  const existing = readState(db)
  const fromVersion = existing?.version ?? 0

  if (existing?.status === 'ready' && existing.version === CLINIC_SCHEMA_VERSION) {
    return {
      fromVersion,
      toVersion: existing.version,
      applied: [],
      status: 'already_ready',
    }
  }

  const now = clock.nowMs()
  const pending = CLINIC_MIGRATIONS.filter((m) => m.id > fromVersion)

  if (pending.length === 0 && existing?.status === 'ready') {
    return {
      fromVersion,
      toVersion: existing.version,
      applied: [],
      status: 'already_ready',
    }
  }

  db.run(
    `INSERT INTO clinic_schema_state (id, version, status, updated_at)
     VALUES (1, ?, 'migrating', ?)
     ON CONFLICT(id) DO UPDATE SET status = 'migrating', updated_at = excluded.updated_at`,
    fromVersion,
    now,
  )

  const applied: string[] = []
  let version = fromVersion

  try {
    for (const migration of pending) {
      db.transactionSync(() => {
        for (const statement of migration.statements) {
          db.exec(statement)
        }
        db.run(
          `INSERT OR IGNORE INTO clinic_schema_migrations (id, name, applied_at)
           VALUES (?, ?, ?)`,
          migration.id,
          migration.name,
          clock.nowMs(),
        )
        db.run(
          `UPDATE clinic_schema_state SET version = ?, status = 'ready', updated_at = ? WHERE id = 1`,
          migration.id,
          clock.nowMs(),
        )
      })
      applied.push(migration.name)
      version = migration.id
    }
  } catch (err) {
    try {
      db.run(
        `UPDATE clinic_schema_state SET status = 'failed', updated_at = ? WHERE id = 1`,
        clock.nowMs(),
      )
    } catch {
      /* ignore */
    }
    throw err
  }

  if (version !== CLINIC_SCHEMA_VERSION) {
    db.run(
      `UPDATE clinic_schema_state SET status = 'failed', updated_at = ? WHERE id = 1`,
      clock.nowMs(),
    )
    throw new SchemaNotReadyError(
      `versão ${version} após migrações; esperada ${CLINIC_SCHEMA_VERSION}`,
    )
  }

  return { fromVersion, toVersion: version, applied, status: 'ready' }
}

/**
 * Impede uso com schema parcial ou migração falhada.
 * Operações de negócio devem chamar isto antes de ler/escrever.
 */
export function assertClinicSchemaReady(db: ClinicDb): void {
  const state = readState(db)
  if (!state) {
    throw new SchemaNotReadyError('clinic_schema_state ausente')
  }
  if (state.status !== 'ready') {
    throw new SchemaNotReadyError(`status=${state.status}`)
  }
  if (state.version !== CLINIC_SCHEMA_VERSION) {
    throw new SchemaNotReadyError(
      `esperada ${CLINIC_SCHEMA_VERSION}, encontrada ${state.version}`,
    )
  }
}

/** Simula falha a meio de uma migração (testes): marca failed sem completar. */
export function markClinicSchemaFailed(db: ClinicDb, clock: Clock): void {
  ensureBootstrapTables(db)
  db.run(
    `INSERT INTO clinic_schema_state (id, version, status, updated_at)
     VALUES (1, 0, 'failed', ?)
     ON CONFLICT(id) DO UPDATE SET status = 'failed', updated_at = excluded.updated_at`,
    clock.nowMs(),
  )
}
