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

export type ContactFutureAppointment = {
  startsAt: number
  serviceLabel: string
}

/** Compromissos confirmados futuros do contato (ordenados pelo início). */
export function listFutureContactAppointments(
  db: ClinicDb,
  tenantId: string,
  contactId: string,
  clock: Clock,
  limit = 5,
): ContactFutureAppointment[] {
  const rows = db.all<Row>(
    `SELECT starts_at, service_id
     FROM appointments
     WHERE tenant_id = ? AND contact_id = ? AND status = 'confirmed' AND starts_at > ?
     ORDER BY starts_at LIMIT ?`,
    tenantId,
    contactId,
    clock.nowMs(),
    limit,
  )
  const services = listServices(db, tenantId)
  return rows.map((row) => {
    const svc = services.find((s) => s.id === row.service_id)
    return {
      startsAt: row.starts_at,
      serviceLabel: svc?.name?.trim() || 'procedimento',
    }
  })
}

function formatFutureAppointmentLine(
  tz: string,
  appt: ContactFutureAppointment,
  today: string,
): string {
  const date = clinicCivilDateFromUtc(tz, appt.startsAt)
  const when = dayTextPt(date, today)
  const dayPart = when === 'hoje' || when === 'amanhã' ? when : `na ${when}`
  return `${appt.serviceLabel} ${dayPart} às ${localHHMM(tz, appt.startsAt)}`
}

/** Lembrete antes de ofertar horários quando já há marcação futura (outro dia ou serviço). */
export function upcomingAppointmentsOfferPrefix(
  db: ClinicDb,
  tenantId: string,
  contactId: string,
  tz: string,
  clock: Clock,
): string | null {
  const appts = listFutureContactAppointments(db, tenantId, contactId, clock)
  if (appts.length === 0) return null
  const today = clinicCivilDateFromUtc(tz, clock.nowMs())
  const lista = appts.map((a) => formatFutureAppointmentLine(tz, a, today)).join('; ')
  if (appts.length === 1) {
    return `Você já tem ${lista}. É para outro horário ou serviço?\n\n`
  }
  return `Você já tem: ${lista}. É para outro horário ou serviço?\n\n`
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