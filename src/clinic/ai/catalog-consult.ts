/**
 * Consulta de catálogo (DEC-142, Paulo, 06/11/2026).
 * Frase determinística do backend (DEC-104). O modelo não escreve a lista
 * nem escolhe o serviço. Não marca (DEC-061): não cria proposta nem compromisso.
 *
 * Sem audiência nesta conversa: lista interativa com Feminino e Masculino
 * (não é texto só, não são reply buttons, não é o CTA do Flow).
 * Com audiência (toque ou linha já gravada, DEC-090): texto com os nomes
 * ativos dessa audiência ou qualquer (DEC-075), como estão no cadastro.
 */
import type { Clock } from '../../db/clock'
import type { ClinicCaller } from '../envelopes'
import {
  explicitAudienceLine,
  filterServicesForLine,
  type ServiceAudience,
} from '../catalog/audience'
import { listServices } from '../config/services'
import type { ServiceRow } from '../config/types'
import { sendOutboundMessageOp } from '../inbox/operations'
import type { SendOutboundInteractiveInput } from '../inbox/types'
import type { OutboxRow } from '../outbox'
import { retireActiveProposal } from '../proposals/proposals'
import type { ClinicDb } from '../store'
import { isPendingOfferFresh } from './booking-frame-choice'
import {
  createDeferredBookingFrame,
  OUTBOUND_MESSAGE_ID_PLACEHOLDER,
} from './deferred-booking-frame'
import {
  getBookingFrame,
  type BookingFrame,
  type BookingFramePatch,
  type BookingFramePending,
  type ScheduleAudienceLine,
} from './schedule-session'
import { readCatalogVersion } from './turn-context'

/** Mesmo prefixo de `encodeChoiceId` (choice-offer). O teste trava os dois. */
const CHOICE_ID_PREFIX = 'ch1~'

export const CATALOG_AUDIENCE_LIST_BODY = 'Feminino ou masculino?'
export const CATALOG_AUDIENCE_LIST_BUTTON = 'Escolher'
export const CATALOG_AUDIENCE_ROW_FEMININO = 'Feminino'
export const CATALOG_AUDIENCE_ROW_MASCULINO = 'Masculino'

export const CATALOG_STAY_FEMININO =
  'Continuo no feminino. Para ver o masculino, diga “serviços masculinos”.'
export const CATALOG_STAY_MASCULINO =
  'Continuo no masculino. Para ver o feminino, diga “serviços femininos”.'

export type CatalogAudience = ScheduleAudienceLine

export type CatalogConsultIntent =
  | { kind: 'ask' }
  | { kind: 'switch'; line: CatalogAudience }

export type CatalogConsultAction = {
  body: string
  interactive: SendOutboundInteractiveInput | null
  framePatch: BookingFramePatch
}

const SWITCH_FEM =
  /\b(?:servicos?|ver)\s+(?:o\s+|os\s+|a\s+|as\s+)?feminin|\bfemininos\b/
const SWITCH_MASC =
  /\b(?:servicos?|ver)\s+(?:o\s+|os\s+|a\s+|as\s+)?masculin|\bmasculinos\b/

const CATALOG_ASK: readonly RegExp[] = [
  /\bquais\s+(?:sao\s+)?(?:os\s+)?(?:servicos|procedimentos|tratamentos)\b/,
  /\bque\s+(?:servicos|procedimentos|tratamentos)\b/,
  /\b(?:lista|listar|mostra|mostrar)\s+(?:os\s+|me\s+os\s+|me\s+)?(?:servicos|procedimentos|tratamentos)\b/,
  /\bver\s+(?:os\s+)?(?:servicos|procedimentos|tratamentos)\b/,
  /\b(?:servicos|procedimentos|tratamentos)\s+(?:que\s+)?(?:voce|voces)\s+(?:tem|oferece|oferecem|faz|fazem)\b/,
  /\b(?:quero|queria|prefiro)\s+(?:agendar\s+|marcar\s+)?outro\s+servico\b/,
  /\boutro\s+servico\b/,
  // B2 (Paulo 09/11/2026): «outro agendamento» = mesmo efeito DEC-142, antes do match de zona.
  // Não casa «outra sessão» (C-11) nem «outro horário/dia/período/data» (mid-funnel).
  /\b(?:quero|queria|prefiro)\s+outro\s+agendamento\b/,
  /\boutro\s+agendamento\b/,
  /\b(?:quero|queria|prefiro)\s+marcar\s+outro\b(?!\s+(?:horario|dia|periodo|data|sessao|vez)\b)/,
  /\b(?:quero|queria|prefiro)\s+marcar\s+outra\s+coisa\b/,
  /\bnova\s+marcacao\b/,
  /\b(?:quero|queria|prefiro)\s+agendar\s+de\s+novo\b/,
  /\bo que (?:voce|voces) (?:tem|oferece|oferecem)\b/,
]

function fold(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
}

export function catalogConsultIntent(text: string): CatalogConsultIntent | null {
  const folded = fold(text)
  if (!folded.trim()) return null
  const fem = SWITCH_FEM.test(folded)
  const masc = SWITCH_MASC.test(folded)
  if (fem && masc) return { kind: 'ask' }
  if (fem) return { kind: 'switch', line: 'feminino' }
  if (masc) return { kind: 'switch', line: 'masculino' }
  if (CATALOG_ASK.some((re) => re.test(folded))) return { kind: 'ask' }
  return null
}

export function encodeCatalogAudienceId(catalogVersion: string, key: CatalogAudience): string {
  const id = `${CHOICE_ID_PREFIX}${['audiencia', catalogVersion, key].map(encodeURIComponent).join('~')}`
  if (id.length > 200) throw new Error('choice_id_too_long')
  return id
}

export function parseCatalogAudienceId(
  raw: string,
): { catalogVersion: string; key: CatalogAudience } | null {
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
  if (slot !== 'audiencia' || !catalogVersion) return null
  if (key !== 'feminino' && key !== 'masculino') return null
  return { catalogVersion, key }
}

function stayCopy(line: CatalogAudience): string {
  return line === 'feminino' ? CATALOG_STAY_FEMININO : CATALOG_STAY_MASCULINO
}

export function catalogEmptyBody(line: CatalogAudience): string {
  return line === 'feminino'
    ? 'Não tenho serviços no feminino.'
    : 'Não tenho serviços no masculino.'
}

/** Rótulos como estão no cadastro, um por linha. Não é frase corrida. */
export function catalogNamesBody(names: readonly string[]): string {
  return `Temos:\n${names.join('\n')}\nQual você quer?`
}

function activeNames(services: readonly ServiceRow[], line: CatalogAudience): string[] {
  const active = services.filter((service) => service.active)
  return filterServicesForLine(
    active as Array<ServiceRow & { audiencia: ServiceAudience }>,
    line,
  )
    .map((service) => service.name.trim())
    .filter((name) => name.length > 0)
}

export function bookingInProgress(frame: BookingFrame | null, hasActiveProposal: boolean): boolean {
  if (hasActiveProposal) return true
  if (!frame) return false
  if (frame.serviceId) return true
  if (frame.variantIds && frame.variantIds.length > 0) return true
  if (frame.lastOffer || frame.proposal) return true
  if (frame.date || frame.time || frame.period) return true
  if (frame.rescheduleAppointmentId || frame.professionalPref) return true
  if (frame.pending && frame.pending.slot !== 'audiencia') return true
  return false
}

function holdPatch(
  line: CatalogAudience | null,
  pending: BookingFramePending | null,
  catalogVersion: string,
): BookingFramePatch {
  return {
    serviceId: null,
    line,
    variantIds: null,
    professionalPref: null,
    date: null,
    period: null,
    time: null,
    pending,
    lastOffer: null,
    proposal: null,
    rescheduleAppointmentId: null,
    catalogVersion,
    phase: pending ? 'coletando' : 'idle',
    source: 'regra',
  }
}

function audienceListAction(catalogVersion: string): CatalogConsultAction {
  const options: Array<{ key: CatalogAudience; label: string }> = [
    { key: 'feminino', label: CATALOG_AUDIENCE_ROW_FEMININO },
    { key: 'masculino', label: CATALOG_AUDIENCE_ROW_MASCULINO },
  ]
  const pending: BookingFramePending = {
    slot: 'audiencia',
    options: options.map((option) => ({ key: option.key, label: option.label })),
    messageId: OUTBOUND_MESSAGE_ID_PLACEHOLDER,
  }
  return {
    body: CATALOG_AUDIENCE_LIST_BODY,
    interactive: {
      list: {
        button: CATALOG_AUDIENCE_LIST_BUTTON,
        sections: [
          {
            rows: options.map((option) => ({
              id: encodeCatalogAudienceId(catalogVersion, option.key),
              title: option.label,
            })),
          },
        ],
      },
    },
    framePatch: holdPatch(null, pending, catalogVersion),
  }
}

function namesAction(
  line: CatalogAudience,
  services: readonly ServiceRow[],
  catalogVersion: string,
  sayStay: boolean,
): CatalogConsultAction {
  const names = activeNames(services, line)
  const list = names.length > 0 ? catalogNamesBody(names) : catalogEmptyBody(line)
  const body = sayStay ? `${stayCopy(line)}\n${list}` : list
  return {
    body,
    interactive: null,
    framePatch: holdPatch(line, null, catalogVersion),
  }
}

/**
 * Plano do turno, ou null se o texto não é consulta de catálogo.
 * Toque na lista entra por `handleCatalogAudienceClick`, não por aqui,
 * salvo o texto livre «feminino» / «masculino» com a lista ainda pendente.
 */
export function planCatalogConsult(input: {
  text: string
  frame: BookingFrame | null
  services: readonly ServiceRow[]
  catalogVersion: string
  hasActiveProposal: boolean
}): CatalogConsultAction | null {
  let intent = catalogConsultIntent(input.text)
  if (!intent && input.frame?.pending?.slot === 'audiencia') {
    const picked = explicitAudienceLine(input.text)
    if (picked) intent = { kind: 'switch', line: picked }
  }
  if (!intent) return null

  const known = input.frame?.line ?? null
  const inProgress = bookingInProgress(input.frame, input.hasActiveProposal)

  if (intent.kind === 'switch') {
    return namesAction(intent.line, input.services, input.catalogVersion, false)
  }
  if (known) {
    return namesAction(known, input.services, input.catalogVersion, inProgress)
  }
  return audienceListAction(input.catalogVersion)
}

export function deliverCatalogConsult(
  db: ClinicDb,
  caller: ClinicCaller,
  clock: Clock,
  input: {
    conversationId: string
    clientRequestId: string
    authorClerkUserId: string
    authorDisplayName: string
    action: CatalogConsultAction
  },
): { outbox: OutboxRow[] } {
  const deferred = createDeferredBookingFrame()
  deferred.saveFrame(input.action.framePatch)
  const persistFrame = deferred.toAfterPersist(clock)
  try {
    const sent = sendOutboundMessageOp(
      db,
      caller,
      {
        conversationId: input.conversationId,
        body: input.action.body,
        interactive: input.action.interactive,
        clientRequestId: input.clientRequestId,
        authorClerkUserId: input.authorClerkUserId,
        authorDisplayName: input.authorDisplayName,
        afterPersist: (ctx) => {
          retireActiveProposal(ctx.db, ctx.tenantId, ctx.conversationId, clock)
          return persistFrame(ctx)
        },
      },
      clock,
    )
    return { outbox: sent.outbox }
  } finally {
    deferred.discard()
  }
}

export type CatalogAudienceClickResult = {
  handled: true
  outcome: 'applied' | 'reoffered'
  outbox: OutboxRow[]
}

/**
 * Toque na lista Feminino/Masculino. Não chama o autobook nem o Flow.
 * Não marca (DEC-061).
 */
export function handleCatalogAudienceClick(
  db: ClinicDb,
  caller: ClinicCaller,
  input: {
    tenantId: string
    conversationId: string
    buttonId: string
    providerEventKey?: string | null
    authorClerkUserId: string
    authorDisplayName: string
  },
  clock: Clock,
): CatalogAudienceClickResult {
  const parsed = parseCatalogAudienceId(input.buttonId)
  const frame = getBookingFrame(db, input.tenantId, input.conversationId)
  const services = listServices(db, input.tenantId)
  const catalogVersion = frame?.catalogVersion || readCatalogVersion(db, input.tenantId)
  const fresh = audienceChoiceFresh(db, input.tenantId, frame, clock.nowMs())
  const versionOk =
    !frame?.catalogVersion ||
    !parsed ||
    parsed.catalogVersion === frame.catalogVersion
  const applied = Boolean(parsed && fresh && versionOk && frame?.pending?.slot === 'audiencia')
  const line: CatalogAudience | null = applied
    ? parsed!.key
    : (frame?.line ?? null)
  const action = line
    ? namesAction(line, services, catalogVersion, false)
    : audienceListAction(readCatalogVersion(db, input.tenantId))
  const delivered = deliverCatalogConsult(db, caller, clock, {
    conversationId: input.conversationId,
    clientRequestId: `ai-catalog-audience:${input.providerEventKey ?? clock.nowMs()}`,
    authorClerkUserId: input.authorClerkUserId,
    authorDisplayName: input.authorDisplayName,
    action,
  })
  return {
    handled: true,
    outcome: applied ? 'applied' : 'reoffered',
    outbox: delivered.outbox,
  }
}

function audienceChoiceFresh(
  db: ClinicDb,
  tenantId: string,
  frame: BookingFrame | null,
  nowMs: number,
): boolean {
  if (!frame?.pending || frame.pending.slot !== 'audiencia') return false
  const pendingMsg = db.get<{ created_at: number }>(
    `SELECT created_at FROM messages WHERE tenant_id = ? AND id = ?`,
    tenantId,
    frame.pending.messageId,
  )
  return isPendingOfferFresh(pendingMsg?.created_at ?? null, nowMs)
}
