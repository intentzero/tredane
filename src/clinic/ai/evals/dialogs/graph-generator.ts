/**
 * Gerador de diálogos L1 a partir do grafo da clínica (M7 / #418).
 * Percursos: serviço → linha → variantes → (dia, período, hora) ×
 * (livre, ocupado, fechado, Tempo, sinal). O resultado esperado vem de
 * `quoteVisit` e `queryAutomaticAvailability` / `queryAvailability`.
 *
 * Ficheiro separado de `p0-cases.ts` para não conflitar com #416/#417.
 */
import type { Clock } from '../../../../db/clock'
import { createBlockOp } from '../../../config'
import { quoteVisit } from '../../../config/zones'
import { listServices } from '../../../config/services'
import { ensureClinicSettings, setForecastPlace } from '../../../config/settings'
import { queryAvailability } from '../../../scheduling/query'
import { clinicCivilDateFromUtc } from '../../../scheduling/timezone'
import type { ClinicDb } from '../../../store'
import type { ServiceRow, ServiceZoneRow } from '../../../config/types'
import { queryAutomaticAvailability } from '../../../tempo/automatic'
import type { ForecastAdapter } from '../../../tempo/evaluate'
import type { DialogCase } from './runner'

export type GraphOccupancy = 'livre' | 'ocupado' | 'fechado' | 'tempo' | 'sinal'

export type GraphPeriod = 'manha' | 'tarde' | 'noite'

export type GraphPathExpectation = {
  occupancy: GraphOccupancy
  /** Preço da visita no grafo (centavos), se calculável. */
  priceCents: number | null
  /** Duração da visita no grafo. */
  durationMinutes: number
  /** Há slot livre no dia/hora pedidos (antes de preparar ocupado). */
  slotFree: boolean
  /** Dia civil fechado (zero slots no dia). */
  dayClosed: boolean
  /** Serviço exige sinal Pix. */
  requiresSignal: boolean
  /** Serviço tem filtro Tempo activo. */
  hasTempo: boolean
}

export type GraphDialogPath = {
  id: string
  clinicLabel: string
  serviceId: string
  serviceName: string
  variantIds: string[]
  variantNames: string[]
  date: string
  period: GraphPeriod | null
  time: string
  occupancy: GraphOccupancy
  expected: GraphPathExpectation
  /** Caso L1 pronto a correr no harness (quando aplicável). */
  dialog: DialogCase
}

export type EnumerateGraphOptions = {
  clinicLabel: string
  /** Relógio / «agora» da clínica. */
  clock: Clock
  /** Adaptador Tempo (opcional; default = céu limpo). */
  forecast?: ForecastAdapter
  /**
   * Quantos serviços activos no máximo (evita explosão no CI).
   * Default: todos.
   */
  maxServices?: number
  /**
   * Limita combinações de variantes por serviço (1 = só a primeira activa).
   * Default: 1.
   */
  maxVariantCombos?: number
}

function addCivilDays(isoDate: string, days: number): string {
  const parts = isoDate.split('-').map(Number)
  const y = parts[0] ?? 0
  const m = parts[1] ?? 1
  const d = parts[2] ?? 1
  const utc = Date.UTC(y, m - 1, d) + days * 86_400_000
  const dt = new Date(utc)
  const yy = dt.getUTCFullYear()
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(dt.getUTCDate()).padStart(2, '0')
  return `${yy}-${mm}-${dd}`
}

function periodOf(time: string): GraphPeriod {
  const h = Number(time.slice(0, 2))
  if (h < 12) return 'manha'
  if (h < 18) return 'tarde'
  return 'noite'
}

function fmtHm(startsAt: number, timeZone: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })
    .format(new Date(startsAt))
    .replace(/^(\d):/, '0$1:')
}

function weekdayPt(isoDate: string, timeZone: string): string {
  const [y, m, d] = isoDate.split('-').map(Number)
  const utcNoon = Date.UTC(y!, m! - 1, d!, 15, 0, 0)
  const long = new Intl.DateTimeFormat('pt-BR', { timeZone, weekday: 'long' }).format(
    new Date(utcNoon),
  )
  // NLU da matriz usa «sexta», não «sexta-feira».
  return long.replace(/-feira$/i, '')
}

/** «10:00» → «10h»; «15:30» → «15:30». */
function timeForClient(hm: string): string {
  if (hm.endsWith(':00')) return `${Number(hm.slice(0, 2))}h`
  return hm
}

function clientAsk(serviceAsk: string, weekday: string, time: string): string {
  return `Quero ${serviceAsk} ${weekday} às ${timeForClient(time)}`
}

function pickVariantCombo(service: ServiceRow): ServiceZoneRow[] {
  if (!service.variantKind?.trim()) return []
  const active = service.zones.filter((z) => z.active)
  if (active.length === 0) return []
  // Uma variante da linha feminino/ambos, se existir; senão a primeira.
  const prefer =
    active.find((z) => z.audience === 'feminino' || z.audience === 'ambos') ?? active[0]!
  return [prefer]
}

function quoteFor(
  db: ClinicDb,
  tenantId: string,
  service: ServiceRow,
  zones: ServiceZoneRow[],
): { priceCents: number | null; durationMinutes: number } {
  try {
    const q = quoteVisit(
      db,
      tenantId,
      service,
      zones.length > 0 ? zones.map((z) => z.id) : null,
    )
    return { priceCents: q.priceCents, durationMinutes: q.durationMinutes }
  } catch {
    return { priceCents: null, durationMinutes: service.durationMinutes }
  }
}

const ALWAYS_CLEAR_FORECAST: ForecastAdapter = {
  async read() {
    return { ok: true, sky: 'ceu_limpo', celsius: 24 }
  },
}

/**
 * Enumera percursos representativos e monta diálogos L1 com expectativa do grafo.
 */
export async function enumerateGraphDialogPaths(
  db: ClinicDb,
  tenantId: string,
  opts: EnumerateGraphOptions,
): Promise<GraphDialogPath[]> {
  let settings = ensureClinicSettings(db, tenantId, opts.clock)
  // Tempo (DEC-077) exige local de previsão; clínicas de teste sem cidade
  // ficam com auto-disponibilidade vazia. Para o grafo, usa São Paulo.
  if (settings.forecastMode === 'nenhum' || !settings.forecastCity) {
    setForecastPlace(
      db,
      tenantId,
      { mode: 'cidade', city: 'São Paulo' },
      opts.clock,
    )
    settings = ensureClinicSettings(db, tenantId, opts.clock)
  }
  const tz = settings.timezone
  const today = clinicCivilDateFromUtc(tz, opts.clock.nowMs())
  const forecast = opts.forecast ?? ALWAYS_CLEAR_FORECAST
  const maxServices = opts.maxServices ?? Number.POSITIVE_INFINITY
  const maxVariantCombos = opts.maxVariantCombos ?? 1

  const services = listServices(db, tenantId)
    .filter((s) => s.active)
    .slice(0, maxServices)

  const paths: GraphDialogPath[] = []

  for (const service of services) {
    const combos: ServiceZoneRow[][] = []
    if (service.variantKind?.trim()) {
      const one = pickVariantCombo(service)
      if (one.length > 0) combos.push(one)
      if (maxVariantCombos > 1) {
        const active = service.zones.filter((z) => z.active).slice(0, maxVariantCombos)
        for (const z of active) {
          if (!combos.some((c) => c[0]?.id === z.id)) combos.push([z])
        }
      }
    } else {
      combos.push([])
    }
    if (combos.length === 0) continue

    for (const zones of combos) {
      const quote = quoteFor(db, tenantId, service, zones)
      const hasTempo =
        service.tempoCeu !== 'tanto_faz' || service.tempoTemperatura !== 'tanto_faz'

      // Procura o próximo dia aberto com slot (até 14 dias).
      // Com Tempo activo usa a disponibilidade automática (com previsão).
      let openDate: string | null = null
      let openTime = '10:00'
      let openStartsAt = 0
      for (let i = 1; i <= 14; i++) {
        const date = addCivilDays(today, i)
        const query = {
          serviceId: service.id,
          date,
          durationMinutesOverride:
            zones.length > 0 ? quote.durationMinutes : undefined,
        }
        const avail = hasTempo
          ? await queryAutomaticAvailability(
              db,
              tenantId,
              query,
              opts.clock,
              forecast,
            )
          : queryAvailability(db, tenantId, query, opts.clock)
        const future = avail.slots.filter((s) => s.startsAt > opts.clock.nowMs())
        if (future.length > 0) {
          openDate = date
          openStartsAt = future[0]!.startsAt
          openTime = fmtHm(openStartsAt, tz)
          break
        }
      }

      // Dia tipicamente fechado: domingo a partir de hoje.
      let closedDate: string | null = null
      for (let i = 0; i <= 14; i++) {
        const date = addCivilDays(today, i)
        const avail = queryAvailability(db, tenantId, { serviceId: service.id, date }, opts.clock)
        if (avail.slots.length === 0) {
          closedDate = date
          break
        }
      }

      const variantLabel =
        zones.length > 0 ? ` ${zones.map((z) => z.name.toLowerCase()).join(' e ')}` : ''
      const serviceAsk = `${service.name}${variantLabel}`

      const push = (
        occupancy: GraphOccupancy,
        date: string,
        time: string,
        expected: GraphPathExpectation,
        dialog: DialogCase,
      ) => {
        const id = `G-${opts.clinicLabel}-${service.id.slice(0, 8)}-${occupancy}-${date}-${time}`
        paths.push({
          id,
          clinicLabel: opts.clinicLabel,
          serviceId: service.id,
          serviceName: service.name,
          variantIds: zones.map((z) => z.id),
          variantNames: zones.map((z) => z.name),
          date,
          period: periodOf(time),
          time,
          occupancy,
          expected,
          dialog: { ...dialog, id: dialog.id || id },
        })
      }

      if (openDate) {
        const wd = weekdayPt(openDate, tz)
        const ask = clientAsk(serviceAsk, wd, openTime)
        const baseExpect: Omit<GraphPathExpectation, 'occupancy' | 'slotFree' | 'dayClosed'> = {
          priceCents: quote.priceCents,
          durationMinutes: quote.durationMinutes,
          requiresSignal: service.requiresSignal,
          hasTempo,
        }
        const serviceName = service.name
        const durationMinutes = quote.durationMinutes
        const blockStartsAt = openStartsAt

        // livre
        push(
          'livre',
          openDate,
          openTime,
          { ...baseExpect, occupancy: 'livre', slotFree: true, dayClosed: false },
          {
            id: `G-${opts.clinicLabel}-livre-${serviceName}`,
            title: `[grafo] ${serviceName} livre`,
            turnosIdeais: 1,
            turns: [{ role: 'client', text: ask }],
            expect: { proposal: true, noAppointment: true },
          },
        )

        // ocupado — bloqueia o slot no cenário em que o diálogo corre (IDs locais).
        push(
          'ocupado',
          openDate,
          openTime,
          { ...baseExpect, occupancy: 'ocupado', slotFree: false, dayClosed: false },
          {
            id: `G-${opts.clinicLabel}-ocupado-${serviceName}`,
            title: `[grafo] ${serviceName} ocupado`,
            turnosIdeais: 1,
            prepare: (s) => {
              const svc = listServices(s.db, s.tenantId).find((x) => x.name === serviceName)
              if (!svc) return
              const endsAt = blockStartsAt + durationMinutes * 60_000
              for (const resourceId of svc.professionalIds) {
                createBlockOp(
                  s.db,
                  s.caller,
                  {
                    resourceId,
                    startsAt: blockStartsAt,
                    endsAt,
                    reason: 'outro',
                  },
                  s.clock,
                )
              }
            },
            turns: [{ role: 'client', text: ask }],
            expect: { proposal: false, noAppointment: true },
          },
        )

        if (service.requiresSignal) {
          push(
            'sinal',
            openDate,
            openTime,
            {
              ...baseExpect,
              occupancy: 'sinal',
              slotFree: true,
              dayClosed: false,
              requiresSignal: true,
            },
            {
              id: `G-${opts.clinicLabel}-sinal-${serviceName}`,
              title: `[grafo] ${serviceName} com sinal`,
              turnosIdeais: 1,
              turns: [{ role: 'client', text: ask }],
              expect: { proposal: true, noAppointment: true },
            },
          )
        }

        if (hasTempo) {
          push(
            'tempo',
            openDate,
            openTime,
            {
              ...baseExpect,
              occupancy: 'tempo',
              slotFree: true,
              dayClosed: false,
              hasTempo: true,
            },
            {
              id: `G-${opts.clinicLabel}-tempo-${serviceName}`,
              title: `[grafo] ${serviceName} com Tempo`,
              turnosIdeais: 1,
              forecast: ALWAYS_CLEAR_FORECAST,
              prepare: (s) => {
                setForecastPlace(
                  s.db,
                  s.tenantId,
                  { mode: 'cidade', city: 'São Paulo' },
                  s.clock,
                )
              },
              turns: [{ role: 'client', text: ask }],
              // Previsão limpa: o grafo deixa passar → proposta.
              expect: { proposal: true, noAppointment: true },
            },
          )
        }
      }

      if (closedDate) {
        const wd = weekdayPt(closedDate, tz)
        push(
          'fechado',
          closedDate,
          '10:00',
          {
            occupancy: 'fechado',
            priceCents: quote.priceCents,
            durationMinutes: quote.durationMinutes,
            slotFree: false,
            dayClosed: true,
            requiresSignal: service.requiresSignal,
            hasTempo,
          },
          {
            id: `G-${opts.clinicLabel}-fechado-${service.name}`,
            title: `[grafo] ${service.name} dia fechado`,
            turnosIdeais: 1,
            turns: [{ role: 'client', text: clientAsk(serviceAsk, wd, '10:00') }],
            expect: { proposal: false, noAppointment: true },
          },
        )
      }
    }
  }

  return paths
}

/** Só os DialogCase dos percursos (para o harness). */
export function dialogCasesFromPaths(paths: GraphDialogPath[]): DialogCase[] {
  return paths.map((p) => p.dialog)
}
