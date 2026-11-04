/**
 * Horas livres para o ecrã HORARIO (ADR-0016 §3).
 * Horizonte: 7 dias civis da clínica; grade 15 min; teto 200 (Dropdown).
 * Usa o mesmo filtro automático do chat (DEC-077).
 */
import type { Clock } from '../../db/clock'
import type { ServiceRow } from '../../clinic/config/types'
import { clinicCivilDateFromUtc } from '../../clinic/scheduling/timezone'
import { ensureClinicSettings } from '../../clinic/config/settings'
import { queryAutomaticAvailability } from '../../clinic/tempo/automatic'
import { readOpenMeteo } from '../../clinic/tempo/open-meteo'
import type { ForecastAdapter } from '../../clinic/tempo/evaluate'
import { quoteVisit } from '../../clinic/config/zones'
import type { ClinicDb } from '../../clinic/store'
import { addCivilDays, localHHMM } from '../../clinic/ai/slot-offer'
import { AI_FREE_SLOT_DAYS } from '../../clinic/ai/schedule-context'
import { FLOW_MAX_SLOTS, type FlowSlotOption } from './screens'

function visitDuration(
  db: ClinicDb,
  tenantId: string,
  service: ServiceRow,
  zoneIds: string[],
): number {
  if (zoneIds.length === 0) return service.durationMinutes
  try {
    return quoteVisit(db, tenantId, service, zoneIds).durationMinutes
  } catch {
    return service.durationMinutes
  }
}

export async function listFlowFreeSlots(input: {
  db: ClinicDb
  tenantId: string
  service: ServiceRow
  variantIds: string[] | null
  clock: Clock
  forecast?: ForecastAdapter
}): Promise<FlowSlotOption[]> {
  const settings = ensureClinicSettings(input.db, input.tenantId, input.clock)
  const tz = settings.timezone || 'America/Sao_Paulo'
  const today = clinicCivilDateFromUtc(tz, input.clock.nowMs())
  const zones =
    input.variantIds && input.variantIds.length > 0
      ? input.service.zones.filter((z) => z.active && input.variantIds!.includes(z.id))
      : []
  const duration = visitDuration(
    input.db,
    input.tenantId,
    input.service,
    zones.map((z) => z.id),
  )
  const forecast = input.forecast ?? { read: readOpenMeteo }
  const out: FlowSlotOption[] = []

  for (let i = 0; i < AI_FREE_SLOT_DAYS; i++) {
    if (out.length >= FLOW_MAX_SLOTS) break
    const date = addCivilDays(today, i)
    let avail: { schedulingAllowed: boolean; slots: Array<{ startsAt: number }> }
    try {
      avail = await queryAutomaticAvailability(
        input.db,
        input.tenantId,
        {
          serviceId: input.service.id,
          date,
          durationMinutesOverride: duration,
        },
        input.clock,
        forecast,
      )
    } catch {
      // Sem previsão a tempo: não listar «às escuras» (ADR-0016 §3 Tempo).
      return out
    }
    if (!avail.schedulingAllowed && avail.slots.length === 0) continue
    for (const slot of avail.slots) {
      if (out.length >= FLOW_MAX_SLOTS) break
      if (slot.startsAt <= input.clock.nowMs()) continue
      const time = localHHMM(tz, slot.startsAt)
      out.push({ id: `${date}T${time}`, date, time })
    }
  }
  return out
}
