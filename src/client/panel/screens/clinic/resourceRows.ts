/**
 * Resumos das linhas de Profissionais, Salas e Serviços (Proposto, #226).
 * Puro, sem React: cada linha responde «quem / onde / quanto» e só avisa
 * quando algo foge do normal.
 */
import { variantKindWord } from '../../../../ai/types'
import type { ClinicConfigSnapshot, ClinicResource, ClinicService } from '../../api'
import { CLINIC_SCOPE_ID, windowsOf } from './clinicHours'
import { formatMinutes, formatPriceCents } from './format'

/** 1 = segunda … 7 = domingo, no fuso da clínica. */
export function dayOfWeekIn(now: number, timeZone: string): number {
  const name = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' }).format(now)
  const index = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(name)
  return index + 1
}

function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? ''
  return `${names.slice(0, -1).join(', ')} e ${names[names.length - 1]}`
}

export type ProfessionalRow = {
  services: string
  /** «Hoje 09:00–18:00», «Hoje sem atendimento» ou null quando falta horário. */
  today: string | null
  missingHours: boolean
}

export function professionalRow(
  snap: ClinicConfigSnapshot,
  pro: ClinicResource,
  now: number,
): ProfessionalRow {
  const names = snap.services
    .filter((s) => s.active && s.professionalIds.includes(pro.id))
    .map((s) => s.name)
  const own = pro.hoursMode === 'own'
  const windows = windowsOf(snap, own ? pro.id : CLINIC_SCOPE_ID)
  const services = names.length > 0 ? joinNames(names) : 'Nenhum serviço ainda'
  if (windows.length === 0) {
    return { services, today: null, missingHours: true }
  }
  const tz = snap.settings?.timezone ?? 'America/Sao_Paulo'
  const dow = dayOfWeekIn(now, tz)
  const today = windows
    .filter((w) => w.dayOfWeek === dow)
    .sort((a, b) => a.startMinute - b.startMinute)
    .map((w) => `${formatMinutes(w.startMinute)}–${formatMinutes(w.endMinute)}`)
  return {
    services,
    today: today.length > 0 ? `Hoje ${today.join(' e ')}` : 'Hoje sem atendimento',
    missingHours: false,
  }
}

export type RoomRow = { capacity: string; usage: string }

export function usedByServices(snap: ClinicConfigSnapshot, room: ClinicResource): ClinicService[] {
  return snap.services.filter((s) => {
    if (!s.active) return false
    return s.roomRequirement.mode === 'rooms' && s.roomRequirement.resourceIds.includes(room.id)
  })
}

export function roomRow(snap: ClinicConfigSnapshot, room: ClinicResource): RoomRow {
  const n = room.capacity ?? 1
  const capacity =
    room.kind === 'equipment'
      ? 'Equipamento · 1 cliente por vez'
      : n > 1
        ? `Atende ${n} clientes ao mesmo tempo`
        : '1 cliente por vez'
  const here = usedByServices(snap, room)
  const usage =
    room.kind === 'room' && n > 1
      ? room.attendanceMode === 'uma_para_todas'
        ? 'Uma profissional para todas'
        : 'Cada profissional com a sua cliente'
      : here.length > 0
        ? joinNames(here.map((s) => s.name))
        : ''
  return { capacity, usage }
}

export type ServiceRow = {
  occupies: string
  detail: string
  /** Aviso de exceção; null quando a linha está normal. */
  warning: string | null
}

export function serviceRow(snap: ClinicConfigSnapshot, svc: ClinicService): ServiceRow {
  const activeZones = (svc.zones ?? []).filter((z) => z.active)
  const total = svc.occupiedMinutes || svc.durationMinutes + svc.bufferMinutes
  const kind = variantKindWord(svc.variantKind, svc.variantKindPlural, activeZones.length)
  const occupies =
    activeZones.length > 0
      ? `${activeZones.length} ${kind}`
      : svc.bufferMinutes > 0
        ? `Ocupa ${total} min (${svc.durationMinutes} + ${svc.bufferMinutes} de intervalo)`
        : `Ocupa ${total} min`
  const zonePrices = activeZones.map((z) => z.priceCents)
  const allPriced = activeZones.length > 0 && zonePrices.every((p) => p != null)
  const zonePriceLabel = allPriced
    ? (() => {
        const values = zonePrices.filter((p): p is number => p != null)
        const min = Math.min(...values)
        const max = Math.max(...values)
        return min === max ? formatPriceCents(min) : `${formatPriceCents(min)}–${formatPriceCents(max)}`
      })()
    : null
  const pros = snap.resources.filter(
    (r) => r.kind === 'professional' && r.active && svc.professionalIds.includes(r.id),
  )
  const req = svc.roomRequirement
  const room =
    req.mode === 'rooms'
      ? joinNames(
          req.resourceIds
            .map((id) => snap.resources.find((r) => r.id === id)?.name)
            .filter((name): name is string => Boolean(name))
            .sort((a, b) => a.localeCompare(b, 'pt-BR')),
        ) || null
      : null
  const audienceLabel =
    svc.audiencia === 'feminino'
      ? 'Feminino'
      : svc.audiencia === 'masculino'
        ? 'Masculino'
        : svc.audiencia === 'qualquer'
          ? 'Qualquer'
          : null
  const parts = [
    pros.length > 0 ? joinNames(pros.map((p) => p.name)) : null,
    room,
    audienceLabel,
    zonePriceLabel ?? (svc.priceCents != null ? formatPriceCents(svc.priceCents) : 'Sem preço'),
  ].filter((p): p is string => p !== null)
  return {
    occupies,
    detail: parts.join(' · '),
    warning: pros.length === 0 ? 'Sem profissional' : null,
  }
}

export type PendingCounts = { professionals: number; services: number }

/** Itens ativos com exceção (mesmas regras dos selos das listas); alimenta «1 pendência». */
export function pendingCounts(snap: ClinicConfigSnapshot, now: number): PendingCounts {
  const professionals = snap.resources.filter((r) => {
    if (r.kind !== 'professional' || !r.active) return false
    const row = professionalRow(snap, r, now)
    return row.missingHours
  }).length
  const services = snap.services.filter(
    (s) => s.active && serviceRow(snap, s).warning !== null,
  ).length
  return { professionals, services }
}
