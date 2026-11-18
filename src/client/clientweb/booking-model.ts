/**
 * Regras puras do fluxo de agendar da página da cliente (sem React).
 * A fonte de verdade é o servidor; isto só decide o que mostrar e soma o total.
 */
import type { Catalog, CatalogService, CatalogZone, Line } from './api'

/** A página pergunta «Para quem é?» só quando o catálogo depende de género (DEC-200). */
export function catalogNeedsLine(catalog: Catalog): boolean {
  return catalog.services.some(
    (s) => s.audience !== 'qualquer' || s.zones.some((z) => z.audience !== 'ambos'),
  )
}

/** Serviços visíveis para a linha escolhida; sem linha, só os que não dependem de género. */
export function servicesForLine(catalog: Catalog, line: Line | null): CatalogService[] {
  return catalog.services.filter((s) => {
    if (line) {
      if (s.audience !== 'qualquer' && s.audience !== line) return false
      // Serviço só com zonas do outro género não serve a esta linha.
      if (s.zones.length > 0 && !s.zones.some((z) => z.audience === 'ambos' || z.audience === line)) return false
      return true
    }
    return s.audience === 'qualquer' && s.zones.every((z) => z.audience === 'ambos')
  })
}

export function zonesForLine(service: CatalogService, line: Line | null): CatalogZone[] {
  return service.zones.filter((z) => !line || z.audience === 'ambos' || z.audience === line)
}

/** Serviço com variantes femininas e masculinas ao mesmo tempo, ou audiência fixa. */
export function serviceNeedsLine(service: CatalogService): boolean {
  return service.audience !== 'qualquer' || service.zones.some((z) => z.audience !== 'ambos')
}

/** Cruza o preset do link com o catálogo servido; ignora o que não casa. */
export function resolveBookingPreset(
  catalog: Catalog,
  raw: { serviceId: string | null; audienceLine: Line | null; variantIds: string[] },
): { service: CatalogService | null; line: Line | null; variantIds: string[] } {
  const service = raw.serviceId ? catalog.services.find((s) => s.id === raw.serviceId) : undefined
  if (!service) return { service: null, line: null, variantIds: [] }
  const needsLine = serviceNeedsLine(service)
  let line = raw.audienceLine
  if (line && !needsLine) line = null
  if (line && service.audience !== 'qualquer' && service.audience !== line) line = null
  const allowed = new Set(zonesForLine(service, line).map((z) => z.id))
  const variantIds = raw.variantIds.filter((id) => allowed.has(id))
  return { service, line, variantIds }
}

/** Soma duração e preço das zonas escolhidas (sem zonas, o do serviço). */
export function visitTotals(service: CatalogService, zoneIds: string[]): { minutes: number; priceCents: number | null } {
  if (service.zones.length === 0) return { minutes: service.durationMinutes, priceCents: service.priceCents }
  const chosen = service.zones.filter((z) => zoneIds.includes(z.id))
  const minutes = chosen.reduce((n, z) => n + z.durationMinutes, 0)
  const prices = chosen.map((z) => z.priceCents)
  return { minutes, priceCents: prices.every((p) => p != null) ? prices.reduce<number>((n, p) => n + (p ?? 0), 0) : null }
}

export function formatPrice(cents: number | null): string {
  if (cents == null) return 'Sob consulta'
  const whole = cents % 100 === 0
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: whole ? 0 : 2,
  }).format(cents / 100)
}

export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number]
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10)
}

/** Semana de 7 dias a partir de `start`, cortada ao último dia marcável. */
export function weekDays(start: string, today: string, horizonDays: number): string[] {
  const last = addDays(today, horizonDays - 1)
  const out: string[] = []
  for (let i = 0; i < 7; i++) {
    const d = addDays(start, i)
    if (d <= last) out.push(d)
  }
  return out
}

export function canGoPrevWeek(start: string, today: string): boolean {
  return addDays(start, -7) >= today || start > today
}

export function canGoNextWeek(start: string, today: string, horizonDays: number): boolean {
  return addDays(start, 7) <= addDays(today, horizonDays - 1)
}

export function prevWeekStart(start: string, today: string): string {
  const prev = addDays(start, -7)
  return prev < today ? today : prev
}

export type DayPart = 'Manhã' | 'Tarde' | 'Noite'

export function dayPart(time: string): DayPart {
  const h = Number(time.slice(0, 2))
  return h < 12 ? 'Manhã' : h < 18 ? 'Tarde' : 'Noite'
}

/** Rótulo civil «qua 25/11» (o dia civil não tem fuso). */
export function civilDayLabel(date: string): { weekday: string; short: string; dayMonth: string } {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number]
  const weekday = new Intl.DateTimeFormat('pt-BR', { weekday: 'short', timeZone: 'UTC' })
    .format(new Date(Date.UTC(y, m - 1, d)))
    .replace('.', '')
  const dd = String(d).padStart(2, '0')
  const mm = String(m).padStart(2, '0')
  return { weekday, short: dd, dayMonth: `${dd}/${mm}` }
}
