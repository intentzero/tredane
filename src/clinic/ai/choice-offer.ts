/**
 * M5 (#415) / DEC-128 — ofertas fechadas por botão ou lista WhatsApp.
 * Ids opacos ligados a `pending` + `catalogVersion`. Toque monta o passo seguinte;
 * só o Confirmar da proposta marca (DEC-061). Texto livre continua aceite.
 *
 * Rótulos CTA da lista («Opções», «Horários»): **Proposto** — texto à cliente;
 * pedem ok do Paulo no PR (DEC-104 / DEC-128). Títulos das opções reusam
 * nomes de catálogo / «Feminina»·«Masculina»·«Todas» já no funil.
 */
import type { Clock } from '../../db/clock'
import type { ClinicCaller } from '../envelopes'
import { listServices } from '../config/services'
import { sendOutboundMessageOp } from '../inbox/operations'
import type { SendOutboundInteractiveInput } from '../inbox/types'
import type { OutboxRow } from '../outbox'
import type { ClinicDb } from '../store'
import { tryAiAutoBook, type AutoBookOutcome } from './autobook'
import { cancelAutoDraft } from './autodraft'
import { isPendingOfferFresh } from './booking-frame-choice'
import {
  createDeferredBookingFrame,
  OUTBOUND_MESSAGE_ID_PLACEHOLDER,
  type DeferredBookingFrame,
} from './deferred-booking-frame'
import {
  getBookingFrame,
  type BookingFrameLastOffer,
  type BookingFramePending,
} from './schedule-session'
import { zonesForAudienceLine, type AudienceLine } from './variant-line'

/** Prefixo estável dos ids opacos (Cloud API button/list row id, ≤200). */
export const CHOICE_ID_PREFIX = 'ch1~'

export type ChoiceSlot = 'linha' | 'variantes' | 'horario' | 'eco'

export type ChoiceInteractiveButtons = {
  mode: 'buttons'
  buttons: Array<{ id: string; title: string }>
}

export type ChoiceInteractiveList = {
  mode: 'list'
  button: string
  sections: Array<{
    title?: string
    rows: Array<{ id: string; title: string; description?: string }>
  }>
}

export type ChoiceInteractive = ChoiceInteractiveButtons | ChoiceInteractiveList

/** CTA da lista de variantes — Confirmado (DEC-134). */
export const VARIANT_LIST_BUTTON_LABEL = 'Opções'
/** CTA da lista de horários — Confirmado (DEC-134). */
export const SLOT_LIST_BUTTON_LABEL = 'Horários'

/** Eco das zonas em texto livre — Confirmado (DEC-137). Sim não marca (DEC-061). */
export const ZONE_ECHO_SIM_KEY = 'sim'
export const ZONE_ECHO_CORRIGIR_KEY = 'corrigir'
export const ZONE_ECHO_SIM_LABEL = 'Sim'
export const ZONE_ECHO_CORRIGIR_LABEL = 'Corrigir'

export const LINE_BUTTON_TITLES = {
  feminino: 'Feminina',
  masculino: 'Masculina',
} as const

export const TODAS_OPTION_KEY = 'todas'
export const TODAS_OPTION_LABEL = 'Todas'

/** Limites Cloud API (list message) — doc Meta vigente. */
export const META_LIST_MAX_ROWS = 10
export const META_LIST_ROW_TITLE_MAX = 24
export const META_LIST_ROW_DESCRIPTION_MAX = 72
export const META_LIST_BUTTON_MAX = 20
export const META_BUTTON_TITLE_MAX = 20
export const META_ROW_ID_MAX = 200

const SLOT_CHOICE_KEY = /^(\d{4}-\d{2}-\d{2})T([01]\d|2[0-3]):([0-5]\d)$/
const CLOCK_CHOICE_KEY = /^([01]\d|2[0-3]):([0-5]\d)$/

/**
 * Slot oferecido ligado ao id da lista (ou à opção já gravada).
 * Não lê `11-03` nem `03/11` do título: isso não é data civil.
 */
export function slotBindingFromChoice(
  key: string,
  label: string,
): { date: string; time: string } | null {
  const keyed = key.trim().match(SLOT_CHOICE_KEY)
  if (keyed) return { date: keyed[1]!, time: `${keyed[2]}:${keyed[3]}` }
  const clock = key.trim().match(CLOCK_CHOICE_KEY)
  const iso = label.match(/\b(\d{4}-\d{2}-\d{2})\b/)
  const labelClock = label.match(/\b([01]\d|2[0-3]):([0-5]\d)\b/)
  const time = clock ? `${clock[1]}:${clock[2]}` : labelClock ? `${labelClock[1]}:${labelClock[2]}` : null
  if (iso && time) return { date: iso[1]!, time }
  return null
}

const AUTODRAFT_ACTOR_ID = 'system:ai-autodraft'

function clip(text: string, max: number): string {
  const t = text.trim()
  if (t.length <= max) return t
  return `${t.slice(0, Math.max(1, max - 1)).trimEnd()}…`
}

export function encodeChoiceId(
  slot: ChoiceSlot,
  catalogVersion: string,
  key: string,
): string {
  const id = `${CHOICE_ID_PREFIX}${[slot, catalogVersion, key].map(encodeURIComponent).join('~')}`
  if (id.length > META_ROW_ID_MAX) {
    throw new Error('choice_id_too_long')
  }
  return id
}

export function parseChoiceId(
  raw: string,
): { slot: ChoiceSlot; catalogVersion: string; key: string } | null {
  const s = raw.trim()
  if (!s.startsWith(CHOICE_ID_PREFIX)) return null
  const parts = s.slice(CHOICE_ID_PREFIX.length).split('~')
  if (parts.length !== 3) return null
  let slot: string
  let catalogVersion: string
  let key: string
  try {
    slot = decodeURIComponent(parts[0]!)
    catalogVersion = decodeURIComponent(parts[1]!)
    key = decodeURIComponent(parts[2]!)
  } catch {
    return null
  }
  if (slot !== 'linha' && slot !== 'variantes' && slot !== 'horario' && slot !== 'eco') return null
  if (!catalogVersion || !key) return null
  return { slot, catalogVersion, key }
}

export function isChoiceOfferId(raw: string): boolean {
  return parseChoiceId(raw) != null
}

export function pendingForChoiceOffer(input: {
  slot: ChoiceSlot
  options: Array<{ key: string; label: string }>
}): BookingFramePending {
  return {
    slot: input.slot,
    options: input.options,
    messageId: OUTBOUND_MESSAGE_ID_PLACEHOLDER,
  }
}

export function buildLineChoiceInteractive(catalogVersion: string): {
  interactive: ChoiceInteractiveButtons
  pending: BookingFramePending
} {
  const options = [
    { key: 'feminino', label: LINE_BUTTON_TITLES.feminino },
    { key: 'masculino', label: LINE_BUTTON_TITLES.masculino },
  ]
  return {
    interactive: {
      mode: 'buttons',
      buttons: options.map((o) => ({
        id: encodeChoiceId('linha', catalogVersion, o.key),
        title: clip(o.label, META_BUTTON_TITLE_MAX),
      })),
    },
    pending: pendingForChoiceOffer({ slot: 'linha', options }),
  }
}

/** «Axila e Pernas» — nomes do catálogo, sem fuso. */
export function joinZoneNamesPt(names: readonly string[]): string {
  const unique: string[] = []
  const seen = new Set<string>()
  for (const raw of names) {
    const name = raw.trim()
    if (!name) continue
    const key = name.toLocaleLowerCase('pt-BR')
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(name)
  }
  if (unique.length <= 1) return unique[0] ?? ''
  if (unique.length === 2) return `${unique[0]} e ${unique[1]}`
  return `${unique.slice(0, -1).join(', ')} e ${unique[unique.length - 1]}`
}

/** DEC-137. Frase fixa antes da lista Horários. */
export function zoneEchoReply(zones: readonly { name: string }[]): string {
  return `Entendi: ${joinZoneNamesPt(zones.map((zone) => zone.name))}. Certo?`
}

export function buildZoneEchoInteractive(catalogVersion: string): {
  interactive: ChoiceInteractiveButtons
  pending: BookingFramePending
} {
  const options = [
    { key: ZONE_ECHO_SIM_KEY, label: ZONE_ECHO_SIM_LABEL },
    { key: ZONE_ECHO_CORRIGIR_KEY, label: ZONE_ECHO_CORRIGIR_LABEL },
  ]
  return {
    interactive: {
      mode: 'buttons',
      buttons: options.map((o) => ({
        id: encodeChoiceId('eco', catalogVersion, o.key),
        title: clip(o.label, META_BUTTON_TITLE_MAX),
      })),
    },
    pending: pendingForChoiceOffer({ slot: 'eco', options }),
  }
}

export function buildVariantChoiceInteractive(input: {
  catalogVersion: string
  zones: Array<{ id: string; name: string; label?: string }>
}): { interactive: ChoiceInteractiveList; pending: BookingFramePending } {
  const zoneOpts = input.zones.map((z) => ({
    key: z.id,
    label: (z.label ?? z.name).trim() || z.name,
  }))
  const capped =
    zoneOpts.length >= META_LIST_MAX_ROWS
      ? zoneOpts.slice(0, META_LIST_MAX_ROWS - 1)
      : zoneOpts
  const options = [...capped, { key: TODAS_OPTION_KEY, label: TODAS_OPTION_LABEL }].slice(
    0,
    META_LIST_MAX_ROWS,
  )
  return {
    interactive: {
      mode: 'list',
      button: clip(VARIANT_LIST_BUTTON_LABEL, META_LIST_BUTTON_MAX),
      sections: [
        {
          rows: options.map((o) => ({
            id: encodeChoiceId('variantes', input.catalogVersion, o.key),
            title: clip(o.label, META_LIST_ROW_TITLE_MAX),
          })),
        },
      ],
    },
    pending: pendingForChoiceOffer({ slot: 'variantes', options }),
  }
}

export function buildSlotChoiceInteractive(input: {
  catalogVersion: string
  slots: Array<{ key: string; label: string; description?: string }>
}): { interactive: ChoiceInteractiveList; pending: BookingFramePending } {
  const options = input.slots.slice(0, META_LIST_MAX_ROWS)
  return {
    interactive: {
      mode: 'list',
      button: clip(SLOT_LIST_BUTTON_LABEL, META_LIST_BUTTON_MAX),
      sections: [
        {
          rows: options.map((o) => {
            const description = o.description?.trim()
            return {
              id: encodeChoiceId('horario', input.catalogVersion, o.key),
              title: clip(o.label, META_LIST_ROW_TITLE_MAX),
              ...(description
                ? { description: clip(description, META_LIST_ROW_DESCRIPTION_MAX) }
                : {}),
            }
          }),
        },
      ],
    },
    pending: pendingForChoiceOffer({
      slot: 'horario',
      options: options.map((o) => ({ key: o.key, label: o.label })),
    }),
  }
}

/** Converte ChoiceInteractive → input de sendOutboundMessageOp. */
export function toSendInteractive(
  choice: ChoiceInteractive | null | undefined,
): SendOutboundInteractiveInput | null {
  if (!choice) return null
  if (choice.mode === 'buttons') return { buttons: choice.buttons }
  return { list: { button: choice.button, sections: choice.sections } }
}

export type ChoiceOfferClickInput = {
  tenantId: string
  conversationId: string
  buttonId: string
  buttonTitle?: string | null
  contextMessageId?: string | null
  providerEventKey?: string | null
  capability?: boolean
}

export type ChoiceOfferClickResult =
  | { handled: false; reason: 'not_choice_id' }
  | {
      handled: true
      outcome: 'applied' | 'stale_reoffered' | 'stale_cleared'
      autoBook?: AutoBookOutcome
      outbox: OutboxRow[]
      reason?: string
    }

export function validateChoiceAgainstFrame(
  db: ClinicDb,
  tenantId: string,
  conversationId: string,
  buttonId: string,
  nowMs: number,
):
  | {
      ok: true
      slot: ChoiceSlot
      key: string
      label: string
      catalogVersion: string
    }
  | {
      ok: false
      reason:
        | 'not_choice_id'
        | 'no_pending'
        | 'slot_mismatch'
        | 'unknown_option'
        | 'catalog_mismatch'
        | 'expired'
    } {
  const parsed = parseChoiceId(buttonId)
  if (!parsed) return { ok: false, reason: 'not_choice_id' }
  const frame = getBookingFrame(db, tenantId, conversationId)
  if (!frame?.pending || frame.pending.options.length === 0) {
    return { ok: false, reason: 'no_pending' }
  }
  if (frame.pending.slot !== parsed.slot) {
    return { ok: false, reason: 'slot_mismatch' }
  }
  const opt = frame.pending.options.find((o) => o.key === parsed.key)
  if (!opt) return { ok: false, reason: 'unknown_option' }
  if (frame.catalogVersion !== '' && parsed.catalogVersion !== frame.catalogVersion) {
    return { ok: false, reason: 'catalog_mismatch' }
  }
  const pendingMsg = db.get<{ created_at: number }>(
    `SELECT created_at FROM messages WHERE tenant_id = ? AND id = ?`,
    tenantId,
    frame.pending.messageId,
  )
  if (!isPendingOfferFresh(pendingMsg?.created_at ?? null, nowMs)) {
    return { ok: false, reason: 'expired' }
  }
  return {
    ok: true,
    slot: parsed.slot,
    key: parsed.key,
    label: opt.label,
    catalogVersion: parsed.catalogVersion,
  }
}

function semanticTextForChoice(
  db: ClinicDb,
  tenantId: string,
  conversationId: string,
  slot: ChoiceSlot,
  key: string,
  label: string,
): string {
  if (slot === 'linha') {
    return key === 'masculino' ? 'masculina' : 'feminina'
  }
  if (slot === 'eco') {
    // #510 / DEC-137: Sim confirma o conjunto já no quadro — não reinjectar
    // nomes de zonas (evita segundo parser na confirmação).
    if (key === 'sim') return 'sim'
    if (key === 'corrigir') return 'corrigir'
    return label
  }
  if (slot === 'variantes') {
    if (key !== TODAS_OPTION_KEY) return label
    const frame = getBookingFrame(db, tenantId, conversationId)
    const services = listServices(db, tenantId).filter((s) => s.active)
    const svc = services.find((s) => s.id === frame?.serviceId)
    if (!svc) return TODAS_OPTION_LABEL
    const active = svc.zones.filter((z) => z.active)
    const scoped = zonesForAudienceLine(active, (frame?.line as AudienceLine | null) ?? null)
    const names = scoped.map((z) => z.name)
    return names.length > 0 ? names.join(' e ') : TODAS_OPTION_LABEL
  }
  // Horário: a data vem do id (slotBinding), não do título «11-03 17:00».
  const bound = slotBindingFromChoice(key, label)
  if (bound) return `às ${bound.time}`
  return key.match(/\d{2}:\d{2}/)?.[0] ?? label
}

function clearPendingFrame(
  db: ClinicDb,
  tenantId: string,
  conversationId: string,
  clock: Clock,
): OutboxRow[] {
  const frame = getBookingFrame(db, tenantId, conversationId)
  if (!frame?.serviceId) return []
  const deferred = createDeferredBookingFrame()
  deferred.save({
    serviceId: frame.serviceId,
    pending: null,
    lastOffer: null,
    phase: 'coletando',
  })
  return deferred.flushNow(db, tenantId, conversationId, clock)
}

function sendChoiceOutbound(
  db: ClinicDb,
  caller: ClinicCaller,
  clock: Clock,
  conversationId: string,
  autoBook: AutoBookOutcome,
  clientRequestId: string,
): OutboxRow[] {
  if (autoBook.proposalId && !autoBook.replyText?.trim()) {
    autoBook.deferredFrame?.discard()
    return []
  }
  const body = autoBook.replyText?.trim()
  if (!body) {
    if (autoBook.deferredFrame?.hasWork) {
      return autoBook.deferredFrame.flushNow(db, caller.tenantId, conversationId, clock)
    }
    return []
  }
  const interactive = toSendInteractive(autoBook.interactive ?? null)
  try {
    const sent = sendOutboundMessageOp(
      db,
      caller,
      {
        conversationId,
        body,
        interactive,
        clientRequestId,
        authorClerkUserId: AUTODRAFT_ACTOR_ID,
        authorDisplayName: 'IA',
        ...(autoBook.deferredFrame?.hasWork
          ? { afterPersist: autoBook.deferredFrame.toAfterPersist(clock) }
          : {}),
      },
      clock,
    )
    autoBook.deferredFrame?.discard()
    return sent.outbox
  } catch {
    if (autoBook.deferredFrame?.hasWork) {
      return autoBook.deferredFrame.flushNow(db, caller.tenantId, conversationId, clock)
    }
    return []
  }
}

/**
 * Processa toque em opção de linha/variantes/horário.
 * Não marca compromisso (DEC-061): só avança o funil / monta proposta.
 */
export async function handleChoiceOfferClick(
  db: ClinicDb,
  caller: ClinicCaller,
  input: ChoiceOfferClickInput,
  clock: Clock,
): Promise<ChoiceOfferClickResult> {
  if (!parseChoiceId(input.buttonId)) {
    return { handled: false, reason: 'not_choice_id' }
  }

  cancelAutoDraft(db, input.tenantId, input.conversationId)

  const validated = validateChoiceAgainstFrame(
    db,
    input.tenantId,
    input.conversationId,
    input.buttonId,
    clock.nowMs(),
  )

  const lastInbound = db.get<{ id: string }>(
    `SELECT id FROM messages
     WHERE tenant_id = ? AND conversation_id = ? AND direction = 'inbound'
     ORDER BY created_at DESC LIMIT 1`,
    input.tenantId,
    input.conversationId,
  )
  const confirmationMessageId =
    lastInbound?.id ?? `choice:${input.providerEventKey ?? clock.nowMs()}`

  if (!validated.ok) {
    const cleared = clearPendingFrame(db, input.tenantId, input.conversationId, clock)
    const frame = getBookingFrame(db, input.tenantId, input.conversationId)
    // Reoferta: texto mínimo com o serviço já conhecido para o funil repetir o passo.
    const services = listServices(db, input.tenantId).filter((s) => s.active)
    const svc = services.find((s) => s.id === frame?.serviceId)
    const reofferText = svc?.name?.trim() || 'quero agendar'
    const autoBook = await tryAiAutoBook(db, caller, clock, {
      conversationId: input.conversationId,
      capability: input.capability !== false,
      turnTextOverride: reofferText,
      confirmationMessageIdOverride: confirmationMessageId,
    })
    const outbox = [
      ...cleared,
      ...autoBook.outbox,
      ...sendChoiceOutbound(
        db,
        caller,
        clock,
        input.conversationId,
        autoBook,
        `choice-stale:${input.providerEventKey ?? clock.nowMs()}`,
      ),
    ]
    return {
      handled: true,
      outcome: autoBook.replyText?.trim() || autoBook.proposalId ? 'stale_reoffered' : 'stale_cleared',
      autoBook,
      outbox,
      reason: validated.reason,
    }
  }

  // DEC-137: toque em Opções já é explícito (sem eco). Sim confirma o conjunto
  // e só então pede Horários — não marca (DEC-061). Corrigir volta às zonas.
  const zoneEcho =
    validated.slot === 'variantes'
      ? ('skip' as const)
      : validated.slot === 'eco' && validated.key === 'sim'
        ? ('confirm' as const)
        : validated.slot === 'eco' && validated.key === 'corrigir'
          ? ('correct' as const)
          : undefined

  const boundSlot =
    validated.slot === 'horario'
      ? slotBindingFromChoice(validated.key, validated.label)
      : null

  let turnText = semanticTextForChoice(
    db,
    input.tenantId,
    input.conversationId,
    validated.slot,
    validated.key,
    validated.label,
  )
  if (zoneEcho === 'correct') {
    const frame = getBookingFrame(db, input.tenantId, input.conversationId)
    const services = listServices(db, input.tenantId).filter((s) => s.active)
    const svc = services.find((s) => s.id === frame?.serviceId)
    turnText = svc?.name?.trim() || 'quero agendar'
  }

  // Limpa pending da oferta tocada antes do autobook (nova oferta virá no reply).
  clearPendingFrame(db, input.tenantId, input.conversationId, clock)

  const autoBook = await tryAiAutoBook(db, caller, clock, {
    conversationId: input.conversationId,
    capability: input.capability !== false,
    turnTextOverride: turnText,
    confirmationMessageIdOverride: confirmationMessageId,
    ...(boundSlot ? { boundSlot } : {}),
    zoneEcho,
  })

  const outbox = [
    ...autoBook.outbox,
    ...sendChoiceOutbound(
      db,
      caller,
      clock,
      input.conversationId,
      autoBook,
      `choice:${input.providerEventKey ?? clock.nowMs()}`,
    ),
  ]
  return { handled: true, outcome: 'applied', autoBook, outbox }
}

/** Anexa pending (+ lastOffer) e devolve interactive para o outbound. */
export function attachChoiceOfferToDeferred(
  deferred: DeferredBookingFrame,
  serviceId: string,
  catalogVersion: string,
  built: { interactive: ChoiceInteractive; pending: BookingFramePending },
  extra?: {
    lastOffer?: BookingFrameLastOffer | null
    phase?: 'coletando' | 'ofertado'
  },
): ChoiceInteractive {
  deferred.save({
    serviceId,
    catalogVersion,
    pending: built.pending,
    ...(extra?.lastOffer !== undefined ? { lastOffer: extra.lastOffer } : {}),
    phase:
      extra?.phase ?? (built.pending.slot === 'horario' ? 'ofertado' : 'coletando'),
  })
  return built.interactive
}
