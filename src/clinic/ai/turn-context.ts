/**
 * TurnContext único por job do autodraft (#411 / núcleo §5).
 * Catálogo, recursos, sessão, mensagens e turno da cliente são lidos uma vez
 * e passados aos módulos. O catálogo compilado fica em memória por version.
 */
import type { Clock } from '../../db/clock'
import { currentClientTurnText } from '../catalog/audience'
import { listResources } from '../config/resources'
import { listServices } from '../config/services'
import { ensureClinicSettings } from '../config/settings'
import type { ClinicSettingsRow, ResourceRow, ServiceRow, ServiceZoneRow } from '../config/types'
import { listMessages } from '../inbox/messages'
import type { MessageRow } from '../inbox/types'
import type { ClinicDb } from '../store'
import { loadUpcomingAppointment } from './reschedule'
import { getScheduleSession, type ScheduleSession } from './schedule-session'

export type CatalogReadStats = {
  services: number
  resources: number
  messages: number
  settings: number
}

export type CompiledCatalog = {
  version: string
  services: ServiceRow[]
  resources: ResourceRow[]
  /** Nome normalizado → ids de serviço. */
  serviceIdsByNormName: Map<string, string[]>
  /** serviceId → profissionais activos. */
  professionalsByService: Map<string, Array<{ id: string; name: string }>>
  /** `${serviceId}:${audienceLine|any}` → variantes activas. */
  zonesByServiceLine: Map<string, ServiceZoneRow[]>
}

export type TurnContext = {
  tenantId: string
  conversationId: string
  contactId: string
  messageId: string
  settings: ClinicSettingsRow
  catalog: CompiledCatalog
  session: ScheduleSession | null
  upcoming: ReturnType<typeof loadUpcomingAppointment>
  messages: MessageRow[]
  /** Texto do turno actual da cliente (CF-13). */
  turnText: string
  /** Serviço em jogo (sessão), se houver. */
  serviceIdInPlay: string | null
}

/** Por instância de DB (DO = 1; testes = várias bootClinicDb no mesmo processo). */
const catalogCache = new WeakMap<object, CompiledCatalog>()

export function clearCompiledCatalogCache(db?: ClinicDb): void {
  if (db) catalogCache.delete(db)
}

export function peekCompiledCatalogCache(db: ClinicDb): CompiledCatalog | undefined {
  return catalogCache.get(db)
}

function normName(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
}

/** Versão do catálogo: max(updated_at) de serviços e recursos. */
export function readCatalogVersion(db: ClinicDb, tenantId: string): string {
  const row = db.get<{ s: number; r: number }>(
    `SELECT
       (SELECT COALESCE(MAX(updated_at), 0) FROM services WHERE tenant_id = ?) AS s,
       (SELECT COALESCE(MAX(updated_at), 0) FROM resources WHERE tenant_id = ?) AS r`,
    tenantId,
    tenantId,
  )
  return `${row?.s ?? 0}:${row?.r ?? 0}`
}

export function compileCatalog(
  services: ServiceRow[],
  resources: ResourceRow[],
  version: string,
): CompiledCatalog {
  const serviceIdsByNormName = new Map<string, string[]>()
  for (const s of services) {
    const key = normName(s.name)
    const list = serviceIdsByNormName.get(key) ?? []
    list.push(s.id)
    serviceIdsByNormName.set(key, list)
  }
  const professionalsByService = new Map<string, Array<{ id: string; name: string }>>()
  const zonesByServiceLine = new Map<string, ServiceZoneRow[]>()
  for (const s of services) {
    const pros = s.professionalIds
      .map((id) => resources.find((r) => r.id === id && r.kind === 'professional' && r.active))
      .filter((r): r is ResourceRow => Boolean(r))
      .map((r) => ({ id: r.id, name: r.name }))
    professionalsByService.set(s.id, pros)
    const active = s.zones.filter((z) => z.active)
    zonesByServiceLine.set(`${s.id}:any`, active)
    for (const line of ['feminino', 'masculino'] as const) {
      zonesByServiceLine.set(
        `${s.id}:${line}`,
        active.filter((z) => z.audience === line || z.audience === 'ambos'),
      )
    }
  }
  return {
    version,
    services,
    resources,
    serviceIdsByNormName,
    professionalsByService,
    zonesByServiceLine,
  }
}

export function getOrCompileCatalog(
  db: ClinicDb,
  tenantId: string,
  clock: Clock,
  stats?: CatalogReadStats,
): CompiledCatalog {
  const version = readCatalogVersion(db, tenantId)
  const cached = catalogCache.get(db)
  if (cached && cached.version === version) return cached
  if (stats) {
    stats.services += 1
    stats.resources += 1
  }
  const services = listServices(db, tenantId).filter((s) => s.active)
  const resources = listResources(db, tenantId, clock).filter((r) => r.active)
  const compiled = compileCatalog(services, resources, version)
  catalogCache.set(db, compiled)
  return compiled
}

export function loadTurnContext(
  db: ClinicDb,
  tenantId: string,
  input: {
    conversationId: string
    contactId: string
    messageId: string
    inboundBody?: string
  },
  clock: Clock,
  stats?: CatalogReadStats,
): TurnContext {
  if (stats) stats.settings += 1
  const settings = ensureClinicSettings(db, tenantId, clock)
  const catalog = getOrCompileCatalog(db, tenantId, clock, stats)
  if (stats) stats.messages += 1
  const { messages } = listMessages(db, tenantId, {
    conversationId: input.conversationId,
    limit: 40,
  })
  const turnText =
    currentClientTurnText(messages.map((m) => ({ direction: m.direction, body: m.body }))).trim() ||
    (input.inboundBody ?? '')
  const session = getScheduleSession(db, tenantId, input.conversationId)
  const upcoming = input.contactId
    ? loadUpcomingAppointment(db, tenantId, input.contactId, clock.nowMs())
    : null
  return {
    tenantId,
    conversationId: input.conversationId,
    contactId: input.contactId,
    messageId: input.messageId,
    settings,
    catalog,
    session,
    upcoming,
    messages,
    turnText,
    serviceIdInPlay: session?.serviceId ?? null,
  }
}
