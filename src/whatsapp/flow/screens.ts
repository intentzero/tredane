/**
 * Routing dos ecrãs do Flow de agendamento (ADR-0016 §3).
 * Puro: recebe catálogo/quadro/horas e devolve o ecrã seguinte.
 * Não marca, não escolhe sala/profissional, não chama o modelo.
 */
import { TODAS_OPTION_KEY } from '../../clinic/ai/choice-offer'
import { needsAudienceLine, zonesForAudienceLine } from '../../clinic/ai/variant-line'
import { slotListRowCopy } from '../../clinic/ai/slot-offer'
import { FLOW_COPY, FLOW_GENDER_LABELS, FLOW_TODAS_LABEL } from './copy'

export type FlowScreenId = 'SERVICO' | 'GENERO' | 'VARIANTES' | 'HORARIO' | 'SUCCESS'

export type FlowCatalogService = {
  id: string
  name: string
  active: boolean
  zones: Array<{
    id: string
    name: string
    audience?: string | null
    active: boolean
    durationMinutes: number
    priceCents?: number | null
  }>
}

export type FlowBookingSnapshot = {
  serviceId: string | null
  line: 'feminino' | 'masculino' | null
  variantIds: string[] | null
  /** Id civil YYYY-MM-DDTHH:MM quando já há hora válida. */
  slotKey: string | null
}

export type FlowDataOption = { id: string; title: string }

export type FlowScreenPayload = {
  screen: FlowScreenId
  data: Record<string, unknown>
}

export type FlowSlotOption = {
  /** YYYY-MM-DDTHH:MM — mesmo contrato de #507 / offerFramePatch. */
  id: string
  date: string
  time: string
}

/** CheckboxGroup: Todas ocupa 1 vaga → no máximo 19 variantes. */
export const FLOW_MAX_VARIANTS_IN_CHECKBOX = 19
/** Dropdown sem imagem: teto Meta. */
export const FLOW_MAX_SLOTS = 200
/** RadioButtonsGroup: teto Meta. */
export const FLOW_MAX_RADIO = 20

export function bookableServices(catalog: FlowCatalogService[]): FlowCatalogService[] {
  return catalog.filter((s) => s.active)
}

export function activeZones(service: FlowCatalogService) {
  return service.zones.filter((z) => z.active)
}

function serviceOptions(services: FlowCatalogService[]): FlowDataOption[] {
  return services.map((s) => ({
    id: s.id,
    title: s.name.trim().slice(0, 30) || s.id,
  }))
}

function genderOptions(): FlowDataOption[] {
  return [
    { id: 'feminino', title: FLOW_GENDER_LABELS.feminino },
    { id: 'masculino', title: FLOW_GENDER_LABELS.masculino },
  ]
}

function variantOptions(
  service: FlowCatalogService,
  line: 'feminino' | 'masculino' | null,
): FlowDataOption[] | 'too_many' {
  const active = activeZones(service)
  const scoped =
    line && needsAudienceLine(active) ? zonesForAudienceLine(active, line) : active
  if (scoped.length === 0) return []
  if (scoped.length > FLOW_MAX_VARIANTS_IN_CHECKBOX) return 'too_many'
  const rows: FlowDataOption[] = scoped.map((z) => ({
    id: z.id,
    title: z.name.trim().slice(0, 30) || z.id,
  }))
  rows.push({ id: TODAS_OPTION_KEY, title: FLOW_TODAS_LABEL })
  return rows
}

function slotOptions(slots: FlowSlotOption[]): FlowDataOption[] {
  return slots.slice(0, FLOW_MAX_SLOTS).map((s) => {
    const copy = slotListRowCopy(s.date, s.time)
    return { id: s.id, title: copy.title.slice(0, 30) }
  })
}

export function resolveVariantIds(
  service: FlowCatalogService,
  line: 'feminino' | 'masculino' | null,
  selected: string[],
): string[] {
  const active = activeZones(service)
  const scoped =
    line && needsAudienceLine(active) ? zonesForAudienceLine(active, line) : active
  const ids = new Set(scoped.map((z) => z.id))
  if (selected.includes(TODAS_OPTION_KEY)) return scoped.map((z) => z.id)
  return selected.filter((id) => ids.has(id))
}

/**
 * Decide o primeiro ecrã ainda em falta (INIT / data_exchange).
 * `slots` só é necessário quando o destino é HORARIO.
 */
export function nextFlowScreen(input: {
  catalog: FlowCatalogService[]
  frame: FlowBookingSnapshot
  /** Horas livres já filtradas (queryAutomaticAvailability). */
  slots?: FlowSlotOption[]
  errorMessage?: string
}): FlowScreenPayload | { kind: 'chat_fallback'; reason: string } | { kind: 'ready' } {
  const services = bookableServices(input.catalog)
  if (services.length === 0) {
    return { kind: 'chat_fallback', reason: 'no_bookable_services' }
  }
  if (services.length > 200) {
    return { kind: 'chat_fallback', reason: 'too_many_services' }
  }

  let serviceId = input.frame.serviceId
  let service = serviceId ? services.find((s) => s.id === serviceId) ?? null : null
  if (serviceId && !service) {
    serviceId = null
  }
  if (!serviceId) {
    if (services.length === 1) {
      service = services[0]!
      serviceId = service.id
    } else {
      const opts = serviceOptions(services)
      const useDropdown = opts.length > FLOW_MAX_RADIO
      return {
        screen: 'SERVICO',
        data: {
          title: FLOW_COPY.serviceTitle,
          body: FLOW_COPY.serviceBody,
          services: opts,
          layout: useDropdown ? 'dropdown' : 'radio',
          ...(input.errorMessage ? { error_message: input.errorMessage } : {}),
        },
      }
    }
  }

  const zones = activeZones(service!)
  let line = input.frame.line
  if (needsAudienceLine(zones) && !line) {
    return {
      screen: 'GENERO',
      data: {
        title: FLOW_COPY.genderTitle,
        body: FLOW_COPY.genderBody(service!.name),
        genders: genderOptions(),
        ...(input.errorMessage ? { error_message: input.errorMessage } : {}),
      },
    }
  }
  if (line && !needsAudienceLine(zones)) {
    line = null
  }

  if (zones.length > 0) {
    const haveVariants =
      Array.isArray(input.frame.variantIds) && input.frame.variantIds.length > 0
    if (!haveVariants) {
      const opts = variantOptions(service!, line)
      if (opts === 'too_many') {
        return { kind: 'chat_fallback', reason: 'too_many_variants' }
      }
      if (opts.length > 0) {
        return {
          screen: 'VARIANTES',
          data: {
            body: FLOW_COPY.variantsBody,
            variants: opts,
            ...(input.errorMessage ? { error_message: input.errorMessage } : {}),
          },
        }
      }
    }
  }

  if (input.frame.slotKey) {
    return { kind: 'ready' }
  }

  const slots = input.slots ?? []
  if (slots.length === 0) {
    return { kind: 'chat_fallback', reason: 'no_slots' }
  }
  return {
    screen: 'HORARIO',
    data: {
      title: FLOW_COPY.slotTitle,
      body: FLOW_COPY.slotBody,
      slots: slotOptions(slots),
      footer: FLOW_COPY.slotFooter,
      ...(input.errorMessage ? { error_message: input.errorMessage } : {}),
    },
  }
}

/** Aplica a submissão de um ecrã ao snapshot (sem gravar). */
export function applyScreenSubmission(
  catalog: FlowCatalogService[],
  frame: FlowBookingSnapshot,
  screen: FlowScreenId,
  data: Record<string, unknown>,
):
  | { ok: true; frame: FlowBookingSnapshot }
  | { ok: false; errorMessage: string; frame: FlowBookingSnapshot } {
  const services = bookableServices(catalog)
  if (screen === 'SERVICO') {
    const id = typeof data.service_id === 'string' ? data.service_id : null
    const svc = id ? services.find((s) => s.id === id) : null
    if (!svc) {
      return { ok: false, errorMessage: FLOW_COPY.catalogChanged, frame }
    }
    return {
      ok: true,
      frame: {
        serviceId: svc.id,
        line: null,
        variantIds: null,
        slotKey: null,
      },
    }
  }

  const service = frame.serviceId
    ? services.find((s) => s.id === frame.serviceId) ?? null
    : null
  if (!service) {
    return { ok: false, errorMessage: FLOW_COPY.catalogChanged, frame }
  }

  if (screen === 'GENERO') {
    const line = data.gender_id === 'feminino' || data.gender_id === 'masculino'
      ? data.gender_id
      : null
    if (!line || !needsAudienceLine(activeZones(service))) {
      return { ok: false, errorMessage: FLOW_COPY.catalogChanged, frame }
    }
    return {
      ok: true,
      frame: { ...frame, line, variantIds: null, slotKey: null },
    }
  }

  if (screen === 'VARIANTES') {
    const raw = data.variant_ids
    const selected = Array.isArray(raw)
      ? raw.filter((x): x is string => typeof x === 'string')
      : typeof raw === 'string'
        ? [raw]
        : []
    const ids = resolveVariantIds(service, frame.line, selected)
    if (ids.length === 0) {
      return { ok: false, errorMessage: FLOW_COPY.catalogChanged, frame }
    }
    return {
      ok: true,
      frame: { ...frame, variantIds: ids, slotKey: null },
    }
  }

  if (screen === 'HORARIO') {
    const key = typeof data.slot_id === 'string' ? data.slot_id : null
    if (!key || !/^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/.test(key)) {
      return { ok: false, errorMessage: FLOW_COPY.slotGone, frame }
    }
    return { ok: true, frame: { ...frame, slotKey: key } }
  }

  return { ok: false, errorMessage: FLOW_COPY.catalogChanged, frame }
}

/** Motivo para o chat assumir após fecho do Flow (ADR §3 — não SUCCESS «vazio»). */
export type FlowChatFallbackReason =
  | 'no_slots'
  | 'too_many_variants'
  | 'no_bookable_services'
  | 'too_many_services'

export function successPayload(
  flowToken: string,
  frame: FlowBookingSnapshot,
  opts?: { fallbackReason?: FlowChatFallbackReason },
): FlowScreenPayload {
  return {
    screen: 'SUCCESS',
    data: {
      extension_message_response: {
        params: {
          flow_token: flowToken,
          service_id: frame.serviceId,
          line: frame.line,
          variant_ids: frame.variantIds ?? [],
          slot_id: frame.slotKey,
          ...(opts?.fallbackReason
            ? { fallback_reason: opts.fallbackReason }
            : {}),
        },
      },
    },
  }
}
