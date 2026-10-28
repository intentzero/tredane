import type { Clock } from '../../db/clock'
import type { ClinicDb } from '../store'
import { isWhatsappConnected } from '../whatsapp'
import { ensureClinicSettings } from './settings'
import { CLINIC_SCOPE_ID, type ConfigReadiness } from './types'

/**
 * Configuração mínima para agendar (REQ-052 / AC-14 / DEC-008).
 * WhatsApp: espelho DO (#31); índice global e tokens no D1.
 */
export function computeConfigReadiness(
  db: ClinicDb,
  tenantId: string,
  clock: Clock,
  opts: { whatsappConnected?: boolean } = {},
): ConfigReadiness {
  const settings = ensureClinicSettings(db, tenantId, clock)

  const servicesActive =
    db.get<{ n: number }>(
      `SELECT COUNT(*) AS n FROM services WHERE tenant_id = ? AND active = 1`,
      tenantId,
    )?.n ?? 0

  const professionalsActive =
    db.get<{ n: number }>(
      `SELECT COUNT(*) AS n FROM resources
       WHERE tenant_id = ? AND kind = 'professional' AND active = 1`,
      tenantId,
    )?.n ?? 0

  const roomsActive =
    db.get<{ n: number }>(
      `SELECT COUNT(*) AS n FROM resources
       WHERE tenant_id = ? AND kind IN ('room', 'equipment') AND active = 1`,
      tenantId,
    )?.n ?? 0

  const resourcesWithWeekly =
    db.get<{ n: number }>(
      `SELECT COUNT(DISTINCT resource_id) AS n FROM weekly_windows
       WHERE tenant_id = ?`,
      tenantId,
    )?.n ?? 0

  const missing: ConfigReadiness['missing'] = []
  if (servicesActive < 1) missing.push('service')
  if (professionalsActive < 1) missing.push('professional')
  // Decisão 28/10/2026: sala/equipamento não tem expediente e só é exigida
  // quando algum serviço activo pede sala; então tem de existir uma activa
  // que satisfaça esse pedido.
  if (roomRequirementUnmet(db, tenantId)) missing.push('room_or_equipment')
  // Expediente: pelo menos um profissional activo com janelas.
  const clinicHasWindows =
    (db.get<{ n: number }>(
      `SELECT COUNT(*) AS n FROM weekly_windows WHERE tenant_id = ? AND resource_id = ?`,
      tenantId,
      CLINIC_SCOPE_ID,
    )?.n ?? 0) > 0
  const proWithWeekly =
    db.get<{ n: number }>(
      `SELECT COUNT(DISTINCT r.id) AS n
       FROM resources r
       WHERE r.tenant_id = ? AND r.kind = 'professional' AND r.active = 1
         AND (
           (r.hours_mode = 'clinic' AND ?)
           OR EXISTS (
             SELECT 1 FROM weekly_windows w
             WHERE w.tenant_id = r.tenant_id AND w.resource_id = r.id
           )
         )`,
      tenantId,
      clinicHasWindows ? 1 : 0,
    )?.n ?? 0
  if (proWithWeekly < 1) {
    missing.push('weekly_availability')
  }

  const whatsappConnected =
    opts.whatsappConnected === true || isWhatsappConnected(db, tenantId)
  if (!whatsappConnected) missing.push('whatsapp')

  const agendaConfigured = !missing.some(
    (m) =>
      m === 'service'
      || m === 'professional'
      || m === 'room_or_equipment'
      || m === 'weekly_availability',
  )

  return {
    agendaConfigured,
    readyToServe: agendaConfigured && whatsappConnected,
    schedulingAllowed: agendaConfigured,
    missing,
    timezone: settings.timezone,
    counts: {
      servicesActive,
      professionalsActive,
      roomsActive,
      resourcesWithWeekly,
    },
  }
}

function roomRequirementUnmet(db: ClinicDb, tenantId: string): boolean {
  const reqs = db.all<{ mode: string; category: string | null; resource_id: string | null }>(
    `SELECT q.mode, q.category, q.resource_id
     FROM service_room_requirements q
     INNER JOIN services s ON s.tenant_id = q.tenant_id AND s.id = q.service_id
     WHERE q.tenant_id = ? AND s.active = 1 AND q.mode <> 'none'`,
    tenantId,
  )
  if (reqs.length === 0) return false
  const rooms = db.all<{ id: string; category: string | null }>(
    `SELECT id, category FROM resources
     WHERE tenant_id = ? AND kind IN ('room', 'equipment') AND active = 1`,
    tenantId,
  )
  return reqs.some((q) => {
    if (q.mode === 'resource') return !rooms.some((r) => r.id === q.resource_id)
    if (q.mode === 'category') return !rooms.some((r) => r.category === q.category)
    return rooms.length === 0
  })
}
