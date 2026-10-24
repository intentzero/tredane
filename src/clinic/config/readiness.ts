import type { Clock } from '../../db/clock'
import type { ClinicDb } from '../store'
import { isWhatsappConnected } from '../whatsapp'
import { ensureClinicSettings } from './settings'
import type { ConfigReadiness } from './types'

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
  if (roomsActive < 1) missing.push('room_or_equipment')
  // Expediente: pelo menos um profissional activo e uma sala activa com janelas.
  const proWithWeekly =
    db.get<{ n: number }>(
      `SELECT COUNT(DISTINCT w.resource_id) AS n
       FROM weekly_windows w
       INNER JOIN resources r
         ON r.tenant_id = w.tenant_id AND r.id = w.resource_id
       WHERE w.tenant_id = ? AND r.kind = 'professional' AND r.active = 1`,
      tenantId,
    )?.n ?? 0
  const roomWithWeekly =
    db.get<{ n: number }>(
      `SELECT COUNT(DISTINCT w.resource_id) AS n
       FROM weekly_windows w
       INNER JOIN resources r
         ON r.tenant_id = w.tenant_id AND r.id = w.resource_id
       WHERE w.tenant_id = ?
         AND r.kind IN ('room', 'equipment') AND r.active = 1`,
      tenantId,
    )?.n ?? 0
  if (proWithWeekly < 1 || roomWithWeekly < 1) {
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
