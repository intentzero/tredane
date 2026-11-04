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

/**
 * Agendável: activo e, se tem zonas no cadastro, pelo menos uma activa.
 * Confirmado (`variantes-de-servico.md` / H1→A): todas inactivas → sem marcação nova.
 */
export function isServiceBookable(service: FlowCatalogService): boolean {
  if (!service.active) return false
  if (service.zones.length > 0 && !service.zones.some((z) => z.active)) return false
  return true
}

export function bookableServices(catalog: FlowCatalogService[]): FlowCatalogService[] {
  return catalog.filter(isServiceBookable)
}

export function activeZones(service: FlowCatalogService) {
  return service.zones.filter((z) => z.active)
}

export type FlowClearedField = 'serviceId' | 'line' | 'variantIds' | 'slotKey'

/**
 * Revalida o snapshot do token contra o catálogo actual (ADR-0016 §7).
 * Ids mortos são limpos sem substituto inventado; slot fica para o caller
 * confrontar com a lista livre.
 */
export function revalidateFlowFrameAgainstCatalog(
  frame: FlowBookingSnapshot,
  catalog: FlowCatalogService[],
): { frame: FlowBookingSnapshot; cleared: FlowClearedField[] } {
  const cleared: FlowClearedField[] = []
  const services = bookableServices(catalog)
  if (!frame.serviceId) {
    return { frame: { ...frame }, cleared }
  }
  const service = services.find((s) => s.id === frame.serviceId) ?? null
  if (!service) {
    if (frame.serviceId) cleared.push('serviceId')
    if (frame.line) cleared.push('line')
    if (frame.variantIds?.length) cleared.push('variantIds')
    if (frame.slotKey) cleared.push('slotKey')
    return {
      frame: { serviceId: null, line: null, variantIds: null, slotKey: null },
      cleared,
    }
  }

  let line = frame.line
  const zones = activeZones(service)
  // Linha sobrando (já não precisa de GENERO) limpa-se em silêncio — não é id morto.
  if (line && !needsAudienceLine(zones)) {
    line = null
  }

  let variantIds = frame.variantIds
  if (zones.length > 0 && variantIds && variantIds.length > 0) {
    const scoped =
      line && needsAudienceLine(zones) ? zonesForAudienceLine(zones, line) : zones
    const ids = new Set(scoped.map((z) => z.id))
    const ok = variantIds.filter((id) => ids.has(id))
    if (ok.length !== variantIds.length) {
      cleared.push('variantIds')
      variantIds = ok.length > 0 ? ok : null
    }
  } else if (zones.length === 0) {
    variantIds = null
  }

  let slotKey = frame.slotKey
  if (
    (cleared.includes('serviceId') ||
      cleared.includes('variantIds') ||
      cleared.includes('line')) &&
    slotKey
  ) {
    // Duração / âmbito mudou → hora tem de ser recalculada.
    slotKey = null
    if (!cleared.includes('slotKey')) cleared.push('slotKey')
  }

  return {
    frame: {
      serviceId: service.id,
      line,
      variantIds,
      slotKey,
    },
    cleared,
  }
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

/**
 * Campos dinâmicos alinhados ao Flow JSON publicado (data schema por ecrã).
 * Meta: `payload-schema-error` se o data não conformar ao schema do layout —
 * chaves a mais / a menos / tipo errado. Sempre enviar `error_message` ("" se
 * não houver snackbar). Não enviar `title`/`layout`/`footer`: o JSON usa
 * `screen.title` estático e componentes fixos (Dropdown/Radio/Checkbox).
 */
function screenData(
  fields: Record<string, unknown>,
  errorMessage?: string,
): Record<string, unknown> {
  return {
    ...fields,
    error_message: errorMessage ?? '',
  }
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
 * Ecrã de entrada do `routing_model` publicado: sem aresta a entrar.
 * Só `SERVICO` — GENERO/VARIANTES/HORARIO têm inbound a partir dele.
 * Meta: INIT tem de pousar num entry screen; senão `invalid-screen-transition`
 * e a UI mostra «Something went wrong».
 */
export const FLOW_ENTRY_SCREEN: FlowScreenId = 'SERVICO'

/**
 * Payload do ecrã de entrada para `action: INIT`.
 * Não salta SERVICO mesmo com `serviceId` na sessão ou um único agendável —
 * o salto continua em `data_exchange` (SERVICO → GENERO|VARIANTES|HORARIO
 * está no routing_model).
 */
export function entryFlowScreen(input: {
  catalog: FlowCatalogService[]
  errorMessage?: string
}): FlowScreenPayload | { kind: 'chat_fallback'; reason: string } {
  const services = bookableServices(input.catalog)
  if (services.length === 0) {
    return { kind: 'chat_fallback', reason: 'no_bookable_services' }
  }
  if (services.length > 200) {
    return { kind: 'chat_fallback', reason: 'too_many_services' }
  }
  return {
    screen: FLOW_ENTRY_SCREEN,
    data: screenData(
      { body: FLOW_COPY.serviceBody, services: serviceOptions(services) },
      input.errorMessage,
    ),
  }
}

/**
 * Decide o primeiro ecrã ainda em falta (data_exchange / BACK).
 * Não usar no INIT — ver `entryFlowScreen` / `FLOW_ENTRY_SCREEN`.
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
      // JSON publicado: só Dropdown em SERVICO (schema: body, services,
      // error_message). Sem `title`/`layout` — Meta payload-schema-error.
      return {
        screen: 'SERVICO',
        data: screenData(
          { body: FLOW_COPY.serviceBody, services: serviceOptions(services) },
          input.errorMessage,
        ),
      }
    }
  }

  const zones = activeZones(service!)
  let line = input.frame.line
  if (needsAudienceLine(zones) && !line) {
    return {
      screen: 'GENERO',
      data: screenData(
        {
          body: FLOW_COPY.genderBody(service!.name),
          genders: genderOptions(),
        },
        input.errorMessage,
      ),
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
          data: screenData(
            { body: FLOW_COPY.variantsBody, variants: opts },
            input.errorMessage,
          ),
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
    data: screenData(
      { body: FLOW_COPY.slotBody, slots: slotOptions(slots) },
      input.errorMessage,
    ),
  }
}

/** Aplica a submissão de um ecrã ao snapshot (sem gravar). */
export function applyScreenSubmission(
  catalog: FlowCatalogService[],
  frame: FlowBookingSnapshot,
  screen: FlowScreenId,
  data: Record<string, unknown>,
  opts?: { offeredSlots?: readonly FlowSlotOption[] },
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
    // #536 / contra-análise P1: id civil não basta — tem de ∈ lista oferecida.
    const offered = opts?.offeredSlots
    if (offered && !offered.some((s) => s.id === key)) {
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
  // Params sem `null` — o cliente Meta rejeita tipos inesperados em fechos.
  const params: Record<string, unknown> = {
    flow_token: flowToken,
    variant_ids: frame.variantIds ?? [],
  }
  if (frame.serviceId) params.service_id = frame.serviceId
  if (frame.line) params.line = frame.line
  if (frame.slotKey) params.slot_id = frame.slotKey
  if (opts?.fallbackReason) params.fallback_reason = opts.fallbackReason
  return {
    screen: 'SUCCESS',
    data: {
      extension_message_response: { params },
    },
  }
}
