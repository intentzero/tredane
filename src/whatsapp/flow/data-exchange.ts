/**
 * #514 / ADR-0016: leitura de catálogo + horas para o endpoint Flow.
 * Não grava BookingFrame nem marca.
 * Sessão = snapshot do token (sem overlay do BookingFrame do DO — #537).
 * catalogVersion mid-flow: ADR §7 / #539.
 *
 * Função pura sobre o SQLite da clínica: o Clinic DO delega aqui e o
 * harness L1 (família FL-, metodologia de avaliação) usa a mesma lógica.
 */
import type { Clock } from '../../db/clock'
import { listServices } from '../../clinic/config/services'
import { quoteVisit } from '../../clinic/config/zones'
import { readCatalogVersion } from '../../clinic/ai/turn-context'
import type { ForecastAdapter } from '../../clinic/tempo/evaluate'
import type { ClinicDb } from '../../clinic/store'
import {
  flowVisitTotalLine,
  revalidateFlowFrameAgainstCatalog,
  type FlowBookingSnapshot,
  type FlowCatalogService,
  type FlowClearedField,
  type FlowSlotOption,
} from './screens'
import { listFlowFreeSlots } from './slots'

export type FlowDataExchangeResult = {
  catalog: FlowCatalogService[]
  slots: FlowSlotOption[]
  frame: FlowBookingSnapshot
  catalogMismatch: boolean
  clearedFields: FlowClearedField[]
  visitTotalLine: string | null
}

export async function flowDataExchangeLocal(input: {
  db: ClinicDb
  tenantId: string
  clock: Clock
  catalogVersion: string
  frame: FlowBookingSnapshot
  forecast?: ForecastAdapter
}): Promise<FlowDataExchangeResult> {
  const services = listServices(input.db, input.tenantId)
  const catalog: FlowCatalogService[] = services.map((s) => ({
    id: s.id,
    name: s.name,
    active: s.active,
    zones: s.zones.map((z) => ({
      id: z.id,
      name: z.name,
      audience: z.audience,
      active: z.active,
      durationMinutes: z.durationMinutes,
      priceCents: z.priceCents,
    })),
  }))
  // #537: não fazer merge com BookingFrame persistido — só o snapshot do token.
  let frame: FlowBookingSnapshot = {
    serviceId: input.frame.serviceId,
    line: input.frame.line,
    variantIds: input.frame.variantIds,
    slotKey: input.frame.slotKey,
  }
  const currentVersion = readCatalogVersion(input.db, input.tenantId)
  const catalogMismatch =
    Boolean(input.catalogVersion) && input.catalogVersion !== currentVersion
  let clearedFields: FlowClearedField[] = []
  if (catalogMismatch) {
    const revalidated = revalidateFlowFrameAgainstCatalog(frame, catalog)
    frame = revalidated.frame
    clearedFields = [...revalidated.cleared]
  }
  let slots: FlowSlotOption[] = []
  let visitTotalLine: string | null = null
  if (frame.serviceId) {
    const service = services.find((s) => s.id === frame.serviceId && s.active)
    if (service) {
      const needVariants = service.zones.some((z) => z.active)
      // #540: zonas no cadastro todas inactivas → não bookable (não lista horas).
      const hasInactiveOnlyZones =
        service.zones.length > 0 && !service.zones.some((z) => z.active)
      const variantsReady =
        hasInactiveOnlyZones
          ? false
          : !needVariants || (frame.variantIds && frame.variantIds.length > 0)
      const needLine =
        service.zones.some((z) => z.active && z.audience === 'feminino') &&
        service.zones.some((z) => z.active && z.audience === 'masculino')
      const lineReady = !needLine || frame.line != null
      if (variantsReady && lineReady) {
        slots = await listFlowFreeSlots({
          db: input.db,
          tenantId: input.tenantId,
          service,
          variantIds: frame.variantIds,
          clock: input.clock,
          forecast: input.forecast,
        })
        try {
          const activeZoneIds = service.zones.filter((z) => z.active).map((z) => z.id)
          const quote = quoteVisit(
            input.db,
            input.tenantId,
            service,
            activeZoneIds.length > 0 ? frame.variantIds : null,
          )
          visitTotalLine = flowVisitTotalLine({
            priceCents: quote.priceCents,
            comboName: quote.combo?.name ?? null,
          })
        } catch {
          visitTotalLine = null
        }
      }
    }
  }
  // ADR §7: hora já escolhida volta a ser calculada; se deixou de estar livre, limpa.
  if (frame.slotKey) {
    const stillOffered = slots.some((s) => s.id === frame.slotKey)
    if (!stillOffered) {
      frame = { ...frame, slotKey: null }
      if (!clearedFields.includes('slotKey')) clearedFields.push('slotKey')
    }
  }
  return { catalog, slots, frame, catalogMismatch, clearedFields, visitTotalLine }
}
