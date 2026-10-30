/**
 * DEC-077 / S4 — avaliador. A grade ainda não filtra. Sem rede.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { createControllableClock } from '../../db/clock'
import { workerCaller } from '../index'
import { bootClinicDb } from '../test-db'
import { setForecastPlaceOp, upsertResourceOp, upsertServiceOp } from '../config'
import type { ClinicDb } from '../store'
import type { Clock } from '../../db/clock'
import { evaluateServiceTempo, judgeTempo, type ForecastAdapter, type ForecastRead, type SkySymbol } from './evaluate'
import {
  integerCelsius,
  localHourStart,
  mapOpenMeteoHour,
  PRECIP_CHUVA_MIN,
  readOpenMeteo,
} from './open-meteo'
import { zonedCivilToUtc } from '../scheduling/timezone'

const START = zonedCivilToUtc('America/Sao_Paulo', 2026, 10, 30, 15, 20)

function scripted(reading: ForecastRead): ForecastAdapter & { calls: number } {
  const adapter = {
    calls: 0,
    async read() {
      adapter.calls += 1
      return reading
    },
  }
  return adapter
}

function reading(sky: SkySymbol, celsius: number): ForecastRead {
  return { ok: true, sky, celsius }
}

function seed(
  db: ClinicDb,
  clock: Clock,
  tempo: { tempoCeu?: 'tanto_faz' | 'sol' | 'chuva'; tempoTemperatura?: 'tanto_faz' | 'acima' | 'abaixo'; tempoCelsius?: number | null },
) {
  const caller = workerCaller('clinic-demo-a', 'user_synth_owner_a')
  const pro = upsertResourceOp(db, caller, { kind: 'professional', name: 'Gi' }, clock)
  const service = upsertServiceOp(
    db,
    caller,
    {
      name: 'Bronzeamento',
      durationMinutes: 60,
      bufferMinutes: 0,
      professionalIds: [pro.id],
      roomRequirement: { mode: 'none' },
      ...tempo,
    },
    clock,
  )
  return { caller, service }
}

describe('avaliador do bloco Tempo (S4)', () => {
  it('céu limpo a 25 °C serve Sol e Acima de 24; 24 °C não serve', async () => {
    const clock = createControllableClock(Date.UTC(2026, 9, 30))
    const { db, close } = bootClinicDb({ clock })
    try {
      const { caller, service } = seed(db, clock, {
        tempoCeu: 'sol',
        tempoTemperatura: 'acima',
        tempoCelsius: 24,
      })
      setForecastPlaceOp(db, caller, { mode: 'cidade', city: 'Campinas' }, clock)
      const hot = scripted(reading('ceu_limpo', 25))
      await expect(evaluateServiceTempo(db, caller.tenantId, { serviceId: service.id, startsAt: START }, hot, clock))
        .resolves.toEqual({ outcome: 'serve' })
      const edge = scripted(reading('ceu_limpo', 24))
      await expect(evaluateServiceTempo(db, caller.tenantId, { serviceId: service.id, startsAt: START }, edge, clock))
        .resolves.toEqual({ outcome: 'nao_serve', reasons: ['temperatura'] })
    } finally {
      close()
    }
  })

  it('encoberto, muito nublado e nevoeiro não servem Sol; garoa e trovoada servem Chuva e não Sol', () => {
    const sol = { ceu: 'sol' as const, temperatura: 'tanto_faz' as const, celsius: null }
    const chuva = { ceu: 'chuva' as const, temperatura: 'tanto_faz' as const, celsius: null }
    expect(judgeTempo(sol, { sky: 'encoberto', celsius: 25 })).toEqual({ outcome: 'nao_serve', reasons: ['ceu'] })
    expect(judgeTempo(sol, { sky: 'muito_nublado', celsius: 25 })).toEqual({ outcome: 'nao_serve', reasons: ['ceu'] })
    expect(judgeTempo(sol, { sky: 'nevoeiro', celsius: 25 })).toEqual({ outcome: 'nao_serve', reasons: ['ceu'] })
    expect(judgeTempo(chuva, { sky: 'nevoeiro', celsius: 25 })).toEqual({ outcome: 'nao_serve', reasons: ['ceu'] })
    expect(judgeTempo(chuva, { sky: 'garoa', celsius: 18 })).toEqual({ outcome: 'serve' })
    expect(judgeTempo(sol, { sky: 'garoa', celsius: 18 })).toEqual({ outcome: 'nao_serve', reasons: ['ceu'] })
    expect(judgeTempo(chuva, { sky: 'trovoada', celsius: 22 })).toEqual({ outcome: 'serve' })
    expect(judgeTempo(sol, { sky: 'pouco_nublado', celsius: 22 })).toEqual({ outcome: 'serve' })
    expect(judgeTempo(sol, { sky: 'parcialmente_nublado', celsius: 22 })).toEqual({ outcome: 'serve' })
    expect(judgeTempo(
      { ceu: 'tanto_faz', temperatura: 'abaixo', celsius: 18 },
      { sky: 'encoberto', celsius: 18 },
    )).toEqual({ outcome: 'nao_serve', reasons: ['temperatura'] })
  })

  it('os dois a falhar devolvem céu e temperatura, sem corpo do provedor', () => {
    const verdict = judgeTempo(
      { ceu: 'sol', temperatura: 'acima', celsius: 24 },
      { sky: 'encoberto', celsius: 20 },
    )
    expect(verdict).toEqual({ outcome: 'nao_serve', reasons: ['ceu', 'temperatura'] })
    expect(JSON.stringify(verdict)).not.toMatch(/percentagem|weather_code|precipitation|open-meteo/i)
  })

  it('Tanto faz nos dois serve e não chama o adaptador', async () => {
    const clock = createControllableClock(Date.UTC(2026, 9, 30))
    const { db, close } = bootClinicDb({ clock })
    try {
      const { caller, service } = seed(db, clock, {})
      const adapter = scripted(reading('chuva', 10))
      await expect(evaluateServiceTempo(db, caller.tenantId, { serviceId: service.id, startsAt: START }, adapter, clock))
        .resolves.toEqual({ outcome: 'serve' })
      expect(adapter.calls).toBe(0)
    } finally {
      close()
    }
  })

  it('sem local, erro do adaptador ou leitura ilegível fica indisponível', async () => {
    const clock = createControllableClock(Date.UTC(2026, 9, 30))
    const { db, close } = bootClinicDb({ clock })
    try {
      const { caller, service } = seed(db, clock, { tempoCeu: 'sol' })
      const idle = scripted(reading('ceu_limpo', 30))
      await expect(evaluateServiceTempo(db, caller.tenantId, { serviceId: service.id, startsAt: START }, idle, clock))
        .resolves.toEqual({ outcome: 'indisponivel' })
      expect(idle.calls).toBe(0)
      setForecastPlaceOp(db, caller, { mode: 'coordenadas', latitude: -22.9, longitude: -47.06 }, clock)
      const boom: ForecastAdapter = { async read() { throw new Error('timeout') } }
      await expect(evaluateServiceTempo(db, caller.tenantId, { serviceId: service.id, startsAt: START }, boom, clock))
        .resolves.toEqual({ outcome: 'indisponivel' })
      const blank = scripted({ ok: false })
      await expect(evaluateServiceTempo(db, caller.tenantId, { serviceId: service.id, startsAt: START }, blank, clock))
        .resolves.toEqual({ outcome: 'indisponivel' })
      expect(judgeTempo({ ceu: 'sol', temperatura: 'tanto_faz', celsius: null }, { sky: 'granizo', celsius: 10 }))
        .toEqual({ outcome: 'indisponivel' })
    } finally {
      close()
    }
  })

  it('a clínica B não usa o local da clínica A', async () => {
    const clock = createControllableClock(Date.UTC(2026, 9, 30))
    const a = bootClinicDb({ clock })
    const b = bootClinicDb({ clock })
    try {
      const ownerA = workerCaller('clinic-demo-a', 'user_synth_owner_a')
      const ownerB = workerCaller('clinic-demo-b', 'user_synth_owner_b')
      const { service: bronzeA } = seed(a.db, clock, { tempoCeu: 'sol' })
      setForecastPlaceOp(a.db, ownerA, { mode: 'cidade', city: 'Campinas' }, clock)
      const proB = upsertResourceOp(b.db, ownerB, { kind: 'professional', name: 'Lia' }, clock)
      const bronzeB = upsertServiceOp(
        b.db,
        ownerB,
        {
          name: 'Bronzeamento',
          durationMinutes: 60,
          bufferMinutes: 0,
          professionalIds: [proB.id],
          roomRequirement: { mode: 'none' },
          tempoCeu: 'sol',
        },
        clock,
      )
      const seen: string[] = []
      const adapter: ForecastAdapter = {
        async read(query) {
          seen.push(query.place.mode === 'cidade' ? query.place.city : 'coords')
          return reading('ceu_limpo', 28)
        },
      }
      await expect(evaluateServiceTempo(b.db, ownerB.tenantId, { serviceId: bronzeB.id, startsAt: START }, adapter, clock))
        .resolves.toEqual({ outcome: 'indisponivel' })
      await expect(evaluateServiceTempo(a.db, ownerA.tenantId, { serviceId: bronzeA.id, startsAt: START }, adapter, clock))
        .resolves.toEqual({ outcome: 'serve' })
      expect(seen).toEqual(['Campinas'])
    } finally {
      a.close()
      b.close()
    }
  })

  it('traduz o código WMO, o corte de percentagem e a hora que contém o início', () => {
    expect(PRECIP_CHUVA_MIN).toBe(60)
    expect(integerCelsius(24.5)).toBe(25)
    expect(integerCelsius(-1.5)).toBe(-2)
    expect(localHourStart('America/Sao_Paulo', START)).toBe('2026-10-30T15:00')
    expect(localHourStart('America/Sao_Paulo', zonedCivilToUtc('America/Sao_Paulo', 2026, 10, 30, 15, 0))).toBe('2026-10-30T15:00')

    const hour = '2026-10-30T15:00'
    const mapped = (code: number | null, precip: number | null, temp = 24.4) => mapOpenMeteoHour({
      time: [hour],
      temperature_2m: [temp],
      weather_code: [code],
      precipitation_probability: [precip],
    }, hour)

    expect(mapped(0, 90)).toEqual({ ok: true, sky: 'ceu_limpo', celsius: 24 })
    expect(mapped(2, 0)).toMatchObject({ ok: true, sky: 'parcialmente_nublado' })
    expect(mapped(3, 0)).toMatchObject({ ok: true, sky: 'encoberto' })
    expect(mapped(45, 0)).toMatchObject({ ok: true, sky: 'nevoeiro' })
    expect(mapped(51, 10)).toMatchObject({ ok: true, sky: 'garoa' })
    expect(mapped(61, 10)).toMatchObject({ ok: true, sky: 'chuva' })
    expect(mapped(95, 10)).toMatchObject({ ok: true, sky: 'trovoada' })
    expect(mapped(71, 0).ok).toBe(false)
    expect(mapped(null, 59).ok).toBe(false)
    expect(mapped(null, 60)).toMatchObject({ ok: true, sky: 'chuva' })
    expect(mapOpenMeteoHour({
      time: ['2026-10-30T14:00'],
      temperature_2m: [30],
      weather_code: [0],
      precipitation_probability: [0],
    }, hour).ok).toBe(false)

    const spec = readFileSync(new URL('./open-meteo.ts', import.meta.url), 'utf8')
    expect(spec).toMatch(/Open-Meteo/)
    expect(spec).toMatch(/>= 60/)
    expect(spec).toMatch(/24\.5 → 25/)
    expect(spec).toMatch(/15:20/)
    const ux = readFileSync(new URL('../../../docs/product/ux-ui.md', import.meta.url), 'utf8')
    expect(ux).not.toMatch(/precipitation_probability|PRECIP_CHUVA/)
  })

  it('o adaptador devolve só o símbolo e o inteiro, mesmo com corpo extra', async () => {
    const hour = '2026-10-30T15:00'
    const body = {
      hourly: {
        time: [hour],
        temperature_2m: [25.6],
        weather_code: [0],
        precipitation_probability: [80],
        raw: 'não sai',
      },
      generationtime_ms: 1.2,
    }
    const fetchImpl = (async (url: string) => ({
      ok: true,
      json: async () => url.includes('geocoding')
        ? { results: [{ latitude: -22.9, longitude: -47.06, name: 'Campinas', country: 'BR' }] }
        : body,
    })) as unknown as typeof fetch
    const read = await readOpenMeteo(
      { place: { mode: 'cidade', city: 'Campinas' }, timezone: 'America/Sao_Paulo', startsAt: START },
      fetchImpl,
    )
    expect(read).toEqual({ ok: true, sky: 'ceu_limpo', celsius: 26 })
    expect(Object.keys(read).sort()).toEqual(['celsius', 'ok', 'sky'])
  })
})
