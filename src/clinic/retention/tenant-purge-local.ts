/**
 * Wipe do SQLite operacional do Clinic DO (#43 / REQ-071).
 * Idempotente: se já `wiped`, no-op. Sem efeitos R2/D1.
 */
import type { Clock } from '../../db/clock'
import { writeOperationalAudit } from '../audit'
import type { ClinicCaller } from '../envelopes'
import { assertValidCaller } from '../envelopes'
import { assertClinicSchemaReady } from '../migrations'
import type { ClinicDb } from '../store'
import { bindOrAssertTenant } from '../tenant'
import type { ClinicPurgeStateRow } from './types'

/**
 * Ordem filhas → pais para respeitar FKs SQLite.
 * Configuração da clínica também sai no encerramento (REQ-071 exclusão total).
 * Mantém: clinic_schema_*, clinic_meta, realtime_*, clinic_purge_state, operational_audit
 * (audit sem conteúdo clínico apagado — só acções; Em aberto retenção de logs).
 */
const WIPE_TABLES: readonly string[] = [
  'ai_suggestions',
  'ai_commands',
  'pix_exception_commands',
  'pix_lifecycle_events',
  'pix_webhook_events',
  'pix_payment_alerts',
  'pix_charge_commands',
  'pix_charges',
  'scheduling_intents',
  'pix_account',
  'outbound_messages',
  'attachments',
  'messages',
  'schedule_holds',
  'opportunity_stage_history',
  'opportunities',
  'appointment_commands',
  'appointment_events',
  'appointment_allocations',
  'appointments',
  'conversations',
  'contact_deletion_tombstones',
  'contacts',
  'whatsapp_templates',
  'whatsapp_channel_events',
  'whatsapp_channel',
  'resource_blocks',
  'weekly_windows',
  'service_room_requirements',
  'service_professionals',
  'service_weekly_windows',
  'services',
  'resources',
  'clinic_settings',
  'inbound_events',
  'outbox_events',
  'f0_probe',
]

function tableExists(db: ClinicDb, name: string): boolean {
  const row = db.get<{ n: number }>(
    `SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = ?`,
    name,
  )
  return Number(row?.n ?? 0) > 0
}

export function getClinicPurgeState(db: ClinicDb): ClinicPurgeStateRow {
  assertClinicSchemaReady(db)
  const row = db.get<{
    status: string
    last_step: string | null
    updated_at: number
    wiped_at: number | null
  }>(`SELECT status, last_step, updated_at, wiped_at FROM clinic_purge_state WHERE id = 1`)
  if (!row) {
    return { status: 'idle', lastStep: null, updatedAt: 0, wipedAt: null }
  }
  return {
    status: row.status as ClinicPurgeStateRow['status'],
    lastStep: row.last_step,
    updatedAt: row.updated_at,
    wipedAt: row.wiped_at,
  }
}

export type WipeClinicDataResult = {
  alreadyWiped: boolean
  deletedCounts: Record<string, number>
  openFinancialBeforeWipe: number
  purgedAt: number
}

/**
 * Conta cobranças/estornos abertos (sem PII) antes do wipe — gate Em aberto.
 */
export function countOpenFinancialItems(db: ClinicDb, tenantId: string): number {
  assertClinicSchemaReady(db)
  let n = 0
  if (tableExists(db, 'pix_charges')) {
    const row = db.get<{ n: number }>(
      `SELECT COUNT(*) AS n FROM pix_charges
       WHERE tenant_id = ?
         AND status IN (
           'awaiting_payment', 'paid', 'refund_requested', 'refund_failed'
         )`,
      tenantId,
    )
    n += Number(row?.n ?? 0)
  }
  return n
}

export function wipeClinicOperationalData(
  db: ClinicDb,
  caller: ClinicCaller,
  clock: Clock,
): WipeClinicDataResult {
  assertClinicSchemaReady(db)
  assertValidCaller(caller)
  const meta = bindOrAssertTenant(db, caller, clock)

  const current = getClinicPurgeState(db)
  if (current.status === 'wiped') {
    return {
      alreadyWiped: true,
      deletedCounts: {},
      openFinancialBeforeWipe: 0,
      purgedAt: current.wipedAt ?? current.updatedAt,
    }
  }

  return db.transactionSync(() => {
    const now = clock.nowMs()
    db.run(
      `UPDATE clinic_purge_state
       SET status = 'wiping', last_step = 'start', updated_at = ?
       WHERE id = 1`,
      now,
    )

    const openFinancialBeforeWipe = countOpenFinancialItems(db, meta.tenantId)
    const deletedCounts: Record<string, number> = {}

    for (const table of WIPE_TABLES) {
      if (!tableExists(db, table)) continue
      // Preferir DELETE por tenant_id; fallback a limpar a instância inteira
      // (DO = uma clínica) se a tabela não tiver a coluna.
      try {
        const result = db.run(`DELETE FROM ${table} WHERE tenant_id = ?`, meta.tenantId)
        deletedCounts[table] = result.changes ?? 0
      } catch {
        try {
          const result = db.run(`DELETE FROM ${table}`)
          deletedCounts[table] = result.changes ?? 0
        } catch {
          deletedCounts[table] = 0
        }
      }
    }

    // Auditoria operacional mínima — sem conteúdo apagado.
    writeOperationalAudit(
      db,
      {
        tenantId: meta.tenantId,
        actor: caller.actorId ?? caller.kind,
        action: 'clinic.purge.wiped',
        objectType: 'clinic',
        objectId: meta.tenantId,
        detail: {
          openFinancialBeforeWipe,
          tableCount: Object.keys(deletedCounts).length,
        },
      },
      clock,
    )

    const wipedAt = clock.nowMs()
    db.run(
      `UPDATE clinic_purge_state
       SET status = 'wiped', last_step = 'done', updated_at = ?, wiped_at = ?
       WHERE id = 1`,
      wipedAt,
      wipedAt,
    )

    return {
      alreadyWiped: false,
      deletedCounts,
      openFinancialBeforeWipe,
      purgedAt: wipedAt,
    }
  })
}
