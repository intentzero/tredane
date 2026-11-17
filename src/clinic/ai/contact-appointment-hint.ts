import type { Clock } from '../../db/clock'
import { listServices } from '../config/services'
import { clinicCivilDateFromUtc } from '../scheduling/timezone'
import type { ClinicDb } from '../store'
import { dayTextPt } from './slot-offer'

type Row = {
  starts_at: number
  ends_at: number
  service_id: string
}

/** Intervalos confirmados do contato (futuro recente) — excluir ofertas sobrepostas (P13). */
export function listContactAppointmentRanges(
  db: ClinicDb,
  tenantId: string,
  contactId: string,
  clock: Clock,
): Array<{ startsAt: number; endsAt: number }> {
  return db
    .all<Row>(
      `SELECT starts_at, ends_at, service_id
       FROM appointments
       WHERE tenant_id = ? AND contact_id = ? AND status = 'confirmed' AND ends_at >= ?`,
      tenantId,
      contactId,
      clock.nowMs() - 86_400_000,
    )
    .map((row) => ({ startsAt: row.starts_at, endsAt: row.ends_at }))
}

export function slotOverlapsContactBooking(
  startsAt: number,
  durationMinutes: number,
  ranges: readonly { startsAt: number; endsAt: number }[],
): boolean {
  const endsAt = startsAt + durationMinutes * 60_000
  return ranges.some((r) => r.startsAt < endsAt && r.endsAt > startsAt)
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

export type ContactFutureAppointment = {
  startsAt: number
  serviceLabel: string
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
    `SELECT starts_at, ends_at, service_id
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