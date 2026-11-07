/**
 * Agendamento pela IA após confirmação explícita da própria cliente
 * (decidido por Paulo, 28/10/2026 — ver DEC-006 / DEC-056 em docs/product/decisions.md).
 *
 * Regra: o backend envia a proposta quando dia, horário e procedimento ficam determinados
 * sem ambiguidade. Cada elemento vem da vez atual da cliente ou, se ela não o repetir,
 * da mensagem mais recente que cite um único valor (não só a bolha imediatamente anterior).
 * «1530» e «às 13» contam como horário. Zona já dita pela cliente numa mensagem
 * anterior conta; a lista que a clínica ofereceu não escolhe a zona. Faltou ou
 * ficou ambíguo → não envia proposta. Detecção
 * determinística, sem o modelo.
 *
 * S2 (#173, épico #171): esta leitura de texto livre NUNCA marca — só produz nota para a atendente.
 * Com a capacidade ligada (sempre, salvo pausa da owner), o backend monta e envia a proposta
 * versionada com botão WhatsApp (S3–S4). A marcação/Pix fica no clique autenticado (S5 #176 /
 * DEC-061: `executeProposalConfirmOp`). Serviço com sinal: Pix sem hold (DEC-047); horário só
 * após pagamento (#39).
 */
import type { Clock } from '../../db/clock'
import { AI_AUTOBOOK_ACTOR } from '../constants'
import { listResources } from '../config/resources'
import { listServices } from '../config/services'
import { explicitAudienceLine } from '../catalog/audience'
import {
  quoteVisit,
  readZoneSnapshots,
  resolveZoneMention,
  textNamesMixAudiences,
  variantAudiencesConflict,
  variantChoiceLabel,
  zonesNamedInText,
} from '../config/zones'
import { ensureClinicSettings } from '../config/settings'
import type { ServiceRow } from '../config/types'
import type { ClinicCaller } from '../envelopes'
import { getConversation } from '../inbox/conversations'
import type { OutboxRow } from '../outbox'
import {
  createProposal,
  getActiveProposalForConversation,
  resumeOpenProposalConfirm,
  retireActiveProposal,
  suspendOpenProposalConfirm,
} from '../proposals/proposals'
import { sendProposalToWhatsAppOp } from '../proposals/send'
import { clinicCivilDateFromUtc } from '../scheduling/timezone'
import { openPendingCommunication } from '../proposals/pending-communication'
import { TEMPO_REFUSED_PHRASE, TEMPO_UNCONFIRMED_PHRASE } from '../proposals/render'
import { queryAvailability } from '../scheduling/query'
import { queryAutomaticAvailability } from '../tempo/automatic'
import { evaluateServiceTempo, type ForecastAdapter } from '../tempo/evaluate'
import { readOpenMeteo } from '../tempo/open-meteo'
import type { ClinicDb } from '../store'
import type { AbuseLimits } from './abuse-limits'
import {
  DEFAULT_OPTION_KIND_PLURAL,
  mixedAudienceReply,
  serviceNotFoundReply,
  teamConfirmsSoonReply,
  zoneNotFoundAskReply,
} from './client-copy'
import { sayAct } from './dialogue-acts'
import { checkConversationProtection } from './protection'
import {
  catalogMissHint,
  catalogServiceList,
  resolveBookingObject,
  servicesFromBookingMatch,
} from './booking-object'
import { textCitesSynonym } from '../config/synonyms'
import { recordUnmatchedTerm } from '../config/unmatched-terms'
import {
  audienceLineFromClientTexts,
  citesServiceName,
  claimsCatalogShortcut,
  zonesChosenInClientTexts,
} from './schedule-choice'
import {
  funnelMessageFilter,
  getBookingFrame,
  heldAudienceLine,
  saveScheduleSession,
  scheduleFactsFromText,
  syncBookingFrameWithCatalog,
  wouldAskFilledSlot,
} from './schedule-session'
import { getOrCompileCatalog } from './turn-context'
import {
  audienceLineQuestion,
  needsAudienceLine,
  stableVariantLabelList,
  variantListQuestion,
  variantTipoWord,
  zonesForAudienceLine,
} from './variant-line'
import { extractDates, extractTimes, norm } from './nlu/temporal'
import { classifySensitive, hasRestartRequest } from './nlu/sensitive'
import { logPolicyShadow } from './policy-shadow'
import {
  occupiedSlotAlternativesReply,
  offerNearestSlots,
  slotListRowCopy,
  type DayPeriod,
  type OfferedSlot,
} from './slot-offer'
import {
  isPendingOfferFresh,
  matchPendingChoice,
} from './booking-frame-choice'
import {
  createDeferredBookingFrame,
  offerFramePatch,
  OUTBOUND_MESSAGE_ID_PLACEHOLDER,
  type DeferredBookingFrame,
} from './deferred-booking-frame'
import {
  attachChoiceOfferToDeferred,
  buildLineChoiceInteractive,
  buildSlotChoiceInteractive,
  buildVariantChoiceInteractive,
  buildZoneEchoInteractive,
  slotBindingFromChoice,
  zoneEchoReply,
  type ChoiceInteractive,
} from './choice-offer'

/** Acumula pending + lastOffer da oferta (CF-22); commit na TX do outbound (ADR-0015). */
function rememberOfferFrameImpl(
  deferred: DeferredBookingFrame,
  serviceId: string,
  slots: OfferedSlot[],
  professionalId: string | undefined,
  catalogVersion: string,
): ChoiceInteractive | null {
  if (slots.length === 0) return null
  const patch = offerFramePatch({
    serviceId,
    phase: 'ofertado',
    slots: slots.map((s) => ({
      startsAt: s.startsAt,
      professionalId: professionalId ?? '',
      time: s.time,
      date: s.date,
    })),
  })
  // M5 / #507: id opaco leva a chave civil (YYYY-MM-DDTHH:MM). O título não autoriza o slot.
  const built = buildSlotChoiceInteractive({
    catalogVersion,
    slots: (patch.pending?.options ?? []).map((o) => {
      const bound = slotBindingFromChoice(o.key, o.label)
      const copy = bound ? slotListRowCopy(bound.date, bound.time) : null
      return {
        key: o.key,
        label: copy?.title ?? o.label,
        ...(copy ? { description: copy.description } : {}),
      }
    }),
  })
  // Pending: chave civil + rótulo na forma única à cliente (terça 03/11 17:00).
  deferred.save({
    ...patch,
    catalogVersion,
    pending: {
      slot: 'horario',
      options: patch.pending?.options ?? built.pending.options,
      messageId: OUTBOUND_MESSAGE_ID_PLACEHOLDER,
    },
  })
  return built.interactive
}

function lineChoiceForImpl(
  deferred: DeferredBookingFrame,
  serviceId: string,
  catalogVersion: string,
): ChoiceInteractive {
  const built = buildLineChoiceInteractive(catalogVersion)
  return attachChoiceOfferToDeferred(deferred, serviceId, catalogVersion, built)
}

function variantChoiceForImpl(
  deferred: DeferredBookingFrame,
  serviceId: string,
  catalogVersion: string,
  zones: Array<{ id: string; name: string; audience?: string | null; durationMinutes: number; priceCents?: number | null }>,
): ChoiceInteractive {
  const peers = zones.map((z) => ({
    name: z.name,
    audience: (z.audience === 'feminino' || z.audience === 'masculino' || z.audience === 'ambos'
      ? z.audience
      : 'ambos') as 'feminino' | 'masculino' | 'ambos',
    durationMinutes: z.durationMinutes,
    priceCents: z.priceCents ?? null,
  }))
  const built = buildVariantChoiceInteractive({
    catalogVersion,
    zones: zones.map((z, i) => ({
      id: z.id,
      name: z.name,
      label: variantChoiceLabel(peers[i]!, peers),
    })),
  })
  return attachChoiceOfferToDeferred(deferred, serviceId, catalogVersion, built)
}

export { extractDates, extractTimes, norm }

export const AI_AUTOBOOK_ACTOR_ID = AI_AUTOBOOK_ACTOR
export const AI_AUTOBOOK_ACTOR_NAME = 'IA (agendamento automático)'

export type AutoBookStatus =
  | 'booked'
  | 'needs_info'
  | 'ambiguous'
  | 'not_confirmed'
  | 'unavailable'
  | 'requires_button'
  | 'blocked'
  | 'needs_signal'
  | 'disabled'

export type AutoBookOutcome = {
  status: AutoBookStatus
  /** Elementos em falta ou ambíguos (para a nota interna). */
  missing: Array<'dia' | 'horario' | 'procedimento'>
  confirmationMessageId: string | null
  serviceId?: string
  date?: string
  time?: string
  appointmentId?: string
  /** Proposta criada/enviada quando a capacidade está ligada (S3–S4). */
  proposalId?: string
  proposalVersion?: number
  /** Texto determinístico para o rascunho (substitui o do modelo), quando aplicável. */
  replyText?: string
  /**
   * M5 (#415) / DEC-128: botões (linha) ou lista (variantes/horários) a enviar
   * com `replyText`. Toque autentica a escolha; não marca (DEC-061).
   */
  interactive?: ChoiceInteractive | null
  notes?: string
  outbox: OutboxRow[]
  /** Frame a gravar na mesma TX do outbound (ADR-0015). */
  deferredFrame?: DeferredBookingFrame
}

const WEEKDAY_LABEL = ['', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado', 'domingo']

function weekdayOf(date: string): number {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number]
  const js = new Date(Date.UTC(y, m - 1, d)).getUTCDay()
  return js === 0 ? 7 : js
}

function significantWords(name: string): string[] {
  return norm(name)
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3)
}

/**
 * Serviços activos cujo nome inteiro (todas as palavras) aparece no texto.
 * Sem filtro de audiência aqui: «masculina»/«feminina» no nome do serviço
 * (ex.: «Depilação masculina amanhã…») não é pedido de linha da cliente.
 * O filtro de audiência fica no catálogo da IA (`buildAiContextPayload`).
 */
export function extractServices(text: string, services: ServiceRow[]): ServiceRow[] {
  const words = new Set(norm(text).split(/[^a-z0-9]+/).filter(Boolean))
  const hits = services.filter((s) => {
    const sw = significantWords(s.name)
    return sw.length > 0 && sw.every((w) => words.has(w))
  })
  // Preferência: matching exacto legado (todas as palavras). Depois, o resolver de objecto.
  if (hits.length > 0) {
    return hits.filter(
      (s) =>
        !hits.some(
          (o) =>
            o.id !== s.id
            && significantWords(o.name).length > significantWords(s.name).length
            && significantWords(s.name).every((w) => significantWords(o.name).includes(w)),
        ),
    )
  }
  const fuzzy = services.filter((s) => citesServiceName(text, s.name))
  if (fuzzy.length > 0) return fuzzy
  // #509 / DEC-110: sinónimo da ficha («depilar» → Depilação) conta como exacto.
  const bySynonym = services.filter((s) =>
    (s.synonyms ?? []).some((syn) => textCitesSynonym(text, syn)),
  )
  if (bySynonym.length > 0) return bySynonym
  // Só usa o resolver quando o catálogo traz zonas (fixtures parciais ficam no legado).
  if (!services.every((s) => Array.isArray(s.zones))) return []
  return servicesFromBookingMatch(resolveBookingObject({ text, services }), services)
}

/** Pergunta Opções quando uma zona citada não resolve (#509). */
function askUnrecognizedZone(
  mention: { leftover: string | null },
  zonePool: ServiceRow['zones'],
  fallback: string,
): string {
  const names = stableVariantLabelList(zonePool)
  if (mention.leftover) return zoneNotFoundAskReply(mention.leftover, names)
  return fallback
}

/** Nome e sinónimos do serviço não contam como sobra de zona (#509). */
function zoneMentionIgnore(service: Pick<ServiceRow, 'name' | 'synonyms'>): string[] {
  return [service.name, ...(service.synonyms ?? [])]
}

function mentionZones(
  text: string,
  zones: ServiceRow['zones'],
  service: Pick<ServiceRow, 'name' | 'synonyms'>,
) {
  return resolveZoneMention(text, zones, { ignoreWords: zoneMentionIgnore(service) })
}

const AFFIRMATIVE =
  /\b(sim|pode ser|pode marcar|pode agendar|pode|confirmo|confirmado|confirma|fechado|combinado|quero|isso|ok|okay|perfeito|beleza|blz|otimo|bora|marca|marcar|agenda|agendar|serve|fica bom|esta otimo|ta bom|ta otimo|certo)\b/
/**
 * Hesitação por expressão (#410 / CF-05). Palavras soltas («ver», «acho», «não», «outra»)
 * não bloqueiam aceite nem pedido completo; «não, 16h» é correção de horário.
 */
const HESITATION_PHRASE =
  /\b(vou ver|vou pensar|talvez|nao sei|depois eu vejo|mais tarde)\b/
const RESCHEDULE = /\b(reagend\w*|remarc\w*|desmarc\w*|cancel\w*|mudar|trocar|adiar)\b/

/** Preferência «com a Bia» quando a profissional faz o serviço (#410 / CF-20). */
function preferredProfessionalId(
  db: ClinicDb,
  tenantId: string,
  text: string,
  service: ServiceRow,
  clock: Clock,
  resources?: import('../config/types').ResourceRow[],
): string | undefined {
  const pros = (resources ?? listResources(db, tenantId, clock)).filter(
    (r) => r.kind === 'professional' && r.active && r.name.trim().length >= 2,
  )
  const mentioned = pros.filter((p) =>
    new RegExp(`\\b${p.name.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(text),
  )
  const inService = mentioned.filter((p) => service.professionalIds.includes(p.id))
  return inService.length === 1 ? inService[0]!.id : undefined
}

type Msg = { id: string; direction: string; body: string; created_at: number }

export function detectExplicitConfirmation(input: {
  clientTexts: string[]
  previousClinicText: string | null
  /** Mensagens mais antigas, da mais recente para a mais antiga, fora da vez atual. */
  historyTexts?: string[]
  clientToday: string
  clinicToday: string
  services: ServiceRow[]
}): {
  ok: boolean
  status: AutoBookStatus
  missing: Array<'dia' | 'horario' | 'procedimento'>
  date?: string
  time?: string
  service?: ServiceRow
} {
  const client = input.clientTexts.join('\n')
  const c = norm(client)
  const prev = input.previousClinicText ?? ''
  if (RESCHEDULE.test(c)) return { ok: false, status: 'not_confirmed', missing: [] }
  if (HESITATION_PHRASE.test(c.replace(/\bdepois de amanha\b/g, 'amanha'))) {
    return { ok: false, status: 'ambiguous', missing: [] }
  }

  const cDates = extractDates(client, input.clientToday)
  const cTimes = extractTimes(client)
  const cServices = extractServices(client, input.services)
  const pDates = extractDates(prev, input.clinicToday)
  const pTimes = extractTimes(prev)
  const pServices = extractServices(prev, input.services)

  const affirmative = AFFIRMATIVE.test(c)
  // «sim/pode ser…» OU horário de relógio («15h», «1530») OU dia absoluto
  // já resolvido com um serviço (oferta de período, ex. B-04 «semana que vem de manhã»).
  if (!affirmative && cTimes.size === 0 && !(cDates.size === 1 && cServices.length === 1)) {
    return { ok: false, status: 'not_confirmed', missing: [] }
  }

  const missing: Array<'dia' | 'horario' | 'procedimento'> = []
  let ambiguous = false
  const history = input.historyTexts ?? []
  const resolve = <T,>(
    own: T[],
    prior: T[],
    label: 'dia' | 'horario' | 'procedimento',
    fromText: (text: string) => T[],
  ): T | undefined => {
    if (own.length === 1) return own[0]
    if (own.length > 1) { ambiguous = true; missing.push(label); return undefined }
    if (prior.length === 1) return prior[0]
    if (prior.length > 1) { ambiguous = true; missing.push(label); return undefined }
    for (const text of history) {
      const found = fromText(text)
      if (found.length === 1) return found[0]
      if (found.length > 1) { ambiguous = true; missing.push(label); return undefined }
    }
    missing.push(label)
    return undefined
  }
  const date = resolve([...cDates], [...pDates], 'dia', (text) => [...extractDates(text, input.clinicToday)])
  const time = resolve([...cTimes], [...pTimes], 'horario', (text) => [...extractTimes(text)])
  const service = resolve(cServices, pServices, 'procedimento', (text) => extractServices(text, input.services))
  if (missing.length > 0) {
    // Devolve o que já está determinado para a oferta de período / perguntas (#408 B-04).
    return {
      ok: false,
      status: ambiguous ? 'ambiguous' : 'needs_info',
      missing,
      ...(date ? { date } : {}),
      ...(time ? { time } : {}),
      ...(service ? { service } : {}),
    }
  }
  return { ok: true, status: 'requires_button', missing: [], date, time, service }
}

/** Zona escolhida pela cliente. A mensagem da clínica que lista o cardápio não conta. */
function zonesChosenByClient(
  clientTurn: Msg[],
  older: Msg[],
  zones: ServiceRow['zones'],
  service?: Pick<ServiceRow, 'name' | 'synonyms'>,
): { zones: ServiceRow['zones']; ambiguous: boolean } {
  const texts = [
    clientTurn.map((m) => m.body).join('\n'),
    ...older.filter((m) => m.direction === 'inbound').map((m) => m.body),
  ]
  return zonesChosenInClientTexts(
    texts,
    zones,
    service ? { ignoreWords: zoneMentionIgnore(service) } : undefined,
  )
}

/**
 * Pergunta as variantes com hora já conhecida (`perguntar_variantes` + `{hora}`).
 * `phrase` legado («as zonas» / «a zona») só entra no fallback; `{tipo}` vem do kind.
 */
export function askZonesReply(
  phrase: string,
  zoneNames: string[],
  time: string,
  conversationId = '',
  variantKind?: string | null,
): string {
  const list = zoneNames.join(', ')
  const tipo =
    variantKind != null
      ? variantTipoWord(variantKind)
      : phrase.replace(/^(as|a)\s+/i, '').trim().toLocaleLowerCase('pt-BR') || 'opções'
  const fallback = `Para fechar às ${time}, me diga ${phrase}: ${list}. Pode ser mais de uma.`
  return sayAct(
    'perguntar_variantes',
    conversationId,
    { hora: time, tipo, lista: list },
    fallback,
    { requireInTemplate: ['{hora}'] },
  )
}

function dayText(date: string): string {
  const [, m, d] = date.split('-')
  return `${WEEKDAY_LABEL[weekdayOf(date)]} ${d}/${m}`
}

/** DEC-125: envio da proposta falhou. Diz que ainda não está marcado (DEC-061). */
function sendFailedText(serviceName: string, date: string, time: string): string {
  return `Não consegui enviar a confirmação de ${serviceName} na ${dayText(date)} às ${time}. Ainda não está marcado: a equipe vai te responder em seguida.`
}

function localHHMM(tz: string, ms: number): string {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(ms))
}

function signalAmountCents(svc: ServiceRow, priceCents: number | null = svc.priceCents): number | null {
  if (!svc.requiresSignal) return null
  if (svc.signalKind === 'fixed' && svc.signalFixedCents != null) return svc.signalFixedCents
  if (svc.signalKind === 'percent' && svc.signalPercent != null && priceCents != null) {
    return Math.trunc((priceCents * svc.signalPercent) / 100)
  }
  return null
}

function brl(cents: number): string {
  const v = (cents / 100).toFixed(2).split('.')
  return `R$ ${v[0]!.replace(/\B(?=(\d{3})+(?!\d))/g, '.')},${v[1]}`
}

/**
 * Tenta marcar pela IA para a conversa. Não lança: devolve o resultado.
 * Idempotente por mensagem de confirmação (clientRequestId = ai-autobook:<messageId>).
 */
export async function tryAiAutoBook(
  db: ClinicDb,
  caller: ClinicCaller,
  clock: Clock,
  input: {
    conversationId: string
    suggestionId?: string | null
    enabled?: boolean
    /**
     * Capacidade efetiva (ligada, salvo pausa da owner).
     * Texto livre nunca marca; com capacidade ligada o backend envia a proposta/botão.
     */
    capability?: boolean
    /** Limites S7 ao criar proposta (opcional). */
    abuseLimits?: AbuseLimits
    /** Previsão fictícia nos testes. Omisso = Open-Meteo. */
    forecast?: ForecastAdapter
    /** #411 TurnContext — settings, catálogo e preferência sem releitura. */
    turn?: import('./turn-context').TurnContext
    /**
     * M5 (#415): texto semântico de um toque autenticado (button/list_reply).
     * Substitui o corpo das mensagens inbound do turno para o interpretador.
     */
    turnTextOverride?: string
    /** Id da mensagem inbound do toque (confirmação / idempotência). */
    confirmationMessageIdOverride?: string
    /**
     * DEC-137. Omisso = texto livre (eco antes de Horários).
     * `skip` = toque em Opções. `confirm` = Sim do eco (abre Horários, não marca).
     * `correct` = Corrigir (volta à pergunta das zonas).
     */
    zoneEcho?: 'skip' | 'confirm' | 'correct'
    /**
     * Toque na lista Horários. Data e hora vêm do id da linha, não do título.
     * Não marca (DEC-061): só monta a proposta.
     */
    boundSlot?: { date: string; time: string }
  },
): Promise<AutoBookOutcome> {
  // M5 / DEC-133 (revisão 03/11/2026): listas e botões sempre ligados; sem env gate.
  const lineChoiceFor = lineChoiceForImpl
  const variantChoiceFor = variantChoiceForImpl
  const rememberOfferFrame = rememberOfferFrameImpl
  const tenantId = caller.tenantId
  const deferred = createDeferredBookingFrame()
  const catalog =
    input.turn?.catalog ?? getOrCompileCatalog(db, tenantId, clock)
  const saveSession = (patch: Parameters<typeof saveScheduleSession>[3]) => {
    deferred.save({
      ...patch,
      catalogVersion: patch.catalogVersion ?? catalog.version,
    })
  }
  const finish = (outcome: AutoBookOutcome): AutoBookOutcome => {
    if (!deferred.hasWork) return outcome
    const willSend =
      Boolean(outcome.replyText?.trim()) || Boolean(outcome.proposalId)
    if (willSend) {
      return { ...outcome, deferredFrame: deferred }
    }
    // Sem resposta à cliente: persiste o frame e devolve o outbox para fanout WS (#472).
    const flushed = deferred.flushNow(db, tenantId, input.conversationId, clock)
    return {
      ...outcome,
      outbox: [...outcome.outbox, ...flushed],
    }
  }
  const none = (status: AutoBookStatus, extra: Partial<AutoBookOutcome> = {}): AutoBookOutcome => ({
    status,
    missing: [],
    confirmationMessageId: null,
    outbox: [],
    ...extra,
  })
  if (input.enabled === false) return finish(none('disabled'))
  // Proteção (#182): contato bloqueado ou conversa em pausa → nenhuma ação nova.
  const guard = checkConversationProtection(db, tenantId, input.conversationId)
  if (!guard.allowed) return finish(none('blocked', { notes: `Ação automática negada (${guard.reason}).` }))
  const conv = getConversation(db, tenantId, input.conversationId)
  if (!conv) return finish(none('not_confirmed'))
  const settings = input.turn?.settings ?? ensureClinicSettings(db, tenantId, clock)
  const tz = settings.timezone || 'America/Sao_Paulo'

  const recent = input.turn
    ? [...input.turn.messages]
        .filter((m) => m.direction === 'inbound' || m.direction === 'outbound')
        .reverse()
        .slice(0, 20)
        .map(
          (m): Msg => ({
            id: m.id,
            direction: m.direction,
            body: m.body,
            created_at: m.createdAt,
          }),
        )
    : db.all<Msg>(
        `SELECT id, direction, body, created_at FROM messages
       WHERE tenant_id = ? AND conversation_id = ? AND direction IN ('inbound', 'outbound')
       ORDER BY created_at DESC, id DESC LIMIT 20`,
        tenantId,
        input.conversationId,
      )
  const clientTurn: Msg[] = []
  let prevClinic: Msg | null = null
  const older: Msg[] = []
  // Flow nfm two-phase (#556): C16 ack is outbound *before* tryAiAutoBook.
  // Without this, "clinic spoke last" → not_confirmed → C16b (fumo 04/11/2026).
  const syntheticTurn = Boolean(input.turnTextOverride?.trim() || input.boundSlot)
  for (const m of recent) {
    if (!prevClinic) {
      if (m.direction === 'inbound') {
        clientTurn.push(m)
      } else if (clientTurn.length > 0) {
        prevClinic = m
      } else if (syntheticTurn) {
        // Skip leading outbound (C16 / typing residue) until the client action.
        continue
      } else {
        return finish(none('not_confirmed')) // a clínica falou por último
      }
    } else {
      older.push(m)
    }
  }
  if (clientTurn.length === 0 && !input.turnTextOverride?.trim()) {
    return finish(none('not_confirmed'))
  }
  clientTurn.reverse()
  const confirmation = clientTurn[clientTurn.length - 1] ?? {
    id: input.confirmationMessageIdOverride ?? `override:${clock.nowMs()}`,
    direction: 'inbound' as const,
    body: input.turnTextOverride ?? '',
    created_at: clock.nowMs(),
  }

  const services = input.turn?.catalog.services ?? listServices(db, tenantId).filter((s) => s.active)
  const turnText = input.turnTextOverride?.trim()
    ? input.turnTextOverride.trim()
    : clientTurn.map((m) => m.body).join('\n')

  // ADR-0015 / #472: revalidar ids se catalogVersion divergir (também sem TurnContext).
  syncBookingFrameWithCatalog(
    db,
    tenantId,
    input.conversationId,
    {
      version: catalog.version,
      serviceIds: new Set(catalog.services.map((s) => s.id)),
      variantIds: new Set(catalog.services.flatMap((s) => s.zones.map((z) => z.id))),
      professionalIds: new Set(
        catalog.resources.filter((r) => r.kind === 'professional').map((r) => r.id),
      ),
    },
    clock,
  )

  // CF-28 / #508 / DEC-138 practice 5: restart phrases clear the booking frame
  // and retire any open proposal without confirming (DEC-061). Reply = perguntar_servico.
  if (hasRestartRequest(classifySensitive(turnText))) {
    deferred.clearSession()
    retireActiveProposal(db, tenantId, input.conversationId, clock)
    const names = services.map((s) => s.name.trim()).filter((n) => n.length > 0)
    const lista = names.join(', ')
    const replyText =
      names.length >= 2
        ? sayAct(
            'perguntar_servico',
            input.conversationId,
            { lista },
            `Qual serviço você quer? Temos ${lista}.`,
          )
        : sayAct(
            'perguntar_servico',
            input.conversationId,
            {},
            'Qual serviço você gostaria de agendar?',
          )
    return finish({
      ...none('needs_info', { confirmationMessageId: confirmation.id }),
      replyText,
      notes: 'CF-28/#508: restart clears schedule_sessions; open proposal retired.',
    })
  }

  // ADR-0015 / DEC-127: ler primeiro contra pending.options (cutover fechado — #472).
  const frameEarly = getBookingFrame(db, tenantId, input.conversationId)
  let zoneEcho = input.zoneEcho
  if (frameEarly?.pending?.slot === 'eco' && !zoneEcho) {
    const echoed = norm(turnText).replace(/[^a-z0-9]+/g, ' ').trim()
    if (echoed === 'sim' || echoed === 'certo') zoneEcho = 'confirm'
    else if (echoed === 'corrigir') zoneEcho = 'correct'
  }
  if (zoneEcho === 'correct') {
    resumeOpenProposalConfirm(db, tenantId, input.conversationId, clock)
  }
  const presentZoneEcho = (
    serviceId: string,
    zones: ServiceRow['zones'],
  ): { replyText: string; interactive: ChoiceInteractive } | null => {
    if (zoneEcho === 'skip' || zoneEcho === 'confirm' || zoneEcho === 'correct') return null
    if (zones.length === 0) return null
    const open = getActiveProposalForConversation(db, tenantId, input.conversationId, clock)
    if (open) {
      const prevIds = readZoneSnapshots(db, tenantId, 'proposal', open.id)
        .map((zone) => zone.zoneId)
        .filter((id): id is string => Boolean(id))
        .sort()
      const nextIds = zones.map((zone) => zone.id).sort()
      if (prevIds.join('\0') !== nextIds.join('\0')) {
        suspendOpenProposalConfirm(db, tenantId, input.conversationId, clock)
      }
    }
    const built = buildZoneEchoInteractive(catalog.version)
    return {
      replyText: zoneEchoReply(zones),
      interactive: attachChoiceOfferToDeferred(deferred, serviceId, catalog.version, built),
    }
  }
  let pendingTimeOverride: string | null = null
  let pendingDateOverride: string | null = null
  if (frameEarly?.pending) {
    const pendingMsg = db.get<{ created_at: number }>(
      `SELECT created_at FROM messages WHERE tenant_id = ? AND id = ?`,
      tenantId,
      frameEarly.pending.messageId,
    )
    const fresh = isPendingOfferFresh(pendingMsg?.created_at ?? null, clock.nowMs())
    if (!fresh) {
      if (frameEarly.serviceId) {
        saveSession({
          serviceId: frameEarly.serviceId,
          pending: null,
          lastOffer: null,
          phase: 'coletando',
        })
      }
    } else if (frameEarly.pending.slot !== 'eco' && frameEarly.pending.slot !== 'audiencia') {
      // DEC-137: Sim/Corrigir do eco não são escolha de horário (DEC-127).
      const choice = matchPendingChoice(turnText, frameEarly.pending)
      if (choice.kind === 'match') {
        if (frameEarly.pending.slot === 'horario') {
          const bound = slotBindingFromChoice(choice.key, choice.label)
          pendingTimeOverride = bound?.time ?? choice.key.match(/\d{2}:\d{2}/)?.[0] ?? null
          pendingDateOverride = bound?.date ?? frameEarly.date
        } else if (frameEarly.pending.slot === 'linha' && frameEarly.serviceId) {
          // Texto livre contra pending de linha (DEC-128: atalho, não obrigação).
          saveSession({
            serviceId: frameEarly.serviceId,
            audienceLine: choice.key === 'masculino' ? 'masculino' : 'feminino',
            pending: null,
            phase: 'coletando',
          })
        } else if (frameEarly.pending.slot === 'variantes' && frameEarly.serviceId) {
          const svcPending = services.find((s) => s.id === frameEarly.serviceId)
          const active = svcPending?.zones.filter((z) => z.active) ?? []
          const scoped = zonesForAudienceLine(
            active,
            frameEarly.line,
          )
          const ids =
            choice.key === 'todas'
              ? scoped.map((z) => z.id)
              : [choice.key]
          saveSession({
            serviceId: frameEarly.serviceId,
            variantIds: ids,
            pending: null,
            phase: 'coletando',
          })
        } else {
          pendingTimeOverride = choice.key.match(/\d{2}:\d{2}/)?.[0] ?? null
          const dateFromLabel = choice.label.match(/\d{4}-\d{2}-\d{2}/)?.[0]
          pendingDateOverride = dateFromLabel ?? frameEarly.date
        }
      } else if (choice.kind === 'ask_which' || choice.kind === 'ambiguous') {
        // Catálogo perguntar_horario (#448): fallback alinhado à allowlist; sem frase nova.
        const svc =
          services.find((s) => s.id === frameEarly.serviceId) ?? { name: 'o horário' }
        return finish({
          ...none('needs_info', {
            confirmationMessageId: confirmation.id,
            serviceId: frameEarly.serviceId ?? undefined,
          }),
          replyText: sayAct(
            'perguntar_horario',
            input.conversationId,
            { serviço: svc.name },
            `Qual horário fica melhor para ${svc.name}?`,
          ),
          notes: 'DEC-127: resposta ambígua/👍 com várias opções — pergunta de volta sem escolher.',
        })
      }
    }
  }

  // CF-23 (#436): a cliente muda de serviço com uma proposta aberta («na verdade prefiro
  // massagem»). A proposta antiga deixa de valer já (DEC-061); sem dia nem hora novos, o
  // dia e a hora que ela tinha escolhido passam para o serviço novo e o backend monta a
  // proposta nova (ou as alternativas, ou a pergunta das zonas) pelo caminho de sempre.
  let swap: { service: ServiceRow; date: string; time: string } | null = null
  const openProposal = getActiveProposalForConversation(db, tenantId, input.conversationId, clock)
  if (openProposal && !RESCHEDULE.test(norm(turnText))) {
    const named = extractServices(turnText, services)
    if (named.length === 1 && named[0]!.id !== openProposal.serviceId) {
      retireActiveProposal(db, tenantId, input.conversationId, clock)
      const turnDay = clinicCivilDateFromUtc(tz, confirmation.created_at)
      if (extractDates(turnText, turnDay).size === 0 && extractTimes(turnText).size === 0) {
        swap = {
          service: named[0]!,
          date: clinicCivilDateFromUtc(tz, openProposal.startsAt),
          time: localHHMM(tz, openProposal.startsAt),
        }
        saveSession({ serviceId: swap.service.id, clockTime: swap.time, date: swap.date })
      }
    }
  }
  let det = detectExplicitConfirmation({
    clientTexts: clientTurn.map((m) => m.body),
    previousClinicText: prevClinic?.body ?? null,
    historyTexts: older.map((m) => m.body),
    clientToday: clinicCivilDateFromUtc(tz, confirmation.created_at),
    clinicToday: clinicCivilDateFromUtc(tz, prevClinic?.created_at ?? confirmation.created_at),
    services,
  })
  // Sessão: overlay do turno (ADR-0015) ou DB se ainda não houve patch.
  const session = deferred.peekSession(db, tenantId, input.conversationId)
  const frame = deferred.peekFrame(db, tenantId, input.conversationId)
  let date = det.date
  let missing = [...det.missing]
  if (swap) {
    det = { ok: true, status: 'requires_button', missing: [], date: swap.date, time: swap.time, service: swap.service }
    date = swap.date
    missing = []
  }
  // CF-21 / ADR-0015: data absoluta do frame (day_label órfã — não autoriza, #472).
  if (!date && frame?.date && (!det.service || frame.serviceId === det.service.id)) {
    date = frame.date
    missing = missing.filter((item) => item !== 'dia')
  }
  const turnFacts = scheduleFactsFromText(turnText)
  const rememberDayPeriod = (serviceId: string) => {
    if (!turnFacts.dayLabel && !turnFacts.period) return
    const today = clinicCivilDateFromUtc(tz, confirmation.created_at)
    const absolute =
      turnFacts.dayLabel != null
        ? [...extractDates(turnFacts.dayLabel, today)][0] ?? null
        : undefined
    // Novo dia/período invalida pending/lastOffer anteriores (nova oferta a seguir).
    // day_label deixa de ser gravado (#472 cutover); só date/period absolutos.
    saveSession({
      serviceId,
      ...(turnFacts.period ? { period: turnFacts.period } : {}),
      ...(absolute !== undefined ? { date: absolute } : {}),
      pending: null,
      lastOffer: null,
    })
  }
  if (pendingTimeOverride) {
    const pendingSvc =
      det.service ??
      (frame?.serviceId ? services.find((s) => s.id === frame.serviceId) : undefined)
    if (pendingSvc) {
      det = {
        ...det,
        ok: true,
        status: 'requires_button',
        time: pendingTimeOverride,
        date: pendingDateOverride ?? det.date ?? frame?.date ?? undefined,
        missing: [],
        service: pendingSvc,
      }
      date = det.date
      missing = []
    }
  }
  const base = { confirmationMessageId: confirmation.id, missing }
  const clockFromTurn = (() => {
    const times = [...extractTimes(turnText)]
    return times.length === 1 ? times[0]! : null
  })()
  if (!det.service && session?.serviceId) {
    const stored = services.find((item) => item.id === session.serviceId)
    // «amanhã» / «na parte da manhã» não repetem o serviço. A sessão já o tem (CF-19 / A-02).
    // M5 / A-03: toque «Feminina»/«Masculina» (ou texto equivalente) continua o mesmo serviço.
    const dayContinues = Boolean(turnFacts.dayLabel) && !clockFromTurn
    const periodContinues =
      Boolean(turnFacts.period) &&
      !clockFromTurn &&
      Boolean(session.variantIds?.length || !stored?.zones.some((z) => z.active))
    const lineContinues = Boolean(explicitAudienceLine(turnText))
    const storedActive = stored?.zones.filter((zone) => zone.active) ?? []
    const storedPool =
      stored && needsAudienceLine(storedActive) && session.audienceLine
        ? zonesForAudienceLine(storedActive, session.audienceLine)
        : storedActive
    const namedNow =
      (stored != null &&
        zonesNamedInText(turnText, storedActive, {
          ignoreWords: zoneMentionIgnore(stored),
        }).length > 0) ||
      (stored != null && mentionZones(turnText, storedPool, stored).zones.length > 0)
    // «as duas» / «tudo»: atalho do âmbito — continua o serviço (#509 review).
    const catalogShortcutNow = claimsCatalogShortcut(turnText)
    // Sim/Corrigir do eco não repetem o serviço. A sessão já o tem.
    const echoContinues = zoneEcho === 'confirm' || zoneEcho === 'correct'
    if (
      stored &&
      (clockFromTurn ||
        namedNow ||
        catalogShortcutNow ||
        dayContinues ||
        periodContinues ||
        lineContinues ||
        echoContinues)
    ) {
      det = {
        ...det,
        service: stored,
        status: det.status === 'not_confirmed' ? 'needs_info' : det.status,
      }
      missing = missing.filter((item) => item !== 'procedimento')
      if (!date) {
        const fromTurn = [...extractDates(turnText, clinicCivilDateFromUtc(tz, confirmation.created_at))]
        if (fromTurn.length === 1) {
          date = fromTurn[0]
          missing = missing.filter((item) => item !== 'dia')
        }
      }
      if (!missing.includes('horario') && !det.time) missing = [...missing, 'horario']
    }
  }
  if (input.boundSlot) {
    const pendingSvc =
      det.service ??
      (session?.serviceId ? services.find((s) => s.id === session.serviceId) : undefined) ??
      (frame?.serviceId ? services.find((s) => s.id === frame.serviceId) : undefined)
    if (pendingSvc) {
      det = {
        ...det,
        ok: true,
        status: 'requires_button',
        time: input.boundSlot.time,
        date: input.boundSlot.date,
        missing: [],
        service: pendingSvc,
      }
      date = input.boundSlot.date
      missing = []
    }
  }
  let time = det.time
  if (!time && det.service && session?.serviceId === det.service.id && session.clockTime) {
    time = session.clockTime
    missing = missing.filter((item) => item !== 'horario')
  }
  if (!time && clockFromTurn) time = clockFromTurn
  // Hora pedida sem dia no quadro: o dia é o da proposta aberta, para a vaga
  // ser conferida sem gravar a hora nova (#577).
  if (!date && clockFromTurn && openProposal && det.service?.id === openProposal.serviceId) {
    date = clinicCivilDateFromUtc(tz, openProposal.startsAt)
    missing = missing.filter((item) => item !== 'dia')
  }
  // Sim do eco de substituição: fecha o conjunto e segue para proposta nova
  // no dia e na hora da proposta suspensa (#576). Sim não marca.
  if (zoneEcho === 'confirm' && openProposal && det.service?.id === openProposal.serviceId) {
    if (!date) date = clinicCivilDateFromUtc(tz, openProposal.startsAt)
    if (!time) time = localHHMM(tz, openProposal.startsAt)
    missing = missing.filter((item) => item !== 'dia' && item !== 'horario')
    det = {
      ...det,
      ok: true,
      status: 'requires_button',
      date,
      time,
      missing: [],
      service: det.service,
    }
  }
  const ready =
    Boolean(det.service && date && time) &&
    (det.ok || (det.status === 'needs_info' && missing.length === 0))
  if (!ready || !det.service || !date || !time) {
    let replyText: string | undefined
    if (det.service) {
      const active = det.service.zones.filter((z) => z.active)
      const turnExplicit = explicitAudienceLine(turnText)
      // #510: linha do quadro primeiro — não repergunta género se já está preenchida.
      const frameLine =
        frame?.serviceId === det.service.id
          ? (frame.line ?? null)
          : session?.serviceId === det.service.id
            ? session.audienceLine
            : heldAudienceLine(frame)
      const line = needsAudienceLine(active) ? (turnExplicit ?? frameLine) : null
      const pool = needsAudienceLine(active) && line ? zonesForAudienceLine(active, line) : active
      const mentionPool = pool.length > 0 ? pool : active
      const sessionIds =
        session?.serviceId === det.service.id && session.variantIds?.length ? session.variantIds : []
      const sessionZones = mentionPool.filter((z) => sessionIds.includes(z.id))
      const sessionIntact = sessionIds.length > 0 && sessionZones.length === sessionIds.length
      const turnMention = mentionZones(turnText, mentionPool, det.service)
      // #510: Sim do eco ou quadro intacto sem menção nova → sem segundo parser.
      // Toque Opções (skip) com nomes no turnText continua a parsear.
      const frameOwnsVariants =
        zoneEcho === 'confirm' ||
        (sessionIntact &&
          zoneEcho !== 'correct' &&
          turnMention.zones.length === 0 &&
          !turnMention.unrecognized)
      const mention = frameOwnsVariants
        ? {
            zones: [] as typeof sessionZones,
            unrecognized: false,
            approx: false,
            leftover: null as string | null,
          }
        : turnMention
      let chosen = frameOwnsVariants
        ? { zones: sessionIntact ? sessionZones : [], ambiguous: false }
        : zonesChosenByClient(clientTurn, older, mentionPool, det.service)
      let kept = chosen.zones
      const leftoverAsk =
        mention.unrecognized && zoneEcho !== 'skip' && zoneEcho !== 'confirm' && zoneEcho !== 'correct'
      if (zoneEcho === 'correct') {
        // Corrigir não reaproveita o conjunto anterior.
        kept = []
        chosen = { zones: [], ambiguous: false }
      } else if (zoneEcho === 'confirm' || (frameOwnsVariants && sessionIntact)) {
        // DEC-137 / #510: o eco ou o quadro já resolveram. Sem segundo parser.
        kept = sessionIntact ? sessionZones : []
        chosen = { zones: kept, ambiguous: false }
      } else if (mention.zones.length > 0) {
        // Inclui skip: o label do toque (ou o texto) fecha o conjunto; o eco
        // continua desligado por zoneEcho !== 'skip' mais abaixo.
        const seen = new Set<string>()
        const ambiguous = mention.zones.some((zone) => {
          const key = zone.name.trim().toLocaleLowerCase('pt-BR')
          if (seen.has(key)) return true
          seen.add(key)
          return false
        })
        chosen = { zones: mention.zones, ambiguous }
        kept = ambiguous ? [] : mention.zones
      } else if (kept.length === 0 && !chosen.ambiguous && sessionIntact) {
        kept = sessionZones
        chosen = { zones: sessionZones, ambiguous: false }
      }
      const clearVariants = zoneEcho === 'correct'
      saveSession({
        serviceId: det.service.id,
        ...(turnExplicit || frameLine ? { audienceLine: turnExplicit ?? frameLine } : {}),
        ...(turnFacts.period ? { period: turnFacts.period } : {}),
        ...(clockFromTurn ? { clockTime: clockFromTurn } : {}),
        ...(clearVariants
          ? { variantIds: null }
          : kept.length > 0 && !chosen.ambiguous
            ? { variantIds: kept.map((z) => z.id) }
            : {}),
      })
      const serviceIgnore = { ignoreWords: zoneMentionIgnore(det.service) }
      const contributed =
        Boolean(clockFromTurn) ||
        zonesNamedInText(turnText, pool.length > 0 ? pool : active, serviceIgnore).length > 0 ||
        zoneEcho === 'confirm' ||
        Boolean(input.boundSlot)
      if (!(date && time && kept.length > 0 && !chosen.ambiguous && contributed)) {
        const plural = det.service.variantKindPlural?.trim() || ''
        const singular = det.service.variantKind?.trim() || ''
        const kindLabel = (plural || singular || DEFAULT_OPTION_KIND_PLURAL).toLocaleLowerCase('pt-BR')
        const earlyPhrase = plural || !singular ? `as ${kindLabel}` : `a ${kindLabel}`
        // Mesmo filtro da Opções (#497 / DEC-079): com linha travada, não casar
        // homónimos F+M no catálogo completo — senão «Axila e pernas» após Feminina
        // dispara recusar_mistura em falso.
        const cited = zonesNamedInText(turnText, pool, serviceIgnore)
        let interactive: ChoiceInteractive | null = null
        const frameForAsk = deferred.peekFrame(db, tenantId, input.conversationId)
        if (textNamesMixAudiences(turnText, cited)) {
          replyText = mixedAudienceReply(input.conversationId)
        } else if (
          needsAudienceLine(active) &&
          !line &&
          !(frameForAsk && wouldAskFilledSlot(frameForAsk, 'line'))
        ) {
          // #510 prática 6: uma pergunta só pelo campo que falta.
          replyText = audienceLineQuestion(det.service.name, input.conversationId)
          interactive = lineChoiceFor(deferred, det.service.id, catalog.version)
        } else if (active.length > 0 && (leftoverAsk || kept.length === 0 || chosen.ambiguous)) {
          const zonePool = pool.length > 0 ? pool : active
          const names = stableVariantLabelList(zonePool)
          const kind = det.service.variantKindPlural || det.service.variantKind
          const genericAsk = time
            ? askZonesReply(earlyPhrase, names, time, input.conversationId, kind)
            : variantListQuestion(
                det.service.name,
                kind,
                zonePool,
                input.conversationId,
              )
          replyText = mention.unrecognized
            ? askUnrecognizedZone(mention, zonePool, genericAsk)
            : genericAsk
          interactive = variantChoiceFor(
            deferred,
            det.service.id,
            catalog.version,
            zonePool.map((z) => ({
              id: z.id,
              name: z.name,
              audience: z.audience,
              durationMinutes: z.durationMinutes,
              priceCents: z.priceCents,
            })),
          )
        } else if (!time) {
          const period =
            turnFacts.period ?? (session?.serviceId === det.service.id ? session?.period : null)
          // Serviço sem variantes (ex. massagem): oferta de período com a data absoluta (#408 B-04).
          // CF-19 (#413): com serviço (e variantes) conhecidos, oferecer 2–3 horários reais
          // mesmo sem período — não perguntar «qual horário?» vazio.
          const canOffer =
            !chosen.ambiguous && (kept.length > 0 || active.length === 0)
          // DEC-137: zonas escritas num texto ainda não ecoado também pedem eco, mesmo quando o
          // texto é anterior a este turno (zonas ditas antes da linha, DEC-143).
          const turnNamed =
            mention.zones.length > 0 ||
            zonesChosenInClientTexts([turnText], mentionPool, serviceIgnore).zones.length > 0 ||
            (kept.length > 0 && !sessionIntact)
          const wantEcho =
            canOffer &&
            zoneEcho !== 'skip' &&
            zoneEcho !== 'confirm' &&
            turnNamed
          if (wantEcho) {
            // DEC-137: texto livre ecoa o conjunto. Sim é que abre Horários.
            const echoed = presentZoneEcho(det.service.id, kept)
            if (echoed) {
              replyText = echoed.replyText
              interactive = echoed.interactive
            }
          } else if (canOffer) {
            const preferred = preferredProfessionalId(
              db,
              tenantId,
              [turnText, ...older.map((m) => m.body)].join('\n'),
              det.service,
              clock,
              input.turn?.catalog.resources,
            )
            const offered = await offerNearestSlots({
              db,
              tenantId,
              service: det.service,
              zones: kept,
              tz,
              clock,
              forecast: input.forecast,
              professionalId: preferred,
              date: date ?? null,
              period: (period as DayPeriod | null) ?? null,
              limit: 3,
              conversationId: input.conversationId,
            })
            logPolicyShadow({
              tenantId,
              conversationId: input.conversationId,
              phase: 'cf19',
              current: period
                ? { action: 'offer_slots', detail: 'period' }
                : { action: 'ask_empty_time' },
              proposed: { action: 'offer_slots', detail: period ? 'period' : date ? 'date' : 'soonest' },
            })
            interactive = rememberOfferFrame(
              deferred,
              det.service.id,
              offered.slots,
              preferred,
              catalog.version,
            )
            replyText = offered.replyText
          } else {
            const fb = `Qual horário fica melhor para ${det.service.name}?`
            replyText = sayAct(
              'perguntar_horario',
              input.conversationId,
              { serviço: det.service.name },
              fb,
            )
          }
        } else if (
          !date &&
          !(frameForAsk && wouldAskFilledSlot(frameForAsk, 'date'))
        ) {
          const previousIds = sessionZones.map((zone) => zone.id).sort().join('\0')
          const nextIds = kept.map((zone) => zone.id).sort().join('\0')
          const substitution =
            !clockFromTurn &&
            kept.length > 0 &&
            !chosen.ambiguous &&
            !mention.unrecognized &&
            previousIds !== nextIds &&
            (mention.zones.length > 0 ||
              zonesChosenInClientTexts([turnText], mentionPool, serviceIgnore).zones.length > 0)
          if (
            substitution &&
            zoneEcho !== 'skip' &&
            zoneEcho !== 'confirm' &&
            zoneEcho !== 'correct'
          ) {
            // Hora já escolhida e data ainda fora do quadro: o eco da troca
            // vem antes da pergunta do dia (#576).
            const echoed = presentZoneEcho(det.service.id, kept)
            if (echoed) {
              replyText = echoed.replyText
              interactive = echoed.interactive
            }
          }
          if (!replyText) {
            // DEC-127.4 / DEC-122 / #510: só pergunta o dia se o quadro ainda não o tem.
            // Fallback allowlist (#448): catálogo emite «Para {serviço}, qual dia fica melhor?».
            const fb = `Me diga o dia para ${det.service.name}.`
            replyText = sayAct(
              'perguntar_dia',
              input.conversationId,
              { serviço: det.service.name },
              fb,
            )
          }
        }
        const faltam = missing.length ? missing.join(', ') : 'confirmação clara'
        return finish({
          ...none(det.status, base),
          ...(replyText ? { replyText } : {}),
          ...(interactive ? { interactive } : {}),
          notes:
            det.status === 'needs_info' || det.status === 'ambiguous'
              ? `Agendamento pela IA não feito: falta/ambíguo (${faltam}). Confirme com a cliente dia, horário e procedimento.`
              : undefined,
        })
      }
    } else {
      const booking = resolveBookingObject({
        text: turnText,
        services,
        session: session
          ? {
              serviceId: session.serviceId,
              audienceLine: session.audienceLine,
              variantIds: session.variantIds,
            }
          : null,
        conversationId: input.conversationId,
      })
      let replyText: string | undefined
      let interactive: ChoiceInteractive | null = null
      if (booking.kind === 'handoff') {
        if (booking.handoffReason === 'terceiro') {
          // Allowlist (#448 / leva 3): fora do catálogo até decisão DEC-083 / #402.
          replyText =
            'Para agendar para outra pessoa, a equipe precisa continuar este atendimento.'
        } else if (booking.handoffReason === 'multiplos_servicos') {
          const fb = 'Neste momento marcamos um serviço de cada vez. Qual você quer primeiro?'
          replyText = sayAct('varios_servicos', input.conversationId, {}, fb)
        } else if (booking.handoffReason === 'inexistente') {
          const pedido = catalogMissHint(turnText, services)
          // DEC-141: o termo (só ele) vira sugestão de sinónimo para a owner.
          recordUnmatchedTerm(db, tenantId, pedido, clock)
          replyText = serviceNotFoundReply(input.conversationId, {
            pedido,
            lista: catalogServiceList(services),
          })
        } else if (booking.handoffReason === 'historico_indisponivel') {
          const fb = 'Não tenho o detalhe da sua visita anterior aqui. Qual serviço você quer agora?'
          replyText = sayAct('historico_indisponivel', input.conversationId, {}, fb)
        }
      } else if (booking.kind === 'clarify' && booking.question && !booking.serviceId) {
        replyText = booking.question
      } else if (
        (booking.kind === 'selected' || booking.kind === 'clarify') &&
        booking.serviceId
      ) {
        // A-06 / F-08: serviço resolvido sem confirmação «clássica» → oferta proativa (#413).
        const svc = services.find((s) => s.id === booking.serviceId)
        if (svc) {
          const active = svc.zones.filter((z) => z.active)
          // DEC-128 / A-03 / #510: linha do quadro primeiro (não misturar F/M).
          const turnExplicit = explicitAudienceLine(turnText)
          const frameLine =
            frame?.serviceId === svc.id
              ? (frame.line ?? null)
              : session?.serviceId === svc.id
                ? session.audienceLine
                : heldAudienceLine(frame)
          const line = needsAudienceLine(active) ? (turnExplicit ?? frameLine) : null
          const zonePool =
            needsAudienceLine(active) && line ? zonesForAudienceLine(active, line) : active
          if (zoneEcho === 'correct') {
            saveSession({ serviceId: svc.id, variantIds: null, ...(line ? { audienceLine: line } : {}) })
            const zoneNames = zonePool.length > 0 ? zonePool : active
            replyText = variantListQuestion(
              svc.name,
              svc.variantKindPlural || svc.variantKind,
              zoneNames,
              input.conversationId,
            )
            interactive = variantChoiceFor(
              deferred,
              svc.id,
              catalog.version,
              zoneNames.map((z) => ({
                id: z.id,
                name: z.name,
                audience: z.audience,
                durationMinutes: z.durationMinutes,
                priceCents: z.priceCents,
              })),
            )
          } else {
          const echoedIds =
            zoneEcho === 'confirm' && session?.serviceId === svc.id && session.variantIds?.length
              ? session.variantIds
              : null
          const kept =
            echoedIds && zonePool.filter((z) => echoedIds.includes(z.id)).length === echoedIds.length
              ? zonePool.filter((z) => echoedIds.includes(z.id))
              : booking.variantIds.length > 0
                ? active.filter((z) => booking.variantIds.includes(z.id))
                : []
          saveSession({
            serviceId: svc.id,
            ...(line ? { audienceLine: line } : {}),
            ...(kept.length > 0 ? { variantIds: kept.map((z) => z.id) } : {}),
            ...(turnFacts.period ? { period: turnFacts.period } : {}),
          })
          if (
            booking.missing.includes('linha') &&
            needsAudienceLine(active) &&
            !line &&
            !(frame && wouldAskFilledSlot(frame, 'line'))
          ) {
            replyText = booking.question ?? audienceLineQuestion(svc.name, input.conversationId)
            interactive = lineChoiceFor(deferred, svc.id, catalog.version)
          } else if (zonePool.length > 0 && kept.length === 0) {
            replyText =
              booking.question ??
              variantListQuestion(
                svc.name,
                svc.variantKindPlural || svc.variantKind,
                zonePool,
                input.conversationId,
              )
            interactive = variantChoiceFor(
              deferred,
              svc.id,
              catalog.version,
              zonePool.map((z) => ({
                id: z.id,
                name: z.name,
                audience: z.audience,
                durationMinutes: z.durationMinutes,
                priceCents: z.priceCents,
              })),
            )
          } else {
            const mention = mentionZones(turnText, zonePool, svc)
            const turnPicked =
              mention.zones.length > 0 ||
              zonesChosenInClientTexts([turnText], zonePool, {
                ignoreWords: zoneMentionIgnore(svc),
              }).zones.length > 0
            if (mention.unrecognized && zoneEcho !== 'skip' && zoneEcho !== 'confirm') {
              replyText = askUnrecognizedZone(
                mention,
                zonePool,
                variantListQuestion(
                  svc.name,
                  svc.variantKindPlural || svc.variantKind,
                  zonePool,
                  input.conversationId,
                ),
              )
              interactive = variantChoiceFor(
                deferred,
                svc.id,
                catalog.version,
                zonePool.map((z) => ({
                  id: z.id,
                  name: z.name,
                  audience: z.audience,
                  durationMinutes: z.durationMinutes,
                  priceCents: z.priceCents,
                })),
              )
            } else {
            const resolved = mention.zones.length > 0 ? mention.zones : kept
            const echoed =
              zoneEcho !== 'skip' &&
              zoneEcho !== 'confirm' &&
              zoneEcho !== 'correct' &&
              turnPicked &&
              resolved.length > 0
                ? presentZoneEcho(svc.id, resolved)
                : null
            if (echoed) {
              saveSession({
                serviceId: svc.id,
                variantIds: resolved.map((z) => z.id),
                ...(line ? { audienceLine: line } : {}),
              })
              replyText = echoed.replyText
              interactive = echoed.interactive
            } else {
            const preferred = preferredProfessionalId(
              db,
              tenantId,
              [turnText, ...older.map((m) => m.body)].join('\n'),
              svc,
              clock,
              input.turn?.catalog.resources,
            )
            const offered = await offerNearestSlots({
              db,
              tenantId,
              service: svc,
              zones: kept,
              tz,
              clock,
              forecast: input.forecast,
              professionalId: preferred,
              date: date ?? null,
              period: (turnFacts.period as DayPeriod | null) ?? null,
              limit: 3,
              conversationId: input.conversationId,
            })
            logPolicyShadow({
              tenantId,
              conversationId: input.conversationId,
              phase: 'cf19',
              current: { action: 'ask_empty_time' },
              proposed: { action: 'offer_slots', detail: date ? 'date' : 'soonest' },
            })
            interactive = rememberOfferFrame(
              deferred,
              svc.id,
              offered.slots,
              preferred,
              catalog.version,
            )
            replyText = offered.replyText
            }
            }
          }
          }
        }
      } else if (booking.kind === 'clarify' && booking.question) {
        replyText = booking.question
        if (booking.serviceId) {
          saveSession({
              serviceId: booking.serviceId,
              ...(booking.variantIds.length > 0 ? { variantIds: booking.variantIds } : {}),
            })
        }
      }
      const faltam = missing.length ? missing.join(', ') : 'confirmação clara'
      return finish({
        ...none(det.status, base),
        ...(replyText ? { replyText } : {}),
        ...(interactive ? { interactive } : {}),
        notes:
          det.status === 'needs_info' || det.status === 'ambiguous'
            ? `Agendamento pela IA não feito: falta/ambíguo (${faltam}). Confirme com a cliente dia, horário e procedimento.`
            : undefined,
      })
    }
  }
  const svc = det.service
  rememberDayPeriod(svc.id)
  const preferredProId = preferredProfessionalId(
    db,
    tenantId,
    [turnText, ...older.map((m) => m.body)].join('\n'),
    svc,
    clock,
    input.turn?.catalog.resources,
  )
  const activeZones = svc.zones.filter((z) => z.active)
  // DEC-090 / #510: linha do quadro primeiro. Só a sessão do mesmo serviço conta.
  // Após DEC-086 (sessão limpa) ou serviço diferente, «Masculina»/«Todas» antigas não valem.
  const sameFunnel = Boolean(session && session.serviceId === svc.id)
  const inFunnel =
    sameFunnel && session
      ? funnelMessageFilter(
          older,
          (m) => ({ direction: m.direction, at: m.created_at }),
          session.updatedAt,
        )
      : null
  const funnelOlder = inFunnel ? older.filter((m) => m.direction !== 'inbound' || inFunnel(m)) : []
  const funnelInboundNewestFirst = [
    ...[...clientTurn].reverse().map((m) => m.body),
    ...funnelOlder.filter((m) => m.direction === 'inbound').map((m) => m.body),
  ]
  const turnExplicit = explicitAudienceLine(turnText)
  const frameLine = sameFunnel ? (frame?.line ?? session?.audienceLine ?? null) : heldAudienceLine(frame)
  // Parser de histórico só se o quadro ainda não tem linha (#510 — sem segundo parser).
  const historyLine =
    !turnExplicit && !frameLine && sameFunnel
      ? audienceLineFromClientTexts(funnelInboundNewestFirst)
      : null
  const line = needsAudienceLine(activeZones)
    ? (turnExplicit ?? frameLine ?? historyLine)
    : null
  if (
    needsAudienceLine(activeZones) &&
    !line &&
    !(frame && wouldAskFilledSlot(frame, 'line'))
  ) {
    saveSession({ serviceId: svc.id, audienceLine: null })
    const interactive = lineChoiceFor(deferred, svc.id, catalog.version)
    return finish({
      ...none('needs_info', { ...base, serviceId: svc.id, date, time }),
      replyText: audienceLineQuestion(svc.name, input.conversationId),
      interactive,
      notes:
        `A cliente falou em ${svc.name} sem escolher a linha. Pergunta automática enviada. ` +
        'Não se infere pelo nome, pelo histórico nem por marcações. Texto livre não marca.',
    })
  }
  if (line) {
    saveSession({ serviceId: svc.id, audienceLine: line })
  }
  const scoped = needsAudienceLine(activeZones) ? zonesForAudienceLine(activeZones, line) : activeZones
  const mentionPool = scoped.length > 0 ? scoped : activeZones
  const sessionIds = sameFunnel && session?.variantIds?.length ? session.variantIds : []
  const fromSession = sessionIds.length
    ? mentionPool.filter((z) => sessionIds.includes(z.id))
    : []
  const sessionIntact = sessionIds.length > 0 && fromSession.length === sessionIds.length
  const proposalMention = mentionZones(turnText, mentionPool, svc)
  // #510: eco Sim / toque Horários / Opções → quadro. Texto e histórico só
  // preenchem o que ainda falta; sessão suja («as duas» + catálogo inteiro)
  // não vence menções explícitas (axila e íntima).
  // Hora já casada na lista não descarta sobra de zona (DEC-137 / #509):
  // «Sexta às 09:00 e cotovelo» pergunta a zona e não emite proposta.
  let namedZones: typeof fromSession = []
  let echoLocked = false
  let ambiguous = false
  if (zoneEcho === 'correct') {
    namedZones = []
    saveSession({ serviceId: svc.id, variantIds: null })
  } else if (proposalMention.unrecognized && zoneEcho !== 'skip') {
    // Sobra por resolver bloqueia a proposta e não apaga o conjunto já resolvido.
    namedZones = []
  } else if (zoneEcho === 'confirm' || input.boundSlot) {
    echoLocked = sessionIntact
    namedZones = echoLocked ? fromSession : []
  } else if (proposalMention.zones.length > 0) {
    const seen = new Set<string>()
    ambiguous = proposalMention.zones.some((zone) => {
      const key = zone.name.trim().toLocaleLowerCase('pt-BR')
      if (seen.has(key)) return true
      seen.add(key)
      return false
    })
    namedZones = ambiguous ? [] : proposalMention.zones
  } else {
    const chosen = sameFunnel
      ? zonesChosenByClient(clientTurn, funnelOlder, scoped, svc)
      : zonesChosenByClient(clientTurn, [], scoped, svc)
    if (chosen.zones.length > 0 || chosen.ambiguous) {
      // Menção explícita no funil (ex. «axila e íntima») vence sessão suja.
      namedZones = chosen.zones
      ambiguous = chosen.ambiguous
    } else if (sessionIntact) {
      namedZones = fromSession
      echoLocked = true
    } else {
      namedZones = chosen.zones
      ambiguous = chosen.ambiguous
    }
  }
  // Cutover fechado (#472): só o frame (variantIds / lastOffer) autoriza — CF-22.
  if (echoLocked) ambiguous = false
  if (namedZones.length > 0 && !ambiguous) {
    saveSession({
        serviceId: svc.id,
        variantIds: namedZones.map((z) => z.id),
        ...(clockFromTurn ? { clockTime: clockFromTurn } : { clockTime: time }),
      })
  } else if (clockFromTurn || time) {
    saveSession({ serviceId: svc.id, clockTime: clockFromTurn ?? time })
  }
  const plural = svc.variantKindPlural?.trim() || ''
  const singular = svc.variantKind?.trim() || ''
  const kind = (plural || singular || DEFAULT_OPTION_KIND_PLURAL).toLocaleLowerCase('pt-BR')
  const phrase = plural || !singular ? `as ${kind}` : `a ${kind}`
  const kindForAct = svc.variantKindPlural || svc.variantKind
  if (activeZones.length > 0 && (namedZones.length === 0 || ambiguous)) {
    const zonePool = scoped.length > 0 ? scoped : activeZones
    const names = stableVariantLabelList(zonePool)
    const interactive = variantChoiceFor(
      deferred,
      svc.id,
      catalog.version,
      zonePool.map((z) => ({
        id: z.id,
        name: z.name,
        audience: z.audience,
        durationMinutes: z.durationMinutes,
        priceCents: z.priceCents,
      })),
    )
    const genericAsk = askZonesReply(phrase, names, time, input.conversationId, kindForAct)
    return finish({
      ...none('needs_info', { ...base, serviceId: svc.id, date, time }),
      // REQ-088 / AC-60: pergunta determinística — não depender do modelo nem silenciar.
      // #509: sobra sem match único → «Não encontrei {palavra}…» (copy proposta).
      replyText:
        proposalMention.unrecognized && !ambiguous
          ? askUnrecognizedZone(proposalMention, zonePool, genericAsk)
          : genericAsk,
      interactive,
      notes: ambiguous
        ? `O nome citado casa com mais de uma ${kind}. Pergunta automática enviada. Não informe valor nem envie proposta.`
        : proposalMention.unrecognized
          ? `Zona citada sem correspondência única (${proposalMention.leftover ?? '?'}). Pergunta automática enviada.`
          : `A cliente falou em ${svc.name} sem escolher ${kind} (${names.join(', ')}). ` +
            `Pergunta automática enviada. Não informe valor nem «a partir de».`,
    })
  }
  if (variantAudiencesConflict(namedZones)) {
    return finish({
      ...none('needs_info', { ...base, serviceId: svc.id, date, time }),
      replyText: mixedAudienceReply(input.conversationId),
      notes:
        `As ${kind} escolhidas misturam masculino e feminino. Peça um conjunto compatível. Não informe valor nem envie proposta.`,
    })
  }
  // Hora já dita neste turno → proposta (CF-24). O eco é antes de Horários,
  // ou quando o plural leve entrou (confirma o mapeamento antes da proposta).
  const echoBeforeProposal = !clockFromTurn || proposalMention.approx
  if (
    echoBeforeProposal &&
    zoneEcho !== 'skip' &&
    zoneEcho !== 'confirm' &&
    zoneEcho !== 'correct' &&
    namedZones.length > 0 &&
    !ambiguous &&
    proposalMention.zones.length > 0
  ) {
    const echoed = presentZoneEcho(svc.id, namedZones)
    if (echoed) {
      saveSession({ serviceId: svc.id, variantIds: namedZones.map((z) => z.id) })
      return finish({
        ...none('needs_info', { ...base, serviceId: svc.id, date, time }),
        replyText: echoed.replyText,
        interactive: echoed.interactive,
        notes: 'DEC-137: eco das zonas antes da lista. Sim nao marca.',
      })
    }
  }
  let quote
  try {
    quote = quoteVisit(
      db,
      tenantId,
      svc,
      namedZones.map((z) => z.id),
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : 'erro'
    return finish({
      ...none('needs_info', { ...base, serviceId: svc.id, date, time }),
      // Não silenciar: o modelo pode ter deixado a mensagem vazia à espera da proposta.
      replyText:
        activeZones.length > 0
          ? askZonesReply(
              phrase,
              stableVariantLabelList(scoped.length > 0 ? scoped : activeZones),
              time,
              input.conversationId,
              kindForAct,
            )
          : teamConfirmsSoonReply(svc.name, time, input.conversationId),
      notes:
        `Não deu para calcular ${svc.name}: ${message}. Pergunta/aviso automático enviado. Texto livre não marca.`,
    })
  }
  const label = `${svc.name} · ${dayText(date)} às ${time}`
  const found = { ...base, serviceId: svc.id, date, time }

  // S2 / DEC-061: texto livre NUNCA marca. Com capacidade ligada, monta+envia proposta versionada
  // (botão WhatsApp); o clique (S5) é que marca ou inicia Pix. Sem capacidade → só nota à atendente.
  const avail = await queryAutomaticAvailability(
    db,
    tenantId,
    {
      serviceId: svc.id,
      date,
      ...(quote.zones.length > 0 ? { durationMinutesOverride: quote.durationMinutes } : {}),
      ...(preferredProId ? { professionalId: preferredProId } : {}),
    },
    clock,
    input.forecast ?? { read: readOpenMeteo },
  )
  const slot = avail.slots.find((s) => localHHMM(tz, s.startsAt) === time)

  if (!slot) {
    const team = queryAvailability(
      db,
      tenantId,
      {
        serviceId: svc.id,
        date,
        ...(quote.zones.length > 0 ? { durationMinutesOverride: quote.durationMinutes } : {}),
        ...(preferredProId ? { professionalId: preferredProId } : {}),
      },
      clock,
    )
    const teamSlot = team.slots.find((s) => localHHMM(tz, s.startsAt) === time)
    if (teamSlot) {
      const verdict = await evaluateServiceTempo(
        db,
        tenantId,
        { serviceId: svc.id, startsAt: teamSlot.startsAt },
        input.forecast ?? { read: readOpenMeteo },
        clock,
      )
      if (verdict.outcome !== 'serve') {
        const phraseTempo =
          verdict.outcome === 'indisponivel' ? TEMPO_UNCONFIRMED_PHRASE : TEMPO_REFUSED_PHRASE
        openPendingCommunication(
          db,
          {
            tenantId,
            conversationId: conv.id,
            contactId: conv.contactId,
            proposalId: null,
            kind: 'alter_awaiting_team',
            detailText: phraseTempo,
          },
          clock,
        )
        return finish({
          ...none(svc.requiresSignal ? 'needs_signal' : 'requires_button', found),
          replyText: phraseTempo,
          notes:
            `O horário das ${time} não passa no tempo de ${svc.name}. Frase fixa enviada. ` +
            'A equipe vê o alerta. Texto livre não marca.',
        })
      }
    }
    // CF-15 (#413): alternativas por proximidade no mesmo período; sem vaga → próximo dia.
    const legacyAlts = avail.slots
      .slice(0, 3)
      .map((s) => localHHMM(tz, s.startsAt))
      .filter((t) => t !== time)
    const openOffer = getActiveProposalForConversation(db, tenantId, input.conversationId, clock)
    if (openOffer) {
      saveSession({
        serviceId: openOffer.serviceId,
        clockTime: localHHMM(tz, openOffer.startsAt),
        date: clinicCivilDateFromUtc(tz, openOffer.startsAt),
      })
    }
    const replyText = await occupiedSlotAlternativesReply({
      db,
      tenantId,
      service: svc,
      zones: namedZones,
      tz,
      clock,
      forecast: input.forecast,
      professionalId: preferredProId,
      date,
      time,
      sameDaySlots: avail.slots,
      conversationId: input.conversationId,
    })
    logPolicyShadow({
      tenantId,
      conversationId: input.conversationId,
      phase: 'cf15',
      current: {
        action: legacyAlts.length > 0 ? 'first_slots' : 'ask_other_day',
        detail: legacyAlts.join(',') || undefined,
      },
      proposed: {
        action: replyText.includes('próximo com vaga') ? 'next_day_alts' : 'nearby_alts',
      },
    })
    return finish({
      ...none(svc.requiresSignal ? 'needs_signal' : 'requires_button', found),
      replyText,
      notes:
        `A cliente parece confirmar ${label} (horário não livre na agenda). ` +
        'Aviso automático enviado. Texto livre não marca — confirme pelo Agendar se precisar.',
    })
  }

  if (!input.capability) {
    if (svc.requiresSignal) {
      const amount = signalAmountCents(svc, quote.priceCents)
      return finish({
        ...none('needs_signal', found),
        replyText:
          `Para garantir ${svc.name} na ${dayText(date)} às ${time}, a clínica pede um sinal` +
          `${amount != null ? ` de ${brl(amount)}` : ''} por Pix. O horário só fica reservado depois do pagamento, e o Pix chega aqui na conversa.`,
        notes:
          `A cliente confirmou ${label}. Serviço exige sinal: a IA NÃO marcou. ` +
          'Envie a cobrança Pix pelo Agendar (fluxo normal); o compromisso é criado após o pagamento.',
      })
    }
    return finish({
      ...none('requires_button', found),
      replyText:
        `Recebi seu pedido de ${svc.name} na ${dayText(date)} às ${time}. Ainda não está marcado: a equipe confirma o horário e já te retorna.`,
      notes:
        `A cliente parece confirmar ${label}. ` +
        'Capacidade pausada: aviso automático enviado; confirme pelo Agendar (fluxo normal).',
    })
  }

  try {
    const proposal = createProposal(
      db,
      tenantId,
      {
        contactId: conv.contactId,
        conversationId: conv.id,
        serviceId: svc.id,
        professionalId: slot.professionalId,
        startsAt: slot.startsAt,
        endsAt: slot.startsAt + quote.durationMinutes * 60_000,
        durationMinutes: quote.durationMinutes,
        zoneIds: quote.zones.map((z) => z.zoneId).filter((id): id is string => Boolean(id)),
      },
      clock,
      input.abuseLimits ? { abuseLimits: input.abuseLimits } : {},
    )
    const afterPersist = deferred.hasWork ? deferred.toAfterPersist(clock) : undefined
    const sent = sendProposalToWhatsAppOp(
      db,
      caller,
      { proposalId: proposal.id, ...(afterPersist ? { afterPersist } : {}) },
      clock,
    )
    const status: AutoBookStatus = svc.requiresSignal ? 'needs_signal' : 'requires_button'
    const delivered = sent.status === 'queued' || sent.status === 'already_sent'
    if (delivered) deferred.discard()
    const sendNote = delivered
      ? `Proposta ${proposal.id} v${proposal.version} enfileirada/enviada com botão Confirmar. ` +
        'Aguarda o clique da cliente; texto livre («sim») não marca.'
      : `Proposta ${proposal.id} v${proposal.version} preparada, mas envio entregue à equipe ` +
        `(${sent.status}). Texto livre não marca.`
    return finish({
      ...none(status, found),
      proposalId: proposal.id,
      proposalVersion: proposal.version,
      // Proposta no WhatsApp → sem texto. Falha de envio → aviso, para não silenciar.
      replyText: delivered
        ? ''
        : sendFailedText(svc.name, date, time),
      notes: `A cliente parece confirmar ${label}. ${sendNote}`,
      outbox: sent.outbox,
    })
  } catch (err) {
    return finish({
      ...none(svc.requiresSignal ? 'needs_signal' : 'requires_button', found),
      replyText:
        sendFailedText(svc.name, date, time),
      notes:
        `A cliente parece confirmar ${label}. Falha ao montar/enviar a proposta: ` +
        `${err instanceof Error ? err.message.slice(0, 180) : 'erro'}. ` +
        'Aviso automático enviado — confirme pelo Agendar.',
    })
  }
}
