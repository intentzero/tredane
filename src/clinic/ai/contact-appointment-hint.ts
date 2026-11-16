import type { Clock } from '../../db/clock'
import { listServices } from '../config/services'
import { clinicCivilDateFromUtc } from '../scheduling/timezone'
import type { ClinicDb } from '../store'
import { dayTextPt } from './slot-offer'

type Row = {
  starts_at: number
  service_id: string
}

function localHHMM(tz: string, ms: number): string {
  const parts = new Intl.DateTimeFormat('pt-BR', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(ms)
  const hh = parts.find((p) => p.type === 'hour')?.value ?? '00'
  const mm = parts.find((p) => p.type === 'minute')?.value ?? '00'
  return `${hh}:${mm}`
}

/** Compromisso confirmado do contato no dia civil pedido (futuro ou hoje). */
export function findContactAppointmentOnDate(
  db: ClinicDb,
  tenantId: string,
  contactId: string,
  date: string,
  tz: string,
  clock: Clock,
): { time: string; serviceLabel: string } | null {
  const rows = db.all<Row>(
    `SELECT starts_at, service_id
     FROM appointments
     WHERE tenant_id = ? AND contact_id = ? AND status = 'confirmed' AND starts_at >= ?`,
    tenantId,
    contactId,
    clock.nowMs() - 86_400_000,
  )
  const services = listServices(db, tenantId)
  for (const row of rows) {
    if (clinicCivilDateFromUtc(tz, row.starts_at) !== date) continue
    const svc = services.find((s) => s.id === row.service_id)
    const label = svc?.name?.trim() || 'procedimento'
    return { time: localHHMM(tz, row.starts_at), serviceLabel: label }
  }
  return null
}

export function existingAppointmentPrefix(
  db: ClinicDb,
  tenantId: string,
  contactId: string,
  date: string,
  tz: string,
  clock: Clock,
): string | null {
  const hit = findContactAppointmentOnDate(db, tenantId, contactId, date, tz, clock)
  if (!hit) return null
  const today = clinicCivilDateFromUtc(tz, clock.nowMs())
  const when = dayTextPt(date, today)
  const dayPhrase =
    when === 'hoje' || when === 'amanhã' ? `${when}` : `na ${when}`
  return `Você já tem ${hit.serviceLabel} ${dayPhrase} às ${hit.time}. É para outro horário ou serviço?\n\n`
}