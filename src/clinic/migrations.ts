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
import {
  MIGRATION_ID as M8_ID,
  MIGRATION_NAME as M8_NAME,
  STATEMENTS as M8_STATEMENTS,
} from './migrations/0008_attachments'
import {
  MIGRATION_ID as M9_ID,
  MIGRATION_NAME as M9_NAME,
  STATEMENTS as M9_STATEMENTS,
} from './migrations/0009_appointments_booking'
import {
  MIGRATION_ID as M10_ID,
  MIGRATION_NAME as M10_NAME,
  STATEMENTS as M10_STATEMENTS,
} from './migrations/0010_pix_signal'
import {
  MIGRATION_ID as M11_ID,
  MIGRATION_NAME as M11_NAME,
  STATEMENTS as M11_STATEMENTS,
} from './migrations/0011_scheduling_intent_pix_charge'
import {
  MIGRATION_ID as M12_ID,
  MIGRATION_NAME as M12_NAME,
  STATEMENTS as M12_STATEMENTS,
} from './migrations/0012_pix_payment_confirm'
import {
  MIGRATION_ID as M13_ID,
  MIGRATION_NAME as M13_NAME,
  STATEMENTS as M13_STATEMENTS,
} from './migrations/0013_pix_exceptions'
import {
  MIGRATION_ID as M14_ID,
  MIGRATION_NAME as M14_NAME,
  STATEMENTS as M14_STATEMENTS,
} from './migrations/0014_ai_suggestions'
import {
  MIGRATION_ID as M15_ID,
  MIGRATION_NAME as M15_NAME,
  STATEMENTS as M15_STATEMENTS,
} from './migrations/0015_contact_retention'
import {
  MIGRATION_ID as M16_ID,
  MIGRATION_NAME as M16_NAME,
  STATEMENTS as M16_STATEMENTS,
} from './migrations/0016_schedule_holds'
import {
  MIGRATION_ID as M17_ID,
  MIGRATION_NAME as M17_NAME,
  STATEMENTS as M17_STATEMENTS,
} from './migrations/0017_ai_assist_opt_in'
import {
  MIGRATION_ID as M18_ID,
  MIGRATION_NAME as M18_NAME,
  STATEMENTS as M18_STATEMENTS,
} from './migrations/0018_holds_require_time'
import {
  MIGRATION_ID as M19_ID,
  MIGRATION_NAME as M19_NAME,
  STATEMENTS as M19_STATEMENTS,
} from './migrations/0019_ai_autodraft_read_receipts'
import {
  MIGRATION_ID as M20_ID,
  MIGRATION_NAME as M20_NAME,
  STATEMENTS as M20_STATEMENTS,
} from './migrations/0020_adjustable_duration'
import {
  MIGRATION_ID as M21_ID,
  MIGRATION_NAME as M21_NAME,
  STATEMENTS as M21_STATEMENTS,
} from './migrations/0021_room_capacity'
import type { ClinicDb } from './store'
import {
  MIGRATION_ID as M22_ID,
  MIGRATION_NAME as M22_NAME,
  STATEMENTS as M22_STATEMENTS,
} from './migrations/0022_contact_block'
import {
  MIGRATION_ID as M23_ID,
  MIGRATION_NAME as M23_NAME,
  STATEMENTS as M23_STATEMENTS,
} from './migrations/0023_room_requirement_any'
import {
  MIGRATION_ID as M24_ID,
  MIGRATION_NAME as M24_NAME,
  STATEMENTS as M24_STATEMENTS,
} from './migrations/0024_clinic_hours'
import {
  MIGRATION_ID as M25_ID,
  MIGRATION_NAME as M25_NAME,
  STATEMENTS as M25_STATEMENTS,
} from './migrations/0025_google_business_url'
import {
  MIGRATION_ID as M26_ID,
  MIGRATION_NAME as M26_NAME,
  STATEMENTS as M26_STATEMENTS,
} from './migrations/0026_resource_history_indexes'
import {
  MIGRATION_ID as M27_ID,
  MIGRATION_NAME as M27_NAME,
  STATEMENTS as M27_STATEMENTS,
} from './migrations/0027_service_weekly_windows'
import {
  MIGRATION_ID as M28_ID,
  MIGRATION_NAME as M28_NAME,
  STATEMENTS as M28_STATEMENTS,
} from './migrations/0028_appointment_proposals'
import {
  MIGRATION_ID as M29_ID,
  MIGRATION_NAME as M29_NAME,
  STATEMENTS as M29_STATEMENTS,
} from './migrations/0029_proposal_whatsapp_send'
import {
  MIGRATION_ID as M30_ID,
  MIGRATION_NAME as M30_NAME,
  STATEMENTS as M30_STATEMENTS,
} from './migrations/0030_clinic_abuse_limits'
import {
  MIGRATION_ID as M31_ID,
  MIGRATION_NAME as M31_NAME,
  STATEMENTS as M31_STATEMENTS,
} from './migrations/0031_service_audience'
import {
  MIGRATION_ID as M32_ID,
  MIGRATION_NAME as M32_NAME,
  STATEMENTS as M32_STATEMENTS,
} from './migrations/0032_drop_adjustable_duration'
import {
  MIGRATION_ID as M33_ID,
  MIGRATION_NAME as M33_NAME,
  STATEMENTS as M33_STATEMENTS,
} from './migrations/0033_service_tempo'
import {
  MIGRATION_ID as M34_ID,
  MIGRATION_NAME as M34_NAME,
  STATEMENTS as M34_STATEMENTS,
} from './migrations/0034_service_zones'
import {
  MIGRATION_ID as M35_ID,
  MIGRATION_NAME as M35_NAME,
  STATEMENTS as M35_STATEMENTS,
} from './migrations/0035_variant_kind_audience'
import {
  MIGRATION_ID as M36_ID,
  MIGRATION_NAME as M36_NAME,
  STATEMENTS as M36_STATEMENTS,
} from './migrations/0036_proposal_tempo_state'
import {
  MIGRATION_ID as M37_ID,
  MIGRATION_NAME as M37_NAME,
  STATEMENTS as M37_STATEMENTS,
} from './migrations/0037_professional_home_room'
import {
  MIGRATION_ID as M38_ID,
  MIGRATION_NAME as M38_NAME,
  STATEMENTS as M38_STATEMENTS,
} from './migrations/0038_room_same_sex'
import {
  MIGRATION_ID as M39_ID,
  MIGRATION_NAME as M39_NAME,
  STATEMENTS as M39_STATEMENTS,
} from './migrations/0039_variant_kind_plural'
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
  { id: M8_ID, name: M8_NAME, statements: M8_STATEMENTS },
  { id: M9_ID, name: M9_NAME, statements: M9_STATEMENTS },
  { id: M10_ID, name: M10_NAME, statements: M10_STATEMENTS },
  { id: M11_ID, name: M11_NAME, statements: M11_STATEMENTS },
  { id: M12_ID, name: M12_NAME, statements: M12_STATEMENTS },
  { id: M13_ID, name: M13_NAME, statements: M13_STATEMENTS },
  { id: M14_ID, name: M14_NAME, statements: M14_STATEMENTS },
  { id: M15_ID, name: M15_NAME, statements: M15_STATEMENTS },
  { id: M16_ID, name: M16_NAME, statements: M16_STATEMENTS },
  { id: M17_ID, name: M17_NAME, statements: M17_STATEMENTS },
  { id: M18_ID, name: M18_NAME, statements: M18_STATEMENTS },
  { id: M19_ID, name: M19_NAME, statements: M19_STATEMENTS },
  { id: M20_ID, name: M20_NAME, statements: M20_STATEMENTS },
  { id: M21_ID, name: M21_NAME, statements: M21_STATEMENTS },
  { id: M22_ID, name: M22_NAME, statements: M22_STATEMENTS },
  { id: M23_ID, name: M23_NAME, statements: M23_STATEMENTS },
  { id: M24_ID, name: M24_NAME, statements: M24_STATEMENTS },
  { id: M25_ID, name: M25_NAME, statements: M25_STATEMENTS },
  { id: M26_ID, name: M26_NAME, statements: M26_STATEMENTS },
  { id: M27_ID, name: M27_NAME, statements: M27_STATEMENTS },
  { id: M28_ID, name: M28_NAME, statements: M28_STATEMENTS },
  { id: M29_ID, name: M29_NAME, statements: M29_STATEMENTS },
  { id: M30_ID, name: M30_NAME, statements: M30_STATEMENTS },
  { id: M31_ID, name: M31_NAME, statements: M31_STATEMENTS },
  { id: M32_ID, name: M32_NAME, statements: M32_STATEMENTS },
  { id: M33_ID, name: M33_NAME, statements: M33_STATEMENTS },
  { id: M34_ID, name: M34_NAME, statements: M34_STATEMENTS },
  { id: M35_ID, name: M35_NAME, statements: M35_STATEMENTS },
  { id: M36_ID, name: M36_NAME, statements: M36_STATEMENTS },
  { id: M37_ID, name: M37_NAME, statements: M37_STATEMENTS },
  { id: M38_ID, name: M38_NAME, statements: M38_STATEMENTS },
  { id: M39_ID, name: M39_NAME, statements: M39_STATEMENTS },
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
