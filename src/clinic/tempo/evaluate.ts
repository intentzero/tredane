/**
 * Avaliador do bloco Tempo (DEC-077 S4).
 * Lê o serviço e o local já gravados. Não filtra a agenda nem confirma marcação.
 * O resultado não leva corpo do provedor, percentagem nem código cru.
 */
import { ensureClinicSettings, getService } from '../config'
import type { ClinicDb } from '../store'
import type { TempoCeu, TempoTemperatura } from '../config/types'
import type { Clock } from '../../db/clock'
import { NotFoundError } from '../errors'

export const SKY_SYMBOLS = [
  'ceu_limpo',
  'pouco_nublado',
  'parcialmente_nublado',
  'muito_nublado',
  'encoberto',
  'garoa',
  'chuva',
  'trovoada',
  'nevoeiro',
] as const

export type SkySymbol = (typeof SKY_SYMBOLS)[number]

const SOL_SKY = new Set<SkySymbol>(['ceu_limpo', 'pouco_nublado', 'parcialmente_nublado'])
const CHUVA_SKY = new Set<SkySymbol>(['garoa', 'chuva', 'trovoada'])

export type TempoReason = 'ceu' | 'temperatura'

export type TempoVerdict =
  | { outcome: 'serve' }
  | { outcome: 'nao_serve'; reasons: TempoReason[] }
  | { outcome: 'indisponivel' }

export type ForecastPlaceQuery =
  | { mode: 'cidade'; city: string }
  | { mode: 'coordenadas'; latitude: number; longitude: number }

export type ForecastQuery = {
  place: ForecastPlaceQuery
  timezone: string
  startsAt: number
}

export type ForecastRead =
  | { ok: true; sky: SkySymbol; celsius: number }
  | { ok: false }

export type ForecastAdapter = {
  read(query: ForecastQuery): Promise<ForecastRead>
}

function isSky(value: string): value is SkySymbol {
  return (SKY_SYMBOLS as readonly string[]).includes(value)
}

export function judgeTempo(
  rule: { ceu: TempoCeu; temperatura: TempoTemperatura; celsius: number | null },
  reading: { sky: string; celsius: number },
): TempoVerdict {
  if (!isSky(reading.sky) || !Number.isInteger(reading.celsius)) return { outcome: 'indisponivel' }
  const reasons: TempoReason[] = []
  if (rule.ceu === 'sol' && !SOL_SKY.has(reading.sky)) reasons.push('ceu')
  if (rule.ceu === 'chuva' && !CHUVA_SKY.has(reading.sky)) reasons.push('ceu')
  if (rule.temperatura === 'acima') {
    if (rule.celsius === null || reading.celsius <= rule.celsius) reasons.push('temperatura')
  }
  if (rule.temperatura === 'abaixo') {
    if (rule.celsius === null || reading.celsius >= rule.celsius) reasons.push('temperatura')
  }
  if (reasons.length === 0) return { outcome: 'serve' }
  return { outcome: 'nao_serve', reasons }
}

export async function evaluateServiceTempo(
  db: ClinicDb,
  tenantId: string,
  input: { serviceId: string; startsAt: number },
  adapter: ForecastAdapter,
  clock: Clock,
): Promise<TempoVerdict> {
  const service = getService(db, tenantId, input.serviceId)
  if (!service) throw new NotFoundError('service_not_found', 'Serviço não encontrado')
  if (service.tempoCeu === 'tanto_faz' && service.tempoTemperatura === 'tanto_faz') {
    return { outcome: 'serve' }
  }
  const settings = ensureClinicSettings(db, tenantId, clock)
  let place: ForecastPlaceQuery | null = null
  if (settings.forecastMode === 'cidade' && settings.forecastCity) {
    place = { mode: 'cidade', city: settings.forecastCity }
  } else if (
    settings.forecastMode === 'coordenadas'
    && settings.forecastLatitude !== null
    && settings.forecastLongitude !== null
  ) {
    place = {
      mode: 'coordenadas',
      latitude: settings.forecastLatitude,
      longitude: settings.forecastLongitude,
    }
  }
  if (!place) return { outcome: 'indisponivel' }
  let reading: ForecastRead
  try {
    reading = await adapter.read({
      place,
      timezone: settings.timezone,
      startsAt: input.startsAt,
    })
  } catch {
    reading = { ok: false }
  }
  if (!reading.ok) return { outcome: 'indisponivel' }
  return judgeTempo(
    {
      ceu: service.tempoCeu,
      temperatura: service.tempoTemperatura,
      celsius: service.tempoCelsius,
    },
    reading,
  )
}
