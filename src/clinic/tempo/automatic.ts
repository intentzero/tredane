/**
 * Modo automático do bloco Tempo (DEC-077 S5).
 * A grade da equipe não passa por aqui.
 */
import type { Clock } from '../../db/clock'
import { getService } from '../config/services'
import type { ClinicDb } from '../store'
import { queryAvailability } from '../scheduling/query'
import type { AvailabilityQueryInput, AvailabilityQueryResult } from '../scheduling/types'
import { evaluateServiceTempo, type ForecastAdapter, type ForecastRead } from './evaluate'
import { localHourStart } from './open-meteo'

function memoAdapter(inner: ForecastAdapter): ForecastAdapter {
  const cache = new Map<string, Promise<ForecastRead>>()
  return {
    read(query) {
      const key = `${localHourStart(query.timezone, query.startsAt)}|${JSON.stringify(query.place)}`
      let hit = cache.get(key)
      if (!hit) {
        hit = inner.read(query)
        cache.set(key, hit)
      }
      return hit
    },
  }
}

/** Lista da IA e da proposta: omite a hora que não serve ou que não se confirmou. */
export async function queryAutomaticAvailability(
  db: ClinicDb,
  tenantId: string,
  input: AvailabilityQueryInput,
  clock: Clock,
  adapter: ForecastAdapter,
): Promise<AvailabilityQueryResult> {
  const preview = queryAvailability(db, tenantId, input, clock)
  const service = getService(db, tenantId, input.serviceId)
  if (
    !service
    || (service.tempoCeu === 'tanto_faz' && service.tempoTemperatura === 'tanto_faz')
  ) {
    return queryAvailability(db, tenantId, { ...input, tempoMode: 'automatico' }, clock)
  }
  const memo = memoAdapter(adapter)
  const yes = new Set<number>()
  for (const startsAt of new Set(preview.slots.map((slot) => slot.startsAt))) {
    const verdict = await evaluateServiceTempo(
      db,
      tenantId,
      { serviceId: service.id, startsAt },
      memo,
      clock,
    )
    if (verdict.outcome === 'serve') yes.add(startsAt)
  }
  return queryAvailability(
    db,
    tenantId,
    {
      ...input,
      tempoMode: 'automatico',
      tempoKeeps: (startsAt) => yes.has(startsAt),
    },
    clock,
  )
}
