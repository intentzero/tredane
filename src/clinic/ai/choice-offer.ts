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
import {
  maybeReplaceM5WithFlow,
  sessionFromBookingFrame,
  type PrepareBookingFlowOffer,
} from '../../whatsapp/flow/offer-live'
import { tryAiAutoBook, type AutoBookOutcome } from './autobook'
import { sendProposalToWhatsAppOp } from '../proposals/send'
import { cancelAutoDraft } from './autodraft'
import {
  ensureChoiceClickOutbound,
  logInteractiveClickOutcome,
} from './interactive-click-guard'
import { isPendingOfferFresh } from './booking-frame-choice'
import { readCatalogVersion } from './turn-context'
import {
  createDeferredBookingFrame,
  OUTBOUND_MESSAGE_ID_PLACEHOLDER,
  type DeferredBookingFrame,
} from './deferred-booking-frame'
import {
  getBookingFrame,
  saveBookingFrame,
  type BookingFrameLastOffer,
  type BookingFramePending,
} from './schedule-session'
import { allowsMultipleVariants } from '../catalog/variant-selection'
import { zonesForAudienceLine, type AudienceLine } from './variant-line'

/** Prefixo estável dos ids opacos (Cloud API button/list row id, ≤200). */
export const CHOICE_ID_PREFIX = 'ch1~'

export type ChoiceSlot =
  | 'linha'
  | 'variantes'
  | 'horario'
  | 'eco'
  /** DEC-178: acumulação multi-zona Mais | Pronto (após toque em Opções). */
  | 'acumular'
  | 'audiencia'
  /** T1 (Paulo 09/11/2026): Manhã | Tarde | Outro dia após período/dia vazio. */
  | 'periodo'
  /** Alterar detalhes → menu Horário|Serviço|Variantes (Paulo 09/11/2026). */
  | 'alter'

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

/** DEC-178 — acumulação por toque em Opções (modo `varias`). Pronto não marca (DEC-061). */
export const ZONE_ACCUM_MAIS_KEY = 'mais'
export const ZONE_ACCUM_PRONTO_KEY = 'pronto'
export const ZONE_ACCUM_MAIS_LABEL = 'Mais'
export const ZONE_ACCUM_PRONTO_LABEL = 'Pronto'

/** T1 — período/dia vazio (Paulo 09/11/2026). Sem wait «Sim». */
export const PERIOD_DAY_MANHA_KEY = 'manha'
export const PERIOD_DAY_TARDE_KEY = 'tarde'
export const PERIOD_DAY_OUTRO_DIA_KEY = 'outro_dia'
export const PERIOD_DAY_MANHA_LABEL = 'Manhã'
export const PERIOD_DAY_TARDE_LABEL = 'Tarde'
export const PERIOD_DAY_OUTRO_DIA_LABEL = 'Outro dia'

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
  if (
    slot !== 'linha' &&
    slot !== 'variantes' &&
    slot !== 'horario' &&
    slot !== 'eco' &&
    slot !== 'acumular' &&
    slot !== 'audiencia' &&
    slot !== 'periodo' &&
    slot !== 'alter'
  ) {
    return null
  }
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

/**
 * Lista de zonas no eco DEC-137 (frase WhatsApp): minúsculas pt-BR, só vírgulas.
 * Confirmado (Paulo, 09/11/2026): «Entendi: axila, pernas, costas. Certo?» —
 * sem «e» antes do último; rótulos Meta Opções/Sim/Corrigir inalterados.
 */
export function joinZoneNamesPt(names: readonly string[]): string {
  const unique: string[] = []
  const seen = new Set<string>()
  for (const raw of names) {
    const name = raw.trim().toLocaleLowerCase('pt-BR')
    if (!name) continue
    if (seen.has(name)) continue
    seen.add(name)
    unique.push(name)
  }
  return unique.join(', ')
}

/** DEC-137. Frase fixa antes da lista Horários. */
export function zoneEchoReply(zones: readonly { name: string }[]): string {
  return `Entendi: ${joinZoneNamesPt(zones.map((zone) => zone.name))}. Certo?`
}

/**
 * DEC-178. Confirmação curta após toque em zona — sem «Entendi: … Certo?».
 * Só os nomes já acumulados (minúsculas / vírgulas).
 */
export function zoneAccumAckReply(zones: readonly { name: string }[]): string {
  const joined = joinZoneNamesPt(zones.map((zone) => zone.name))
  return joined || 'Ok.'
}

/** DEC-178. Corpo ao reabrir Opções (Mais): marca o já escolhido. */
export function zoneAccumMaisBody(zones: readonly { name: string }[]): string {
  const joined = joinZoneNamesPt(zones.map((zone) => zone.name))
  return joined ? `já: ${joined}` : 'Quais zonas?'
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

/** DEC-178 — Mais | Pronto após cada toque de zona em modo `varias`. */
export function buildZoneAccumInteractive(
  catalogVersion: string,
  opts?: { onlyPronto?: boolean },
): {
  interactive: ChoiceInteractiveButtons
  pending: BookingFramePending
} {
  const options = opts?.onlyPronto
    ? [{ key: ZONE_ACCUM_PRONTO_KEY, label: ZONE_ACCUM_PRONTO_LABEL }]
    : [
        { key: ZONE_ACCUM_MAIS_KEY, label: ZONE_ACCUM_MAIS_LABEL },
        { key: ZONE_ACCUM_PRONTO_KEY, label: ZONE_ACCUM_PRONTO_LABEL },
      ]
  return {
    interactive: {
      mode: 'buttons',
      buttons: options.map((o) => ({
        id: encodeChoiceId('acumular', catalogVersion, o.key),
        title: clip(o.label, META_BUTTON_TITLE_MAX),
      })),
    },
    pending: pendingForChoiceOffer({ slot: 'acumular', options }),
  }
}

/** T1 — Manhã | Tarde | Outro dia após período/dia vazio. */
export function buildPeriodDayInteractive(catalogVersion: string): {
  interactive: ChoiceInteractiveButtons
  pending: BookingFramePending
} {
  const options = [
    { key: PERIOD_DAY_MANHA_KEY, label: PERIOD_DAY_MANHA_LABEL },
    { key: PERIOD_DAY_TARDE_KEY, label: PERIOD_DAY_TARDE_LABEL },
    { key: PERIOD_DAY_OUTRO_DIA_KEY, label: PERIOD_DAY_OUTRO_DIA_LABEL },
  ]
  return {
    interactive: {
      mode: 'buttons',
      buttons: options.map((o) => ({
        id: encodeChoiceId('periodo', catalogVersion, o.key),
        title: clip(o.label, META_BUTTON_TITLE_MAX),
      })),
    },
    pending: pendingForChoiceOffer({ slot: 'periodo', options }),
  }
}

export function buildVariantChoiceInteractive(input: {
  catalogVersion: string
  zones: Array<{ id: string; name: string; label?: string }>
  /** DEC-145 — modo `uma` omite a linha «Todas». Default: incluir (varias). */
  includeTodas?: boolean
  /** DEC-178 — ids já acumulados: omitidos da lista (corpo «já: …» no caller). */
  omitIds?: readonly string[]
}): { interactive: ChoiceInteractiveList; pending: BookingFramePending } {
  const omit = new Set((input.omitIds ?? []).filter(Boolean))
  const zoneOpts = input.zones
    .filter((z) => !omit.has(z.id))
    .map((z) => ({
      key: z.id,
      label: (z.label ?? z.name).trim() || z.name,
    }))
  const includeTodas = input.includeTodas !== false
  const capped =
    includeTodas && zoneOpts.length >= META_LIST_MAX_ROWS
      ? zoneOpts.slice(0, META_LIST_MAX_ROWS - 1)
      : zoneOpts.slice(0, META_LIST_MAX_ROWS)
  const options = (
    includeTodas ? [...capped, { key: TODAS_OPTION_KEY, label: TODAS_OPTION_LABEL }] : capped
  ).slice(0, META_LIST_MAX_ROWS)
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
            const title = clip(o.label, META_LIST_ROW_TITLE_MAX)
            const description = o.description?.trim()
            // Meta ecoa título + description no bubble do list_reply; iguais →
            // linha duplicada («sexta 13/11 11:15» ×2). Comparar com o título
            // já cortado: se description === label completo (>24) e title corta,
            // a description deve ficar (DEC-134 A) — não comparar com o.label.
            const distinct = description && description !== title ? description : ''
            return {
              id: encodeChoiceId('horario', input.catalogVersion, o.key),
              title,
              ...(distinct
                ? { description: clip(distinct, META_LIST_ROW_DESCRIPTION_MAX) }
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
  /** Mantido na assinatura. O CTA do hub já não substitui a reoferta M5 (DEC-144). */
  prepareBookingFlowOffer?: PrepareBookingFlowOffer
}

export type ChoiceOfferClickResult =
  | { handled: false; reason: 'not_choice_id' }
  | {
      handled: true
      outcome: 'applied' | 'stale_reoffered' | 'stale_cleared'
      autoBook?: AutoBookOutcome
      outbox: OutboxRow[]
      reason?: string
      fallbackSent?: boolean
      silentPrevented?: boolean
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
  if (slot === 'acumular') {
    // DEC-178: Mais / Pronto — sem reinjectar nomes (conjunto já no quadro).
    if (key === ZONE_ACCUM_MAIS_KEY) return 'mais'
    if (key === ZONE_ACCUM_PRONTO_KEY) return 'pronto'
    return label
  }
  if (slot === 'periodo') {
    if (key === PERIOD_DAY_MANHA_KEY) return 'de manhã'
    if (key === PERIOD_DAY_TARDE_KEY) return 'de tarde'
    if (key === PERIOD_DAY_OUTRO_DIA_KEY) return 'quero ver outro dia'
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

/**
 * Limpa pending/lastOffer consumidos na mesma TX do outbound (ADR-0015).
 * Se o turno já anexou pending novo (eco, Opções, Mais|Pronto, Horários), preserva-o.
 */
function attachClearPendingOnSend(
  autoBook: AutoBookOutcome,
  db: ClinicDb,
  tenantId: string,
  conversationId: string,
): AutoBookOutcome {
  const frame = getBookingFrame(db, tenantId, conversationId)
  if (!frame?.serviceId) return autoBook
  // Oferta nova deste turno (attachChoiceOfferToDeferred) — não apagar.
  if (autoBook.deferredFrame?.pendingSlot) return autoBook
  const patch = {
    serviceId: frame.serviceId,
    pending: null,
    lastOffer: null,
    phase: 'coletando' as const,
  }
  if (autoBook.deferredFrame?.hasWork) {
    autoBook.deferredFrame.save(patch)
    return autoBook
  }
  const deferred = createDeferredBookingFrame()
  deferred.save(patch)
  return { ...autoBook, deferredFrame: deferred }
}

async function sendChoiceOutbound(
  db: ClinicDb,
  caller: ClinicCaller,
  clock: Clock,
  conversationId: string,
  autoBook: AutoBookOutcome,
  clientRequestId: string,
  prepareBookingFlowOffer?: PrepareBookingFlowOffer,
): Promise<OutboxRow[]> {
  if (autoBook.proposalId && !autoBook.replyText?.trim()) {
    if (autoBook.outbox.length > 0) {
      autoBook.deferredFrame?.discard()
      return []
    }
    // `already_sent` devolve outbox vazio — tenta reenfileirar antes do anti-silêncio.
    const afterPersist = autoBook.deferredFrame?.hasWork
      ? autoBook.deferredFrame.toAfterPersist(clock)
      : undefined
    const resent = sendProposalToWhatsAppOp(
      db,
      caller,
      { proposalId: autoBook.proposalId, ...(afterPersist ? { afterPersist } : {}) },
      clock,
    )
    autoBook.deferredFrame?.discard()
    if (resent.outbox.length > 0) return resent.outbox
  }
  const replyBody = autoBook.replyText?.trim()
  if (!replyBody) {
    if (autoBook.deferredFrame?.hasWork) {
      return autoBook.deferredFrame.flushNow(db, caller.tenantId, conversationId, clock)
    }
    return []
  }
  const frameNow =
    autoBook.deferredFrame?.peekFrame(db, caller.tenantId, conversationId) ??
    getBookingFrame(db, caller.tenantId, conversationId)
  const replaced = await maybeReplaceM5WithFlow({
    choice: autoBook.interactive ?? null,
    replyBody,
    prepare: prepareBookingFlowOffer,
    tenantId: caller.tenantId,
    conversationId,
    catalogVersion: frameNow?.catalogVersion || readCatalogVersion(db, caller.tenantId),
    session: sessionFromBookingFrame(frameNow),
    deferred: autoBook.deferredFrame,
  })
  try {
    const sent = sendOutboundMessageOp(
      db,
      caller,
      {
        conversationId,
        body: replaced.body,
        interactive: replaced.interactive,
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

async function finishChoiceClick(
  db: ClinicDb,
  caller: ClinicCaller,
  input: ChoiceOfferClickInput,
  clock: Clock,
  partial: {
    outcome: 'applied' | 'stale_reoffered' | 'stale_cleared'
    autoBook?: AutoBookOutcome
    outbox: OutboxRow[]
    reason?: string
  },
  timing: { startedMs: number; aiDurationMs?: number | null },
): Promise<ChoiceOfferClickResult> {
  const guarded = ensureChoiceClickOutbound(
    db,
    caller,
    {
      conversationId: input.conversationId,
      providerEventKey: input.providerEventKey,
      outcome: partial.outcome,
      reason: partial.reason,
      outbox: partial.outbox,
    },
    clock,
  )
  const outbox = guarded.outbox
  const autoBook = partial.autoBook
  const patientOut = outbox.filter((o) => o.type === 'whatsapp.send').length
  logInteractiveClickOutcome({
    kind: 'choice',
    tenantId: input.tenantId,
    conversationId: input.conversationId,
    buttonId: input.buttonId,
    outcome: partial.outcome,
    reason: partial.reason,
    outboxCount: outbox.length,
    patientOutboxCount: patientOut,
    fallbackSent: guarded.fallbackSent,
    silentPrevented: guarded.silentPrevented,
    autoBookStatus: autoBook?.status,
    proposalId: autoBook?.proposalId ?? null,
    proposalWithoutReplyText: Boolean(autoBook?.proposalId && !autoBook.replyText?.trim()),
    aiDurationMs: timing.aiDurationMs ?? null,
    durationMs: clock.nowMs() - timing.startedMs,
  })
  return {
    handled: true,
    outcome: partial.outcome,
    autoBook,
    outbox,
    reason: partial.reason,
    fallbackSent: guarded.fallbackSent,
    silentPrevented: guarded.silentPrevented,
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
  const clickStartedMs = clock.nowMs()
  const parsedChoice = parseChoiceId(input.buttonId)
  if (!parsedChoice) {
    return { handled: false, reason: 'not_choice_id' }
  }

  // DEC-142: lista Feminino/Masculino do catálogo. Não entra no autobook nem no Flow.
  if (parsedChoice.slot === 'audiencia') {
    cancelAutoDraft(db, input.tenantId, input.conversationId)
    const { handleCatalogAudienceClick } = await import('./catalog-consult')
    const click = handleCatalogAudienceClick(
      db,
      caller,
      {
        tenantId: input.tenantId,
        conversationId: input.conversationId,
        buttonId: input.buttonId,
        providerEventKey: input.providerEventKey,
        authorClerkUserId: AUTODRAFT_ACTOR_ID,
        authorDisplayName: 'IA',
      },
      clock,
    )
    return finishChoiceClick(
      db,
      caller,
      input,
      clock,
      {
        outcome: click.outcome === 'applied' ? 'applied' : 'stale_reoffered',
        outbox: click.outbox,
      },
      { startedMs: clickStartedMs },
    )
  }

  // Alterar detalhes → Horário | Serviço | Variantes (Paulo 09/11/2026).
  if (parsedChoice.slot === 'alter') {
    cancelAutoDraft(db, input.tenantId, input.conversationId)
    const validated = validateChoiceAgainstFrame(
      db,
      input.tenantId,
      input.conversationId,
      input.buttonId,
      clock.nowMs(),
    )
    if (!validated.ok) {
      // Menu stale: reabre se ainda houver serviço no quadro.
      const { beginAlterDetailsMenu } = await import('./alter-details')
      const frame = getBookingFrame(db, input.tenantId, input.conversationId)
      if (frame?.serviceId) {
        const menu = beginAlterDetailsMenu(
          db,
          caller,
          input.conversationId,
          clock,
          { providerEventKey: input.providerEventKey },
        )
        return finishChoiceClick(
          db,
          caller,
          input,
          clock,
          {
            outcome: 'stale_reoffered',
            outbox: menu.outbox,
            reason: validated.reason,
          },
          { startedMs: clickStartedMs },
        )
      }
      return finishChoiceClick(
        db,
        caller,
        input,
        clock,
        {
          outcome: 'stale_cleared',
          outbox: [],
          reason: validated.reason,
        },
        { startedMs: clickStartedMs },
      )
    }
    const key = validated.key
    if (key !== 'horario' && key !== 'servico' && key !== 'variantes') {
      return finishChoiceClick(
        db,
        caller,
        input,
        clock,
        {
          outcome: 'stale_cleared',
          outbox: [],
          reason: 'unknown_option',
        },
        { startedMs: clickStartedMs },
      )
    }
    const { handleAlterDetailsChoice } = await import('./alter-details')
    const click = await handleAlterDetailsChoice(
      db,
      caller,
      {
        tenantId: input.tenantId,
        conversationId: input.conversationId,
        key,
        providerEventKey: input.providerEventKey,
        capability: input.capability,
      },
      clock,
    )
    return finishChoiceClick(
      db,
      caller,
      input,
      clock,
      {
        outcome: 'applied',
        autoBook: click.autoBook,
        outbox: click.outbox,
      },
      { startedMs: clickStartedMs },
    )
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
    const frame = getBookingFrame(db, input.tenantId, input.conversationId)
    // Reoferta: texto mínimo com o serviço já conhecido para o funil repetir o passo.
    const services = listServices(db, input.tenantId).filter((s) => s.active)
    const svc = services.find((s) => s.id === frame?.serviceId)
    const reofferText = svc?.name?.trim() || 'quero agendar'
    const aiStartedMs = clock.nowMs()
    const autoBook = await tryAiAutoBook(db, caller, clock, {
      conversationId: input.conversationId,
      capability: input.capability !== false,
      turnTextOverride: reofferText,
      confirmationMessageIdOverride: confirmationMessageId,
    })
    const aiDurationMs = clock.nowMs() - aiStartedMs
    const book = attachClearPendingOnSend(autoBook, db, input.tenantId, input.conversationId)
    const choiceOut = await sendChoiceOutbound(
      db,
      caller,
      clock,
      input.conversationId,
      book,
      `choice-stale:${input.providerEventKey ?? clock.nowMs()}`,
      input.prepareBookingFlowOffer,
    )
    const outbox = [...book.outbox, ...choiceOut]
    return finishChoiceClick(
      db,
      caller,
      input,
      clock,
      {
        outcome: book.replyText?.trim() || book.proposalId ? 'stale_reoffered' : 'stale_cleared',
        autoBook: book,
        outbox,
        reason: validated.reason,
      },
      { startedMs: clickStartedMs, aiDurationMs },
    )
  }

  // DEC-137: toque em Opções no modo `uma` é explícito (sem eco) → Horários.
  // DEC-178: no modo `varias`, cada toque acumula e pede Mais|Pronto (sem eco longo).
  // Sim (eco) / Pronto confirmam o conjunto e pedem Horários — não marcam (DEC-061).
  // Corrigir volta às zonas.
  const frameForMode = getBookingFrame(db, input.tenantId, input.conversationId)
  const servicesForMode = listServices(db, input.tenantId).filter((s) => s.active)
  const svcForMode = servicesForMode.find((s) => s.id === frameForMode?.serviceId)
  const multiVarias = svcForMode != null && allowsMultipleVariants(svcForMode.variantSelection)

  let zoneEcho: 'skip' | 'confirm' | 'correct' | undefined
  let zoneAccum: 'pick' | 'mais' | 'pronto' | undefined
  let pickedVariantId: string | undefined

  if (validated.slot === 'variantes') {
    if (multiVarias && validated.key !== TODAS_OPTION_KEY) {
      zoneAccum = 'pick'
      pickedVariantId = validated.key
    } else if (multiVarias && validated.key === TODAS_OPTION_KEY) {
      // «Todas» na lista (se existir) fecha o conjunto como toque explícito.
      zoneEcho = 'skip'
    } else {
      zoneEcho = 'skip'
    }
  } else if (validated.slot === 'eco' && validated.key === 'sim') {
    zoneEcho = 'confirm'
  } else if (validated.slot === 'eco' && validated.key === 'corrigir') {
    zoneEcho = 'correct'
  } else if (validated.slot === 'acumular' && validated.key === ZONE_ACCUM_MAIS_KEY) {
    zoneAccum = 'mais'
  } else if (validated.slot === 'acumular' && validated.key === ZONE_ACCUM_PRONTO_KEY) {
    zoneAccum = 'pronto'
    zoneEcho = 'confirm'
  }

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
    turnText = svcForMode?.name?.trim() || 'quero agendar'
  }

  // T1 «Outro dia»: limpa date/period sticky antes de reofertar (sem wait «Sim»).
  if (validated.slot === 'periodo' && validated.key === PERIOD_DAY_OUTRO_DIA_KEY) {
    const frame = getBookingFrame(db, input.tenantId, input.conversationId)
    if (frame?.serviceId) {
      saveBookingFrame(
        db,
        input.tenantId,
        input.conversationId,
        {
          serviceId: frame.serviceId,
          date: null,
          period: null,
          pending: null,
          lastOffer: null,
          phase: 'coletando',
        },
        clock,
      )
    }
  }

  const aiStartedMs = clock.nowMs()
  const autoBook = await tryAiAutoBook(db, caller, clock, {
    conversationId: input.conversationId,
    capability: input.capability !== false,
    turnTextOverride: turnText,
    confirmationMessageIdOverride: confirmationMessageId,
    ...(boundSlot ? { boundSlot } : {}),
    ...(zoneEcho ? { zoneEcho } : {}),
    ...(zoneAccum ? { zoneAccum } : {}),
    ...(pickedVariantId ? { pickedVariantId } : {}),
  })
  const aiDurationMs = clock.nowMs() - aiStartedMs

  const book = attachClearPendingOnSend(autoBook, db, input.tenantId, input.conversationId)
  const choiceOut = await sendChoiceOutbound(
    db,
    caller,
    clock,
    input.conversationId,
    book,
    `choice:${input.providerEventKey ?? clock.nowMs()}`,
    input.prepareBookingFlowOffer,
  )
  const outbox = [...book.outbox, ...choiceOut]
  return finishChoiceClick(
    db,
    caller,
    input,
    clock,
    { outcome: 'applied', autoBook: book, outbox },
    { startedMs: clickStartedMs, aiDurationMs },
  )
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
