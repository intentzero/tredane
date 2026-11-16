/**
 * Export / import do catálogo da clínica (serviços+variantes e profissionais).
 * Reconciliação Proposta (C + fusão de zonas): Project store
 * docs/importacao-reconciliacao-clinica.md — Paulo 16/11/2026.
 */
import type { Clock } from '../../db/clock'
import { ValidationError } from '../errors'
import type { ClinicDb } from '../store'
import { listWeeklyWindows, setWeeklyWindows } from './availability'
import { listCombos, replaceCombos } from './combos'
import { getResource, listResources, upsertResource } from './resources'
import { getService, listServices, upsertService } from './services'
import type {
  RoomRequirement,
  ServiceComboInput,
  ServiceRow,
  ServiceZoneInput,
  ServiceZoneRow,
  UpsertResourceInput,
  UpsertServiceInput,
} from './types'
import { replaceZones } from './zones'

export const CATALOG_TRANSFER_FORMAT = 'tredane.clinic-catalog' as const
export const CATALOG_TRANSFER_VERSION = 1 as const

export type CatalogTransferScopes = {
  services: boolean
  professionals: boolean
}

export type CatalogExportProfessional = {
  id: string
  name: string
  active: boolean
  hoursMode: 'clinic' | 'own'
  homeRoomId: string | null
  weeklyWindows: Array<{
    dayOfWeek: number
    startMinute: number
    endMinute: number
  }>
}

export type CatalogExportZone = {
  id: string
  name: string
  durationMinutes: number
  priceCents: number | null
  audience: ServiceZoneRow['audience']
  active: boolean
  sortOrder: number
  synonyms: string[]
  clientExplanation: string | null
  clientExplanationAudience: string | null
}

export type CatalogExportCombo = {
  id: string
  name: string
  priceCents: number
  zoneIds: string[]
  active: boolean
  sortOrder: number
}

export type CatalogExportService = {
  id: string
  name: string
  durationMinutes: number
  bufferMinutes: number
  audiencia: ServiceRow['audiencia']
  tempoCeu: ServiceRow['tempoCeu']
  tempoTemperatura: ServiceRow['tempoTemperatura']
  tempoCelsius: number | null
  priceCents: number | null
  clientExplanation: string | null
  active: boolean
  requiresSignal: boolean
  signalKind: ServiceRow['signalKind']
  signalFixedCents: number | null
  signalPercent: number | null
  professionalIds: string[]
  roomRequirement: RoomRequirement
  equipmentResourceId: string | null
  weeklyWindows: ServiceRow['weeklyWindows']
  variantKind: string | null
  variantKindPlural: string | null
  variantSelection: ServiceRow['variantSelection']
  synonyms: string[]
  zones: CatalogExportZone[]
  combos: CatalogExportCombo[]
}

export type CatalogTransferDocument = {
  format: typeof CATALOG_TRANSFER_FORMAT
  version: typeof CATALOG_TRANSFER_VERSION
  exportedAt: string
  sourceTenantId: string
  scopes: CatalogTransferScopes
  professionals: CatalogExportProfessional[]
  services: CatalogExportService[]
  personalDataNote: string
}

export type CatalogImportPlanItem = {
  scope: 'professionals' | 'services'
  action: 'create' | 'update' | 'skip'
  sourceId: string
  targetId: string | null
  name: string
  detail?: string
}

export type CatalogImportWarning = {
  code: string
  message: string
  sourceId?: string
}

export type CatalogImportResult = {
  dryRun: boolean
  scopes: CatalogTransferScopes
  items: CatalogImportPlanItem[]
  warnings: CatalogImportWarning[]
  idMap: {
    professionals: Record<string, string>
    services: Record<string, string>
    zones: Record<string, string>
  }
}

function foldName(value: string): string {
  return value.trim().toLocaleLowerCase('pt-BR')
}

function assertScopes(scopes: CatalogTransferScopes): void {
  if (!scopes.services && !scopes.professionals) {
    throw new ValidationError(
      'catalog_transfer_empty_scopes',
      'selecione pelo menos um: serviços ou profissionais',
    )
  }
}

export function normalizeCatalogScopes(input: unknown): CatalogTransferScopes {
  const raw = (input ?? {}) as Record<string, unknown>
  return {
    services: raw.services === true,
    professionals: raw.professionals === true,
  }
}

export function exportClinicCatalog(
  db: ClinicDb,
  tenantId: string,
  scopes: CatalogTransferScopes,
  clock: Clock,
): CatalogTransferDocument {
  assertScopes(scopes)
  const resources = listResources(db, tenantId, clock)
  const windows = listWeeklyWindows(db, tenantId)

  const professionals: CatalogExportProfessional[] = scopes.professionals
    ? resources
        .filter((r) => r.kind === 'professional')
        .map((r) => ({
          id: r.id,
          name: r.name,
          active: r.active,
          hoursMode: r.hoursMode,
          homeRoomId: r.homeRoomId,
          weeklyWindows: windows
            .filter((w) => w.resourceId === r.id)
            .map((w) => ({
              dayOfWeek: w.dayOfWeek,
              startMinute: w.startMinute,
              endMinute: w.endMinute,
            })),
        }))
    : []

  const services: CatalogExportService[] = scopes.services
    ? listServices(db, tenantId).map((s) => ({
        id: s.id,
        name: s.name,
        durationMinutes: s.durationMinutes,
        bufferMinutes: s.bufferMinutes,
        audiencia: s.audiencia,
        tempoCeu: s.tempoCeu,
        tempoTemperatura: s.tempoTemperatura,
        tempoCelsius: s.tempoCelsius,
        priceCents: s.priceCents,
        clientExplanation: s.clientExplanation,
        active: s.active,
        requiresSignal: s.requiresSignal,
        signalKind: s.signalKind,
        signalFixedCents: s.signalFixedCents,
        signalPercent: s.signalPercent,
        professionalIds: s.professionalIds,
        roomRequirement: s.roomRequirement,
        equipmentResourceId: s.equipmentResourceId,
        weeklyWindows: s.weeklyWindows,
        variantKind: s.variantKind,
        variantKindPlural: s.variantKindPlural,
        variantSelection: s.variantSelection,
        synonyms: s.synonyms,
        zones: s.zones.map((z) => ({
          id: z.id,
          name: z.name,
          durationMinutes: z.durationMinutes,
          priceCents: z.priceCents,
          audience: z.audience,
          active: z.active,
          sortOrder: z.sortOrder,
          synonyms: z.synonyms,
          clientExplanation: z.clientExplanation,
          clientExplanationAudience: z.clientExplanationAudience ?? null,
        })),
        combos: s.combos.map((c) => ({
          id: c.id,
          name: c.name,
          priceCents: c.priceCents,
          zoneIds: c.zoneIds,
          active: c.active,
          sortOrder: c.sortOrder,
        })),
      }))
    : []

  return {
    format: CATALOG_TRANSFER_FORMAT,
    version: CATALOG_TRANSFER_VERSION,
    exportedAt: new Date(clock.nowMs()).toISOString(),
    sourceTenantId: tenantId,
    scopes: { ...scopes },
    professionals,
    services,
    personalDataNote:
      'Este ficheiro pode incluir nomes de profissionais. Guarde-o com o mesmo cuidado dos dados da clínica; não partilhe fora da equipa autorizada.',
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function asBool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function asInt(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : null
}

function parseRoomRequirement(value: unknown): RoomRequirement | undefined {
  if (!isPlainObject(value)) return undefined
  if (value.mode === 'none') return { mode: 'none' }
  if (value.mode === 'rooms' && Array.isArray(value.resourceIds)) {
    const resourceIds = value.resourceIds.filter((id): id is string => typeof id === 'string')
    return { mode: 'rooms', resourceIds }
  }
  return undefined
}

export function parseCatalogTransferDocument(input: unknown): CatalogTransferDocument {
  if (!isPlainObject(input)) {
    throw new ValidationError('invalid_catalog_transfer', 'ficheiro de catálogo inválido')
  }
  if (input.format !== CATALOG_TRANSFER_FORMAT) {
    throw new ValidationError(
      'invalid_catalog_transfer_format',
      'formato desconhecido (esperado tredane.clinic-catalog)',
    )
  }
  if (input.version !== CATALOG_TRANSFER_VERSION) {
    throw new ValidationError(
      'invalid_catalog_transfer_version',
      `versão não suportada (esperado ${CATALOG_TRANSFER_VERSION})`,
    )
  }
  const sourceTenantId = asString(input.sourceTenantId)
  if (!sourceTenantId) {
    throw new ValidationError('invalid_catalog_transfer', 'sourceTenantId em falta')
  }
  const scopes = normalizeCatalogScopes(input.scopes)
  assertScopes(scopes)

  const professionalsRaw = Array.isArray(input.professionals) ? input.professionals : []
  const servicesRaw = Array.isArray(input.services) ? input.services : []

  const professionals: CatalogExportProfessional[] = []
  if (scopes.professionals) {
    for (const row of professionalsRaw) {
      if (!isPlainObject(row)) continue
      const id = asString(row.id)
      const name = asString(row.name)
      if (!id || !name) {
        throw new ValidationError('invalid_catalog_professional', 'profissional sem id ou nome')
      }
      const windows = Array.isArray(row.weeklyWindows)
        ? row.weeklyWindows.filter(isPlainObject).map((w) => ({
            dayOfWeek: asInt(w.dayOfWeek) ?? 0,
            startMinute: asInt(w.startMinute) ?? 0,
            endMinute: asInt(w.endMinute) ?? 0,
          }))
        : []
      professionals.push({
        id,
        name,
        active: asBool(row.active, true),
        hoursMode: row.hoursMode === 'own' ? 'own' : 'clinic',
        homeRoomId: asString(row.homeRoomId),
        weeklyWindows: windows,
      })
    }
  }

  const services: CatalogExportService[] = []
  if (scopes.services) {
    for (const row of servicesRaw) {
      if (!isPlainObject(row)) continue
      const id = asString(row.id)
      const name = asString(row.name)
      const durationMinutes = asInt(row.durationMinutes)
      const bufferMinutes = asInt(row.bufferMinutes)
      if (!id || !name || durationMinutes == null || bufferMinutes == null) {
        throw new ValidationError('invalid_catalog_service', 'serviço incompleto no ficheiro')
      }
      const zones: CatalogExportZone[] = Array.isArray(row.zones)
        ? row.zones.filter(isPlainObject).map((z) => {
            const zid = asString(z.id)
            const zname = asString(z.name)
            const zd = asInt(z.durationMinutes)
            if (!zid || !zname || zd == null) {
              throw new ValidationError('invalid_catalog_zone', 'variante incompleta no ficheiro')
            }
            const audience =
              z.audience === 'feminino' || z.audience === 'masculino' || z.audience === 'ambos'
                ? z.audience
                : null
            if (!audience) {
              throw new ValidationError('invalid_catalog_zone', 'género da variante inválido')
            }
            return {
              id: zid,
              name: zname,
              durationMinutes: zd,
              priceCents: z.priceCents === null ? null : asInt(z.priceCents),
              audience,
              active: asBool(z.active, true),
              sortOrder: asInt(z.sortOrder) ?? 0,
              synonyms: Array.isArray(z.synonyms)
                ? z.synonyms.filter((s): s is string => typeof s === 'string')
                : [],
              clientExplanation:
                z.clientExplanation === null || z.clientExplanation === undefined
                  ? null
                  : asString(z.clientExplanation),
              clientExplanationAudience:
                z.clientExplanationAudience === null || z.clientExplanationAudience === undefined
                  ? null
                  : asString(z.clientExplanationAudience),
            }
          })
        : []
      const combos: CatalogExportCombo[] = Array.isArray(row.combos)
        ? row.combos.filter(isPlainObject).map((c) => {
            const cid = asString(c.id)
            const cname = asString(c.name)
            const price = asInt(c.priceCents)
            if (!cid || !cname || price == null) {
              throw new ValidationError('invalid_catalog_combo', 'combo incompleto no ficheiro')
            }
            return {
              id: cid,
              name: cname,
              priceCents: price,
              zoneIds: Array.isArray(c.zoneIds)
                ? c.zoneIds.filter((x): x is string => typeof x === 'string')
                : [],
              active: asBool(c.active, true),
              sortOrder: asInt(c.sortOrder) ?? 0,
            }
          })
        : []
      const roomRequirement = parseRoomRequirement(row.roomRequirement) ?? { mode: 'none' }
      const weeklyWindows = Array.isArray(row.weeklyWindows)
        ? row.weeklyWindows.filter(isPlainObject).map((w) => ({
            dayOfWeek: asInt(w.dayOfWeek) ?? 0,
            startMinute: asInt(w.startMinute) ?? 0,
            endMinute: asInt(w.endMinute) ?? 0,
          }))
        : []
      const audiencia =
        row.audiencia === 'feminino' || row.audiencia === 'masculino' || row.audiencia === 'qualquer'
          ? row.audiencia
          : 'qualquer'
      services.push({
        id,
        name,
        durationMinutes,
        bufferMinutes,
        audiencia,
        tempoCeu:
          row.tempoCeu === 'sol' || row.tempoCeu === 'chuva' || row.tempoCeu === 'tanto_faz'
            ? row.tempoCeu
            : 'tanto_faz',
        tempoTemperatura:
          row.tempoTemperatura === 'acima' ||
          row.tempoTemperatura === 'abaixo' ||
          row.tempoTemperatura === 'tanto_faz'
            ? row.tempoTemperatura
            : 'tanto_faz',
        tempoCelsius: row.tempoCelsius === null ? null : asInt(row.tempoCelsius),
        priceCents: row.priceCents === null ? null : asInt(row.priceCents),
        clientExplanation:
          row.clientExplanation === null || row.clientExplanation === undefined
            ? null
            : asString(row.clientExplanation),
        active: asBool(row.active, true),
        requiresSignal: asBool(row.requiresSignal, false),
        signalKind:
          row.signalKind === 'fixed' || row.signalKind === 'percent' ? row.signalKind : null,
        signalFixedCents: row.signalFixedCents === null ? null : asInt(row.signalFixedCents),
        signalPercent: row.signalPercent === null ? null : asInt(row.signalPercent),
        professionalIds: Array.isArray(row.professionalIds)
          ? row.professionalIds.filter((x): x is string => typeof x === 'string')
          : [],
        roomRequirement,
        equipmentResourceId: asString(row.equipmentResourceId),
        weeklyWindows,
        variantKind: asString(row.variantKind),
        variantKindPlural: asString(row.variantKindPlural),
        variantSelection: row.variantSelection === 'uma' ? 'uma' : 'varias',
        synonyms: Array.isArray(row.synonyms)
          ? row.synonyms.filter((s): s is string => typeof s === 'string')
          : [],
        zones,
        combos,
      })
    }
  }

  return {
    format: CATALOG_TRANSFER_FORMAT,
    version: CATALOG_TRANSFER_VERSION,
    exportedAt: asString(input.exportedAt) ?? new Date(0).toISOString(),
    sourceTenantId,
    scopes,
    professionals,
    services,
    personalDataNote:
      asString(input.personalDataNote) ??
      'Este ficheiro pode incluir nomes de profissionais.',
  }
}

function spaceExists(db: ClinicDb, tenantId: string, resourceId: string, clock: Clock): boolean {
  const row = getResource(db, tenantId, resourceId, clock)
  return Boolean(row && (row.kind === 'room' || row.kind === 'equipment'))
}

function professionalIdsLive(db: ClinicDb, tenantId: string, clock: Clock): Set<string> {
  return new Set(
    listResources(db, tenantId, clock)
      .filter((r) => r.kind === 'professional')
      .map((r) => r.id),
  )
}

function zoneIdentityKey(z: {
  name: string
  audience: string
  durationMinutes: number
  priceCents: number | null
}): string {
  return `${foldName(z.name)}|${z.audience}|${z.durationMinutes}|${z.priceCents ?? 'null'}`
}

function mergeZoneInputs(
  local: ServiceZoneRow[],
  incoming: CatalogExportZone[],
  zoneMap: Map<string, string>,
  warnings: CatalogImportWarning[],
  serviceSourceId: string,
): ServiceZoneInput[] {
  const byId = new Map(local.map((z) => [z.id, z]))
  const byIdentity = new Map(local.map((z) => [zoneIdentityKey(z), z]))
  const usedLocal = new Set<string>()
  const merged: ServiceZoneInput[] = []

  for (const z of incoming) {
    const match = byId.get(z.id) ?? byIdentity.get(zoneIdentityKey(z))
    if (match) {
      usedLocal.add(match.id)
      zoneMap.set(z.id, match.id)
      merged.push({
        id: match.id,
        name: z.name,
        durationMinutes: z.durationMinutes,
        priceCents: z.priceCents,
        audience: z.audience,
        active: z.active,
        synonyms: z.synonyms,
        clientExplanation: z.clientExplanation,
        clientExplanationAudience: z.clientExplanationAudience,
      })
    } else {
      merged.push({
        name: z.name,
        durationMinutes: z.durationMinutes,
        priceCents: z.priceCents,
        audience: z.audience,
        active: z.active,
        synonyms: z.synonyms,
        clientExplanation: z.clientExplanation,
        clientExplanationAudience: z.clientExplanationAudience,
      })
      warnings.push({
        code: 'zone_will_get_new_id',
        message: `Variante «${z.name}» será criada com id novo.`,
        sourceId: serviceSourceId,
      })
    }
  }

  for (const z of local) {
    if (usedLocal.has(z.id)) continue
    merged.push({
      id: z.id,
      name: z.name,
      durationMinutes: z.durationMinutes,
      priceCents: z.priceCents,
      audience: z.audience,
      active: z.active,
      synonyms: z.synonyms,
      clientExplanation: z.clientExplanation,
      clientExplanationAudience: z.clientExplanationAudience ?? null,
    })
    warnings.push({
      code: 'zone_kept_local',
      message: `Variante local «${z.name}» mantida (não vinha no ficheiro).`,
      sourceId: serviceSourceId,
    })
  }

  return merged
}

function resolveProfessionalIds(
  sourceIds: string[],
  proMap: Map<string, string>,
  livePros: Set<string>,
  warnings: CatalogImportWarning[],
  serviceSourceId: string,
  serviceName: string,
): string[] {
  const out: string[] = []
  for (const pid of sourceIds) {
    const mapped = proMap.get(pid) ?? pid
    if (livePros.has(mapped)) {
      if (!out.includes(mapped)) out.push(mapped)
      continue
    }
    warnings.push({
      code: 'professional_ref_missing',
      message: `Serviço «${serviceName}»: profissional ${pid} não encontrado; removido de «quem faz».`,
      sourceId: serviceSourceId,
    })
  }
  return out
}

function resolveRooms(
  req: RoomRequirement,
  db: ClinicDb,
  tenantId: string,
  clock: Clock,
  warnings: CatalogImportWarning[],
  serviceSourceId: string,
  serviceName: string,
): RoomRequirement {
  if (req.mode === 'none') return { mode: 'none' }
  const kept = req.resourceIds.filter((id) => spaceExists(db, tenantId, id, clock))
  for (const id of req.resourceIds) {
    if (!kept.includes(id)) {
      warnings.push({
        code: 'room_ref_missing',
        message: `Serviço «${serviceName}»: sala ${id} não existe; retirada da lista.`,
        sourceId: serviceSourceId,
      })
    }
  }
  if (kept.length === 0) {
    warnings.push({
      code: 'room_requirement_none',
      message: `Serviço «${serviceName}» fica «sem espaço definido» (nenhuma sala do ficheiro existe aqui).`,
      sourceId: serviceSourceId,
    })
    return { mode: 'none' }
  }
  return { mode: 'rooms', resourceIds: kept }
}

function applyServiceZonesAndCombos(
  db: ClinicDb,
  tenantId: string,
  clock: Clock,
  serviceId: string,
  localZones: ServiceZoneRow[],
  svc: CatalogExportService,
  zoneMap: Map<string, string>,
  warnings: CatalogImportWarning[],
): void {
  if (svc.zones.length > 0 || localZones.length > 0) {
    const zoneInputs = mergeZoneInputs(localZones, svc.zones, zoneMap, warnings, svc.id)
    if (zoneInputs.length > 0) {
      let serviceForZones = getService(db, tenantId, serviceId)!
      if (
        (svc.zones.length > 0 || zoneInputs.some((z) => !z.id || !localZones.some((l) => l.id === z.id))) &&
        (!serviceForZones.variantKind || !serviceForZones.variantKindPlural) &&
        svc.variantKind &&
        svc.variantKindPlural
      ) {
        upsertService(
          db,
          tenantId,
          {
            id: serviceId,
            name: serviceForZones.name,
            durationMinutes: serviceForZones.durationMinutes,
            bufferMinutes: serviceForZones.bufferMinutes,
            professionalIds: serviceForZones.professionalIds,
            variantKind: svc.variantKind,
            variantKindPlural: svc.variantKindPlural,
          },
          clock,
        )
        serviceForZones = getService(db, tenantId, serviceId)!
      }
      const written = replaceZones(db, tenantId, serviceForZones, zoneInputs, clock)
      for (const src of svc.zones) {
        if (zoneMap.has(src.id)) continue
        const found = written.find((w) => zoneIdentityKey(w) === zoneIdentityKey(src))
        if (found) zoneMap.set(src.id, found.id)
      }
    }
  }

  const liveZones = getService(db, tenantId, serviceId)!.zones
  const localCombos = listCombos(db, tenantId, serviceId)
  if (svc.combos.length === 0 && localCombos.length === 0) return

  const comboInputs: ServiceComboInput[] = []
  const usedLocal = new Set<string>()
  for (const c of svc.combos) {
    const okZones = c.zoneIds
      .map((zid) => zoneMap.get(zid) ?? zid)
      .filter((zid) => liveZones.some((z) => z.id === zid))
    if (okZones.length < 2) {
      warnings.push({
        code: 'combo_skipped',
        message: `Combo «${c.name}» omitido (faltam variantes no destino).`,
        sourceId: svc.id,
      })
      continue
    }
    const local = localCombos.find(
      (x) => x.id === c.id || foldName(x.name) === foldName(c.name),
    )
    if (local) usedLocal.add(local.id)
    comboInputs.push({
      id: local?.id,
      name: c.name,
      priceCents: c.priceCents,
      zoneIds: okZones,
      active: c.active,
    })
  }
  for (const c of localCombos) {
    if (usedLocal.has(c.id)) continue
    comboInputs.push({
      id: c.id,
      name: c.name,
      priceCents: c.priceCents,
      zoneIds: c.zoneIds,
      active: c.active,
    })
    warnings.push({
      code: 'combo_kept_local',
      message: `Combo local «${c.name}» mantido.`,
      sourceId: svc.id,
    })
  }
  replaceCombos(db, tenantId, serviceId, comboInputs, clock)
}

export function importClinicCatalog(
  db: ClinicDb,
  tenantId: string,
  doc: CatalogTransferDocument,
  clock: Clock,
  opts: { dryRun: boolean; scopes: CatalogTransferScopes },
): CatalogImportResult {
  assertScopes(opts.scopes)
  const warnings: CatalogImportWarning[] = []
  const items: CatalogImportPlanItem[] = []
  const proMap = new Map<string, string>()
  const serviceMap = new Map<string, string>()
  const zoneMap = new Map<string, string>()
  const apply = !opts.dryRun

  const existingPros = listResources(db, tenantId, clock).filter((r) => r.kind === 'professional')
  const existingServices = [...listServices(db, tenantId)]

  if (opts.scopes.professionals) {
    for (const pro of doc.professionals) {
      const match =
        existingPros.find((r) => r.id === pro.id) ??
        existingPros.find((r) => foldName(r.name) === foldName(pro.name))

      let homeRoomId = pro.homeRoomId
      if (homeRoomId && !spaceExists(db, tenantId, homeRoomId, clock)) {
        warnings.push({
          code: 'home_room_missing',
          message: `Sala de ${pro.name} não existe nesta clínica; ligação removida.`,
          sourceId: pro.id,
        })
        homeRoomId = null
      }

      if (match) {
        proMap.set(pro.id, match.id)
        const skipDeactivate =
          pro.active === false && match.active && match.futureAppointmentCount > 0
        if (skipDeactivate) {
          warnings.push({
            code: 'professional_deactivate_skipped',
            message: `${pro.name} tem marcações futuras; permanece activa.`,
            sourceId: pro.id,
          })
        }
        items.push({
          scope: 'professionals',
          action: 'update',
          sourceId: pro.id,
          targetId: match.id,
          name: pro.name,
          detail: skipDeactivate ? 'active mantido por marcações futuras' : undefined,
        })
        if (apply) {
          const input: UpsertResourceInput = {
            id: match.id,
            kind: 'professional',
            name: pro.name,
            active: skipDeactivate ? true : pro.active,
            hoursMode: pro.hoursMode,
            homeRoomId,
          }
          upsertResource(db, tenantId, input, clock)
          setWeeklyWindows(
            db,
            tenantId,
            { resourceId: match.id, windows: pro.weeklyWindows },
            clock,
          )
        }
      } else {
        items.push({
          scope: 'professionals',
          action: 'create',
          sourceId: pro.id,
          targetId: null,
          name: pro.name,
        })
        if (apply) {
          const created = upsertResource(
            db,
            tenantId,
            {
              kind: 'professional',
              name: pro.name,
              active: pro.active,
              hoursMode: pro.hoursMode,
              homeRoomId,
            },
            clock,
          )
          proMap.set(pro.id, created.id)
          existingPros.push(created)
          setWeeklyWindows(
            db,
            tenantId,
            { resourceId: created.id, windows: pro.weeklyWindows },
            clock,
          )
        }
      }
    }
  }

  // Ids de profissionais do destino (e do lote já aplicado) para remapear serviços.
  for (const r of existingPros) {
    if (![...proMap.values()].includes(r.id)) proMap.set(r.id, r.id)
  }
  if (opts.scopes.services) {
    for (const s of doc.services) {
      for (const pid of s.professionalIds) {
        if (proMap.has(pid)) continue
        const local = existingPros.find((r) => r.id === pid)
        if (local) proMap.set(pid, local.id)
      }
    }
  }

  if (opts.scopes.services) {
    for (const svc of doc.services) {
      const match =
        existingServices.find((s) => s.id === svc.id) ??
        existingServices.find((s) => foldName(s.name) === foldName(svc.name))

      const livePros = professionalIdsLive(db, tenantId, clock)
      // Em dry-run, profissionais «a criar» ainda não têm id real — não entram em quem faz.
      const professionalIds = resolveProfessionalIds(
        svc.professionalIds,
        proMap,
        livePros,
        warnings,
        svc.id,
        svc.name,
      )
      const roomRequirement = resolveRooms(
        svc.roomRequirement,
        db,
        tenantId,
        clock,
        warnings,
        svc.id,
        svc.name,
      )
      let equipmentResourceId = svc.equipmentResourceId
      if (equipmentResourceId && !spaceExists(db, tenantId, equipmentResourceId, clock)) {
        warnings.push({
          code: 'equipment_ref_missing',
          message: `Serviço «${svc.name}»: equipamento ausente; removido.`,
          sourceId: svc.id,
        })
        equipmentResourceId = null
      }

      if (match) {
        serviceMap.set(svc.id, match.id)
        items.push({
          scope: 'services',
          action: 'update',
          sourceId: svc.id,
          targetId: match.id,
          name: svc.name,
        })
        // Pré-visualização de fusão de zonas também no dry-run.
        if (svc.zones.length > 0 || match.zones.length > 0) {
          mergeZoneInputs(match.zones, svc.zones, zoneMap, warnings, svc.id)
        }
        if (apply) {
          const liveAfter = professionalIdsLive(db, tenantId, clock)
          const finalPros = resolveProfessionalIds(
            svc.professionalIds,
            proMap,
            liveAfter,
            [],
            svc.id,
            svc.name,
          )
          const input: UpsertServiceInput = {
            id: match.id,
            name: svc.name,
            durationMinutes: svc.durationMinutes,
            bufferMinutes: svc.bufferMinutes,
            audiencia: svc.audiencia,
            tempoCeu: svc.tempoCeu,
            tempoTemperatura: svc.tempoTemperatura,
            tempoCelsius: svc.tempoCelsius,
            priceCents: svc.priceCents,
            clientExplanation: svc.clientExplanation,
            active: svc.active,
            professionalIds: finalPros.length > 0 ? finalPros : professionalIds,
            roomRequirement,
            equipmentResourceId,
            requiresSignal: svc.requiresSignal,
            signalKind: svc.signalKind,
            signalFixedCents: svc.signalFixedCents,
            signalPercent: svc.signalPercent,
            weeklyWindows: svc.weeklyWindows,
            variantKind: svc.variantKind,
            variantKindPlural: svc.variantKindPlural,
            variantSelection: svc.variantSelection,
            synonyms: svc.synonyms,
          }
          upsertService(db, tenantId, input, clock)
          applyServiceZonesAndCombos(
            db,
            tenantId,
            clock,
            match.id,
            match.zones,
            svc,
            zoneMap,
            warnings,
          )
        }
      } else {
        items.push({
          scope: 'services',
          action: 'create',
          sourceId: svc.id,
          targetId: null,
          name: svc.name,
        })
        if (svc.zones.length > 0) {
          mergeZoneInputs([], svc.zones, zoneMap, warnings, svc.id)
        }
        if (apply) {
          const liveAfter = professionalIdsLive(db, tenantId, clock)
          const finalPros = resolveProfessionalIds(
            svc.professionalIds,
            proMap,
            liveAfter,
            [],
            svc.id,
            svc.name,
          )
          const created = upsertService(
            db,
            tenantId,
            {
              name: svc.name,
              durationMinutes: svc.durationMinutes,
              bufferMinutes: svc.bufferMinutes,
              audiencia: svc.audiencia,
              tempoCeu: svc.tempoCeu,
              tempoTemperatura: svc.tempoTemperatura,
              tempoCelsius: svc.tempoCelsius,
              priceCents: svc.priceCents,
              clientExplanation: svc.clientExplanation,
              active: svc.active,
              professionalIds: finalPros,
              roomRequirement,
              equipmentResourceId,
              requiresSignal: svc.requiresSignal,
              signalKind: svc.signalKind,
              signalFixedCents: svc.signalFixedCents,
              signalPercent: svc.signalPercent,
              weeklyWindows: svc.weeklyWindows,
              variantKind: svc.variantKind,
              variantKindPlural: svc.variantKindPlural,
              variantSelection: svc.variantSelection,
              synonyms: svc.synonyms,
            },
            clock,
          )
          serviceMap.set(svc.id, created.id)
          existingServices.push(created)
          applyServiceZonesAndCombos(db, tenantId, clock, created.id, [], svc, zoneMap, warnings)
        }
      }
    }
  }

  return {
    dryRun: opts.dryRun,
    scopes: { ...opts.scopes },
    items,
    warnings,
    idMap: {
      professionals: Object.fromEntries(proMap),
      services: Object.fromEntries(serviceMap),
      zones: Object.fromEntries(zoneMap),
    },
  }
}
