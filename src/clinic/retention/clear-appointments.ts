/**
 * STAGING-ONLY (Paulo, 16/11/2026): apaga todos os compromissos da clínica no Clinic DO.
 * Mantém contatos, conversas, serviços, salas, Pix e restante configuração.
 * Oportunidades com vínculo a horário são realinhadas (DEC-092): Agendado sem
 * compromisso futuro volta a Em atendimento; Agendado manual sem vínculo (DEC-040) fica.
 * O gate de ambiente/papel/confirmação é feito no Worker (src/clinic-reset/routes.ts).
 */
import type { Clock } from '../../db/clock'
import { writeOperationalAudit } from '../audit'
import type { ClinicCaller } from '../envelopes'
import { assertValidCaller } from '../envelopes'
import { assertClinicSchemaReady } from '../migrations'
import { alignOpportunityToAppointments } from '../pipeline/appointment-stage'
import type { ClinicDb } from '../store'
import { bindOrAssertTenant } from '../tenant'

/** Filhas → pais (FKs). Todas filtradas por `tenant_id`. */
export const APPOINTMENT_CLEAR_TABLES: readonly string[] = [
  'appointment_commands',
  'appointment_events',
  'appointment_allocations',
  'appointments',
  'schedule_holds',
]

export type ClearAppointmentsResult = {
  tenantId: string
  deletedCounts: Record<string, number>
  totalDeleted: number
  clearedAt: number
  auditId: string
}

function tableExists(db: ClinicDb, name: string): boolean {
  const row = db.get<{ n: number }>(
    `SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = ?`,
    name,
  )
  return Number(row?.n ?? 0) > 0
}

function deleteVisitSnapshotsForAppointments(db: ClinicDb, tenantId: string): number {
  let n = 0
  if (tableExists(db, 'visit_zone_snapshots')) {
    const r = db.run(
      `DELETE FROM visit_zone_snapshots WHERE tenant_id = ? AND owner_kind = ?`,
      tenantId,
      'appointment',
    )
    n += Number(r.changes ?? 0)
  }
  if (tableExists(db, 'visit_combo_snapshots')) {
    const r = db.run(
      `DELETE FROM visit_combo_snapshots WHERE tenant_id = ? AND owner_kind = ?`,
      tenantId,
      'appointment',
    )
    n += Number(r.changes ?? 0)
  }
  return n
}

/**
 * Hard-delete de todos os compromissos (passados e futuros) + holds da clínica.
 * Não toca contatos, conversas, propostas abertas, serviços nem config.
 * Idempotente: segunda chamada só regista zeros nas contagens.
 */
export function clearClinicAppointments(
  db: ClinicDb,
  caller: ClinicCaller,
  clock: Clock,
): ClearAppointmentsResult {
  assertClinicSchemaReady(db)
  assertValidCaller(caller)
  const meta = bindOrAssertTenant(db, caller, clock)
  const tenantId = meta.tenantId

  return db.transactionSync(() => {
    const deletedCounts: Record<string, number> = {}
    let totalDeleted = 0
    const now = clock.nowMs()
    const actorId = caller.actorId ?? caller.kind

    // Conversas cuja oportunidade aberta apontava a um compromisso — realinhar
    // depois do DELETE (DEC-092). Não inclui Agendado manual sem vínculo (DEC-040).
    const linkedConversations = tableExists(db, 'opportunities')
      ? db.all<{ conversation_id: string }>(
          `SELECT DISTINCT conversation_id AS conversation_id
           FROM opportunities
           WHERE tenant_id = ?
             AND status = 'open'
             AND linked_appointment_id IS NOT NULL`,
          tenantId,
        )
      : []

    const visitSnapshots = deleteVisitSnapshotsForAppointments(db, tenantId)
    deletedCounts.visit_snapshots = visitSnapshots
    totalDeleted += visitSnapshots

    for (const table of APPOINTMENT_CLEAR_TABLES) {
      if (!tableExists(db, table)) continue
      const result = db.run(`DELETE FROM ${table} WHERE tenant_id = ?`, tenantId)
      const n = Number(result.changes ?? 0)
      deletedCounts[table] = n
      totalDeleted += n
    }

    for (const row of linkedConversations) {
      alignOpportunityToAppointments(
        db,
        {
          tenantId,
          conversationId: row.conversation_id,
          now,
          actorClerkUserId: actorId,
          actorDisplayName: actorId,
        },
        clock,
      )
    }

    // Evita ponteiros órfãos restantes (ex.: ciclos fechados) sem apagar oportunidades.
    if (tableExists(db, 'opportunities')) {
      db.run(
        `UPDATE opportunities SET linked_appointment_id = NULL, updated_at = ?
         WHERE tenant_id = ? AND linked_appointment_id IS NOT NULL`,
        now,
        tenantId,
      )
    }

    const audit = writeOperationalAudit(
      db,
      {
        tenantId,
        actor: actorId,
        action: 'clinic.appointments_cleared',
        objectType: 'clinic',
        objectId: tenantId,
        detail: { deletedCounts, totalDeleted },
      },
      clock,
    )
    return {
      tenantId,
      deletedCounts,
      totalDeleted,
      clearedAt: audit.occurredAt,
      auditId: audit.id,
    }
  })
}
