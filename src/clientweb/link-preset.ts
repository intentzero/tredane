/**
 * Validação do preset do link contra o catálogo (DEC-202). Valores inválidos são ignorados, sem erro.
 */
import { serviceMatchesAudience } from '../clinic/catalog/audience'
import { needsAudienceLine, zonesForAudienceLine, type AudienceLine } from '../clinic/ai/variant-line'
import type { ServiceRow, ServiceZoneRow } from '../clinic/config/types'
import type { ClientWebDayPart } from './route-context'

export type ClientWebLinkPreset = {
  serviceId: string | null
  audienceLine: AudienceLine | null
  variantIds: string[]
  preferredDate: string | null
  dayPart: ClientWebDayPart | null
}

const CIVIL = /^\d{4}-\d{2}-\d{2}$/

function asDayPart(raw: string | null | undefined): ClientWebDayPart | null {
  return raw === 'manha' || raw === 'tarde' || raw === 'noite' ? raw : null
}

function parseVariantIdsJson(raw: string | null | undefined): string[] {
  if (!raw?.trim()) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter((x): x is string => typeof x === 'string' && x.length > 0 && x.length <= 120)
  } catch {
    return []
  }
}

function asAudienceLine(raw: string | null | undefined): AudienceLine | null {
  return raw === 'feminino' || raw === 'masculino' ? raw : null
}

function validVariantIds(service: ServiceRow, line: AudienceLine | null, ids: string[]): string[] {
  const zones = service.zones.filter((z) => z.active)
  const scoped: ServiceZoneRow[] = line ? zonesForAudienceLine(zones, line) : zones
  const allowed = new Set(scoped.map((z) => z.id))
  return ids.filter((id) => allowed.has(id))
}

/**
 * Cruza o preset guardado com serviços activos do tenant. Devolve só o que o catálogo confirma.
 */
export function resolveClientWebLinkPreset(
  services: readonly ServiceRow[],
  raw: {
    serviceId?: string | null
    audienceLine?: string | null
    variantIds?: string | null | string[]
    preferredDate?: string | null
    dayPart?: string | null
  },
): ClientWebLinkPreset {
  const preferredDate =
    raw.preferredDate && CIVIL.test(raw.preferredDate) ? raw.preferredDate : null
  const dayPart = asDayPart(raw.dayPart ?? null)
  const serviceId =
    raw.serviceId && services.some((s) => s.id === raw.serviceId && s.active) ? raw.serviceId : null
  if (!serviceId) {
    return { serviceId: null, audienceLine: null, variantIds: [], preferredDate, dayPart }
  }
  const service = services.find((s) => s.id === serviceId)!
  const activeZones = service.zones.filter((z) => z.active)
  const mixed = needsAudienceLine(activeZones)

  let audienceLine = asAudienceLine(raw.audienceLine ?? null)
  if (audienceLine && !mixed) audienceLine = null
  if (audienceLine && !serviceMatchesAudience(service.audiencia, audienceLine)) {
    audienceLine = null
  }

  const rawIds = Array.isArray(raw.variantIds)
    ? raw.variantIds
    : parseVariantIdsJson(raw.variantIds ?? null)
  const variantIds = validVariantIds(service, audienceLine, rawIds)

  return { serviceId, audienceLine, variantIds, preferredDate, dayPart }
}

/** Serializa variantIds para a coluna D1. */
export function serializeVariantIds(ids: string[]): string | null {
  if (ids.length === 0) return null
  return JSON.stringify(ids)
}