/**
 * #511 / CF-33 — horários livres do mesmo pedido após Confirmar expirado ou vaga perdida.
 * DEC-061: não marca; só explica e oferece alternativas. Relógio da clínica; sem IANA na copy.
 */
import type { Clock } from '../../db/clock'
import { getService } from '../config/services'
import { readZoneSnapshots } from '../config/zones'
import type { ClinicDb } from '../store'
import {
  dayTextPt,
  offerNearestSlots,
  type OfferedSlot,
} from '../ai/slot-offer'
import type { ForecastAdapter } from '../tempo/evaluate'
import type { AppointmentProposalRow } from './types'

/** Junta slots no formato da oferta («sexta 06/11 às 14:00, 16:00»). */
export function formatOfferedSlotsListing(slots: OfferedSlot[]): string {
  if (slots.length === 0) return ''
  const byDay = new Map<string, string[]>()
  for (const slot of slots) {
    const list = byDay.get(slot.date) ?? []
    list.push(slot.time)
    byDay.set(slot.date, list)
  }
  const bits = [...byDay.entries()].map(
    ([day, times]) => `${dayTextPt(day)} às ${times.join(', ')}`,
  )
  return bits.length === 1
    ? bits[0]!
    : `${bits.slice(0, -1).join(', ')} e ${bits[bits.length - 1]}`
}

/**
 * Próximos horários livres para o serviço e zonas da proposta (mesmo pedido).
 * Exclui o início da proposta; devolve pelo menos o que a agenda tiver (ideal ≥2).
 */
export async function offerAlternativesForProposal(input: {
  db: ClinicDb
  tenantId: string
  proposal: AppointmentProposalRow
  clock: Clock
  forecast?: ForecastAdapter
  limit?: number
}): Promise<{ slots: OfferedSlot[]; listing: string }> {
  const service = getService(input.db, input.tenantId, input.proposal.serviceId)
  if (!service || !service.active) return { slots: [], listing: '' }

  const snaps = readZoneSnapshots(
    input.db,
    input.tenantId,
    'proposal',
    input.proposal.id,
  )
  const zones =
    snaps.length > 0
      ? service.zones.filter((z) => snaps.some((s) => s.zoneId === z.id))
      : []

  const limit = input.limit ?? 3
  // Pedir um a mais para poder excluir o horário da proposta expirada/recusada.
  const offered = await offerNearestSlots({
    db: input.db,
    tenantId: input.tenantId,
    service,
    zones,
    tz: input.proposal.timezone,
    clock: input.clock,
    forecast: input.forecast,
    professionalId: input.proposal.professionalId ?? undefined,
    limit: limit + 1,
    conversationId: input.proposal.conversationId ?? '',
  })

  const slots = offered.slots
    .filter((s) => s.startsAt !== input.proposal.startsAt)
    .slice(0, limit)
  return { slots, listing: formatOfferedSlotsListing(slots) }
}
