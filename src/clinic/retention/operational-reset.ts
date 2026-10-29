/**
 * STAGING-ONLY (Paulo, 2026-10-28): repõe a clínica ao estado inicial apagando só
 * os DADOS OPERACIONAIS do SQLite do Clinic DO (fonte de verdade operacional, DEC-038).
 *
 * Mantém conta/tenant, membros (D1), configuração da clínica, serviços, salas/profissionais,
 * horários e bloqueios, conta Pix, canal/modelos WhatsApp, estado de esquema/realtime e a
 * própria auditoria operacional. O gate de ambiente/papel/nome é feito no Worker
 * (src/clinic-reset/routes.ts); aqui só se apaga — numa única transação — e audita.
 */
import type { Clock } from '../../db/clock'
import { writeOperationalAudit } from '../audit'
import type { ClinicCaller } from '../envelopes'
import { assertValidCaller } from '../envelopes'
import { assertClinicSchemaReady } from '../migrations'
import type { ClinicDb } from '../store'
import { bindOrAssertTenant } from '../tenant'

/** Ordem filhas → pais (FKs SQLite). Todas têm `tenant_id`. */
export const OPERATIONAL_RESET_TABLES: readonly string[] = [
  'ai_autodraft_jobs',
  'ai_suggestions',
  'ai_commands',
  'ai_daily_usage',
  'pending_communications',
  'appointment_proposals',
  'pix_exception_commands',
  'pix_lifecycle_events',
  'pix_webhook_events',
  'pix_payment_alerts',
  'pix_charge_commands',
  'pix_charges',
  'scheduling_intents',
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
  'inbound_events',
  'outbox_events',
]

/** Tabelas do Clinic DO que o reset NÃO toca (documentação + teste de cobertura). */
export const OPERATIONAL_RESET_KEPT_TABLES: readonly string[] = [
  'clinic_schema_migrations',
  'clinic_schema_state',
  'clinic_meta',
  'clinic_settings',
  'clinic_purge_state',
  'operational_audit',
  'services',
  'resources',
  'service_professionals',
  'service_weekly_windows',
  'service_room_requirements',
  'weekly_windows',
  'resource_blocks',
  'pix_account',
  'whatsapp_channel',
  'whatsapp_channel_events',
  'whatsapp_templates',
  'realtime_fence',
  'realtime_events',
  'access_denials',
  'f0_probe',
]

export type OperationalResetResult = {
  tenantId: string
  deletedCounts: Record<string, number>
  totalDeleted: number
  resetAt: number
  auditId: string
}

function tableExists(db: ClinicDb, name: string): boolean {
  const row = db.get<{ n: number }>(
    `SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = ?`,
    name,
  )
  return Number(row?.n ?? 0) > 0
}

export function resetClinicOperationalData(
  db: ClinicDb,
  caller: ClinicCaller,
  clock: Clock,
): OperationalResetResult {
  assertClinicSchemaReady(db)
  assertValidCaller(caller)
  const meta = bindOrAssertTenant(db, caller, clock)
  const tenantId = meta.tenantId

  return db.transactionSync(() => {
    const deletedCounts: Record<string, number> = {}
    let totalDeleted = 0
    for (const table of OPERATIONAL_RESET_TABLES) {
      if (!tableExists(db, table)) continue
      // Sempre por tenant_id — nunca DELETE sem WHERE.
      const result = db.run(`DELETE FROM ${table} WHERE tenant_id = ?`, tenantId)
      const n = Number(result.changes ?? 0)
      deletedCounts[table] = n
      totalDeleted += n
    }
    const audit = writeOperationalAudit(
      db,
      {
        tenantId,
        actor: caller.actorId ?? caller.kind,
        action: 'clinic.operational_reset',
        objectType: 'clinic',
        objectId: tenantId,
        detail: { deletedCounts, totalDeleted },
      },
      clock,
    )
    return { tenantId, deletedCounts, totalDeleted, resetAt: audit.occurredAt, auditId: audit.id }
  })
}
