/**
 * Adaptador Open-Meteo do bloco Tempo (DEC-077 S4).
 *
 * Provedor: Open-Meteo, sem chave.
 * - Cidade: https://geocoding-api.open-meteo.com/v1/search (primeiro resultado; sem resultado = indisponível).
 * - Coordenadas: usadas direto, sem geocoding.
 * - Previsão: https://api.open-meteo.com/v1/forecast
 *   hourly=temperature_2m,weather_code,precipitation_probability
 *   timezone = fuso da clínica. A resposta não é gravada.
 *
 * Hora: a amostra é o balde horário que contém o início no fuso da clínica.
 * 15:20 usa `YYYY-MM-DDTHH:00` das 15:00. Hora ausente na série = indisponível.
 *
 * Céu (weather_code WMO). O código ganha da percentagem quando os dois vêm.
 * - 0 céu limpo; 1 pouco nublado; 2 parcialmente nublado → servem Sol.
 * - 3 encoberto → não serve Sol nem Chuva.
 * - 45 e 48 nevoeiro → não servem Sol nem Chuva.
 * - 51, 53, 55, 56, 57 garoa; 61, 63, 65, 66, 67 chuva; 80, 81, 82 pancadas → Chuva.
 * - 95, 96, 99 trovoada → Chuva.
 * - Neve (71–77, 85, 86) e qualquer outro código: não se escolhe o símbolo mais próximo → indisponível.
 * «Muito nublado» não tem código WMO próprio; o avaliador aceita o símbolo se um teste ou outro adaptador o entregar.
 *
 * Só percentagem, sem weather_code: corte técnico deste adaptador, não decisão de produto.
 * precipitation_probability >= 60 → símbolo chuva.
 * Abaixo de 60, ausente ou não numérica → não prova céu limpo → indisponível.
 * O número não sai deste ficheiro.
 *
 * Temperatura: inteiro com empate .5 a afastar-se de zero (24.5 → 25, −1.5 → −2).
 * Pedido com timeout de 4s. HTTP não-2xx, corpo ilegível ou timeout → indisponível.
 */
import { getTimeZoneOffsetMs } from '../scheduling/timezone'
import type { ForecastQuery, ForecastRead, SkySymbol } from './evaluate'

const GEOCODE_URL = 'https://geocoding-api.open-meteo.com/v1/search'
const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast'
const TIMEOUT_MS = 4_000

/** Corte só deste adaptador. Abaixo disto uma percentagem sem código não vira céu. */
export const PRECIP_CHUVA_MIN = 60

const WMO_SKY: Record<number, SkySymbol> = {
  0: 'ceu_limpo',
  1: 'pouco_nublado',
  2: 'parcialmente_nublado',
  3: 'encoberto',
  45: 'nevoeiro',
  48: 'nevoeiro',
  51: 'garoa',
  53: 'garoa',
  55: 'garoa',
  56: 'garoa',
  57: 'garoa',
  61: 'chuva',
  63: 'chuva',
  65: 'chuva',
  66: 'chuva',
  67: 'chuva',
  80: 'chuva',
  81: 'chuva',
  82: 'chuva',
  95: 'trovoada',
  96: 'trovoada',
  99: 'trovoada',
}

/** Empate .5 afasta-se de zero. */
export function integerCelsius(value: number): number | null {
  if (!Number.isFinite(value)) return null
  const sign = value < 0 ? -1 : 1
  return sign * Math.round(Math.abs(value))
}

/** `YYYY-MM-DDTHH:00` da hora local que contém o instante. */
export function localHourStart(timeZone: string, startsAt: number): string {
  const local = new Date(startsAt + getTimeZoneOffsetMs(timeZone, startsAt))
  const y = local.getUTCFullYear()
  const m = String(local.getUTCMonth() + 1).padStart(2, '0')
  const d = String(local.getUTCDate()).padStart(2, '0')
  const h = String(local.getUTCHours()).padStart(2, '0')
  return `${y}-${m}-${d}T${h}:00`
}

type Hourly = {
  time: string[]
  temperature_2m: Array<number | null>
  weather_code: Array<number | null>
  precipitation_probability: Array<number | null>
}

function skyFromCodeOrPrecip(
  code: number | null | undefined,
  precip: number | null | undefined,
): SkySymbol | null {
  if (typeof code === 'number' && Number.isInteger(code)) {
    return WMO_SKY[code] ?? null
  }
  if (typeof precip === 'number' && Number.isFinite(precip) && precip >= PRECIP_CHUVA_MIN) {
    return 'chuva'
  }
  return null
}

/** Traduz um corpo já lido. Não devolve o corpo. */
export function mapOpenMeteoHour(hourly: Hourly, hourKey: string): ForecastRead {
  const index = hourly.time.indexOf(hourKey)
  if (index < 0) return { ok: false }
  const sky = skyFromCodeOrPrecip(
    hourly.weather_code[index],
    hourly.precipitation_probability[index],
  )
  const celsius = integerCelsius(hourly.temperature_2m[index] ?? Number.NaN)
  if (!sky || celsius === null) return { ok: false }
  return { ok: true, sky, celsius }
}

function hourlyFromUnknown(body: unknown): Hourly | null {
  if (!body || typeof body !== 'object') return null
  const hourly = (body as { hourly?: unknown }).hourly
  if (!hourly || typeof hourly !== 'object') return null
  const row = hourly as Record<string, unknown>
  if (!Array.isArray(row.time) || !Array.isArray(row.temperature_2m)) return null
  return {
    time: row.time.filter((t): t is string => typeof t === 'string'),
    temperature_2m: Array.isArray(row.temperature_2m) ? (row.temperature_2m as Array<number | null>) : [],
    weather_code: Array.isArray(row.weather_code) ? (row.weather_code as Array<number | null>) : [],
    precipitation_probability: Array.isArray(row.precipitation_probability)
      ? (row.precipitation_probability as Array<number | null>)
      : [],
  }
}

async function fetchJson(fetchImpl: typeof fetch, url: string): Promise<unknown> {
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(TIMEOUT_MS) })
  if (!res.ok) return null
  return res.json()
}

async function resolvePoint(
  query: ForecastQuery,
  fetchImpl: typeof fetch,
): Promise<{ latitude: number; longitude: number } | null> {
  if (query.place.mode === 'coordenadas') {
    return { latitude: query.place.latitude, longitude: query.place.longitude }
  }
  const url = `${GEOCODE_URL}?${new URLSearchParams({
    name: query.place.city,
    count: '1',
    language: 'pt',
    format: 'json',
  })}`
  const body = await fetchJson(fetchImpl, url)
  const results = body && typeof body === 'object' ? (body as { results?: unknown }).results : null
  const first = Array.isArray(results) ? results[0] : null
  if (!first || typeof first !== 'object') return null
  const latitude = (first as { latitude?: unknown }).latitude
  const longitude = (first as { longitude?: unknown }).longitude
  if (typeof latitude !== 'number' || typeof longitude !== 'number') return null
  return { latitude, longitude }
}

export async function readOpenMeteo(
  query: ForecastQuery,
  fetchImpl: typeof fetch = fetch,
): Promise<ForecastRead> {
  try {
    const point = await resolvePoint(query, fetchImpl)
    if (!point) return { ok: false }
    const url = `${FORECAST_URL}?${new URLSearchParams({
      latitude: String(point.latitude),
      longitude: String(point.longitude),
      hourly: 'temperature_2m,weather_code,precipitation_probability',
      timezone: query.timezone,
      forecast_days: '16',
    })}`
    const body = await fetchJson(fetchImpl, url)
    const hourly = hourlyFromUnknown(body)
    if (!hourly) return { ok: false }
    return mapOpenMeteoHour(hourly, localHourStart(query.timezone, query.startsAt))
  } catch {
    return { ok: false }
  }
}
