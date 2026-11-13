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
import { allowsMultipleVariants } from '../catalog/variant-selection'
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
import { promiseTeamFollowUp } from './promise-team-follow-up'
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
import { MULTI_VARIANT_ASK_HINT, sayAct } from './dialogue-acts'
import {
  appendEndHelpHint,
  appendResetDiscoveryHint,
  RESET_DISCOVERY_HINT_TEXT,
  shouldAppendEndHelpHint,
  markEndHelpHintSent,
  wasEndHelpHintSent,
} from './end-help-hint'
import { isHumanTeamOfferAllowed } from './human-handoff'
import {
  appendHumanHelpHint,
  markHumanHelpHintSent,
  shouldAppendHumanHelpHint,
  wasHumanHelpHintSent,
} from './human-help-hint'
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
  claimsWholeCatalog,
  zonesChosenInClientTexts,
} from './schedule-choice'
import {
  detectDayAskIgnoredLockedVariant,
  frictionForCatalogMiss,
  frictionForOptionMiss,
  frictionModeUmaTodas,
  mergeFriction,
  turnLooksLikeDayOrTimeAsk,
  type TurnFrictionEvent,
} from './turn-friction'
import { flagConversationForReview } from '../inbox/review-flag'
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
  variantKindForAsk,
  variantListInProse,
  variantListQuestion,
  variantTipoWord,
  whichKind,
  zonesForAudienceLine,
} from './variant-line'
import { extractDates, extractTimes, norm } from './nlu/temporal'
import { classifyCrossCuttingAct } from './booking-turn-gate'
import { realizeAskInfo, realizeClarify } from './ask-info-realize'
import {
  answerFaqFromCatalog,
  faqMissingChoiceInteractive,
} from './faq-clarification'
import {
  parkFromFrame,
  shouldResumeSlotAsk,
  shouldResumeVariantAsk,
} from './dialogue-interrupt-stack'
import {
  obligationFromFrame,
  shouldEmitOptionMiss,
} from './dialogue-obligation'
import { logPolicyShadow } from './policy-shadow'
import {
  occupiedSlotAlternativesReply,
  offerNearestSlots,
  slotListRowCopy,
  slotOfferSameCivilDay,
  slotOrderFromText,
  type DayPeriod,
  type OfferedSlot,
} from './slot-offer'
import {
  isPendingOfferFresh,
  matchPendingChoice,
} from './booking-frame-choice'
import {
  applyBookingUpdate,
  type BookingUpdateIntent,
} from './apply-booking-update'
import {
  classifyVariantPolarity,
  resolvePolarityVariantIds,
} from './booking-intent-text'
import {
  createDeferredBookingFrame,
  offerFramePatch,
  OUTBOUND_MESSAGE_ID_PLACEHOLDER,
  type DeferredBookingFrame,
} from './deferred-booking-frame'
import {
  attachChoiceOfferToDeferred,
  buildLineChoiceInteractive,
  buildPeriodDayInteractive,
  buildSlotChoiceInteractive,
  buildVariantChoiceInteractive,
  buildZoneAccumInteractive,
  buildZoneEchoInteractive,
  slotBindingFromChoice,
  zoneAccumAckReply,
  zoneAccumMaisBody,
  zoneEchoReply,
  type ChoiceInteractive,
} from './choice-offer'
import { priceFollowupInteractiveButtons } from '../followup/post-booking'

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
  // Same-day → HH:MM; multi-dia → weekday+DD/MM+hora (Paulo 13/11/2026).
  const timeOnly = slotOfferSameCivilDay(slots)
  const built = buildSlotChoiceInteractive({
    catalogVersion,
    slots: (patch.pending?.options ?? []).map((o) => {
      const bound = slotBindingFromChoice(o.key, o.label)
      const copy = bound ? slotListRowCopy(bound.date, bound.time, { timeOnly }) : null
      const description = copy?.description?.trim()
      return {
        key: o.key,
        label: copy?.title ?? o.label,
        ...(description ? { description } : {}),
      }
    }),
  })
  // Pending: chave civil + rótulo (same-day HH:MM; multi-dia terça 03/11 17:00).
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

/** Aplica clear period/date + T1 quando a oferta veio vazia (Paulo 09/11/2026). */
function applyOfferSideEffects(
  deferred: DeferredBookingFrame,
  serviceId: string,
  catalogVersion: string,
  offered: {
    slots: import('./slot-offer').OfferedSlot[]
    clearPeriod?: boolean
    clearDate?: boolean
    periodDayChoice?: boolean
  },
  professionalId: string | undefined,
  rememberOffer: typeof rememberOfferFrameImpl,
): ChoiceInteractive | null {
  if (offered.clearPeriod || offered.clearDate) {
    deferred.save({
      serviceId,
      ...(offered.clearPeriod ? { period: null } : {}),
      ...(offered.clearDate ? { date: null } : {}),
    })
  }
  if (offered.periodDayChoice && offered.slots.length === 0) {
    const built = buildPeriodDayInteractive(catalogVersion)
    return attachChoiceOfferToDeferred(deferred, serviceId, catalogVersion, built)
  }
  return rememberOffer(deferred, serviceId, offered.slots, professionalId, catalogVersion)
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
  opts?: { includeTodas?: boolean; omitIds?: readonly string[] },
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
    includeTodas: opts?.includeTodas,
    omitIds: opts?.omitIds,
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
  /**
   * T2 session-analytics: friction flags deste turno (sem texto).
   * Consumido por `emitTurnDecided` no autodraft.
   */
  friction?: TurnFrictionEvent[]
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

/**
 * Pergunta Opções quando uma zona citada não resolve (#509).
 * DEC-C3: option-miss só sob obrigação de escolha; senão `esclarecer`.
 * T2: quando emite option-miss, devolve também friction (nao_encontrei / particle_as_zone).
 */
function askUnrecognizedZone(
  mention: { leftover: string | null; zones?: readonly { name: string }[] },
  zonePool: ServiceRow['zones'],
  fallback: string,
  opts?: {
    conversationId?: string
    emitOptionMiss?: boolean
  },
): { text: string; friction: TurnFrictionEvent[] } {
  const names = stableVariantLabelList(zonePool)
  if (mention.leftover && opts?.emitOptionMiss !== false) {
    let text = zoneNotFoundAskReply(mention.leftover, names)
    // Paulo 10/11/2026 opção 2: eco factual do que casou + pergunta só da sobra.
    // Sem Sim/Corrigir aqui — o eco DEC-137 completo espera o conjunto resolvido.
    const understood = (mention.zones ?? [])
      .map((z) => z.name.trim().toLocaleLowerCase('pt-BR'))
      .filter(Boolean)
    if (understood.length > 0) {
      text = `Entendi: ${understood.join(', ')}. ${text}`
    }
    // Discovery reset (Paulo 09/11/2026): one-shot hint no option-miss.
    text = appendResetDiscoveryHint(text)
    return {
      text,
      friction: frictionForOptionMiss(mention.leftover),
    }
  }
  if (mention.leftover && opts?.emitOptionMiss === false) {
    return {
      text: sayAct(
        'esclarecer',
        opts.conversationId ?? '',
        {},
        'Pode me dizer de outro jeito, ou prefere falar com a equipe?',
      ),
      friction: [],
    }
  }
  return { text: fallback, friction: [] }
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
  service?: Pick<ServiceRow, 'name' | 'synonyms' | 'variantSelection'>,
): { zones: ServiceRow['zones']; ambiguous: boolean } {
  const texts = [
    clientTurn.map((m) => m.body).join('\n'),
    ...older.filter((m) => m.direction === 'inbound').map((m) => m.body),
  ]
  return zonesChosenInClientTexts(
    texts,
    zones,
    service
      ? {
          ignoreWords: zoneMentionIgnore(service),
          selectionMode: service.variantSelection,
        }
      : undefined,
  )
}

/**
 * Pergunta as variantes com hora já conhecida (`perguntar_variantes` + `{hora}`).
 * `phrase` legado («as zonas» / «a zona») só entra no fallback; `{tipo}` vem do kind.
 * DEC-145: `selectionMode=uma` escolhe redação singular (sem convite multi).
 * Modo `varias`: Opções + Mais|Pronto (DEC-178); texto livre + eco DEC-137 mantém-se.
 */
export function askZonesReply(
  phrase: string,
  zoneNames: string[],
  time: string,
  conversationId = '',
  variantKind?: string | null,
  selectionMode?: ServiceRow['variantSelection'],
): string {
  // Paulo 08/11/2026: variantes em minúsculas na frase ask-tipo; Opções Meta mantém cadastro.
  const list = variantListInProse(zoneNames)
  const single = selectionMode === 'uma'
  const tipo =
    variantKind != null
      ? variantTipoWord(variantKind)
      : phrase.replace(/^(as|a|o)\s+/i, '').trim().toLocaleLowerCase('pt-BR') || (single ? 'opção' : 'opções')
  // DEC-145: catálogo M4 é plural; modo `uma` usa singular directo (máx. 5 redações/ato).
  if (single) {
    return `Para fechar às ${time}, ${whichKind(variantKind ?? '')} você quer? Temos ${list}.`
  }
  const fallback = `Para fechar às ${time}, quais ${tipo}? Temos ${list}. ${MULTI_VARIANT_ASK_HINT}`
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
     * `skip` = toque em Opções (modo `uma`, ou Todas). `confirm` = Sim do eco / Pronto (abre Horários, não marca).
     * `correct` = Corrigir (volta à pergunta das zonas).
     */
    zoneEcho?: 'skip' | 'confirm' | 'correct'
    /**
     * DEC-178. Acumulação multi-zona por toque (modo `varias`).
     * `pick` = toque numa zona → ack curto + Mais|Pronto.
     * `mais` = reabre Opções (omite já escolhidas; corpo «já: …»).
     * `pronto` = fecha o conjunto (combinar com zoneEcho confirm).
     */
    zoneAccum?: 'pick' | 'mais' | 'pronto'
    /** Id da zona tocada quando `zoneAccum=pick`. */
    pickedVariantId?: string
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
  /**
   * DEC-152: snapshot do quadro no início do turno (hint one-shot sem progresso).
   * Reatribuído após `syncBookingFrameWithCatalog` para não confundir
   * revalidação de catálogo com avanço da cliente.
   */
  let frameAtStart = getBookingFrame(db, tenantId, input.conversationId)
  const catalog =
    input.turn?.catalog ?? getOrCompileCatalog(db, tenantId, clock)
  /** T2: friction flags acumuladas neste turno (sem texto). */
  const frictionAcc: TurnFrictionEvent[] = []
  /** Preenchido quando o turno tem texto (finish corre antes da atribuição no source). */
  let turnTextForFriction = ''
  const pushFriction = (...evs: TurnFrictionEvent[]) => {
    for (const e of mergeFriction(evs)) {
      if (
        !frictionAcc.some(
          (f) =>
            f.flag === e.flag &&
            f.kind === e.kind &&
            f.termHash === e.termHash &&
            f.serviceId === e.serviceId,
        )
      ) {
        frictionAcc.push(e)
      }
    }
  }
  const saveSession = (patch: Parameters<typeof saveScheduleSession>[3]) => {
    deferred.save({
      ...patch,
      catalogVersion: patch.catalogVersion ?? catalog.version,
    })
  }
  /** #579: política do quadro passa pelo actualizador; o adaptador só emite intent. */
  const runBookingUpdate = (intent: BookingUpdateIntent, serviceId?: string | null) => {
    const frameNow =
      deferred.peekFrame(db, tenantId, input.conversationId) ??
      getBookingFrame(db, tenantId, input.conversationId)
    const result = applyBookingUpdate({
      frame: frameNow,
      intent,
      evidence: {
        source: input.boundSlot ? 'button' : 'text',
        sourceMessageId: input.confirmationMessageIdOverride,
      },
      serviceId: serviceId ?? frameNow?.serviceId ?? undefined,
      catalogVersion: catalog.version,
    })
    if (Object.keys(result.patch).length > 0) {
      deferred.saveFrame(result.patch)
    }
    if (result.proposalConfirm === 'suspend') {
      suspendOpenProposalConfirm(db, tenantId, input.conversationId, clock)
    } else if (result.proposalConfirm === 'resume') {
      resumeOpenProposalConfirm(db, tenantId, input.conversationId, clock)
    }
    return result
  }
  const finish = (outcome: AutoBookOutcome): AutoBookOutcome => {
    let next = outcome
    const frameNow =
      deferred.peekFrame(db, tenantId, input.conversationId) ??
      getBookingFrame(db, tenantId, input.conversationId)
    const dayAskFriction = detectDayAskIgnoredLockedVariant({
      frameBefore: frameAtStart,
      frameAfter: frameNow,
      turnLooksLikeDayAsk: turnLooksLikeDayOrTimeAsk(turnTextForFriction),
    })
    if (dayAskFriction) pushFriction(dayAskFriction)
    const friction = mergeFriction(outcome.friction, frictionAcc)
    next = { ...outcome, friction: friction.length > 0 ? friction : undefined }
    // DEC-157: auto-flag na fila de revisão em «Não encontrei…» (sem pausar).
    // Outbox entra em `autoBook.outbox` → fanout WS no runAutoDrafts.
    if (friction.some((e) => e.flag === 'nao_encontrei')) {
      try {
        const flagged = flagConversationForReview(
          db,
          tenantId,
          input.conversationId,
          { source: 'auto', reason: 'nao_encontrei' },
          clock,
        )
        if (flagged.outbox.length > 0) {
          next = { ...next, outbox: [...next.outbox, ...flagged.outbox] }
        }
      } catch {
        /* flag best-effort — não bloqueia o turno */
      }
    }
    if (next.replyText?.includes(RESET_DISCOVERY_HINT_TEXT)) {
      // Option-miss discovery hint (Paulo 09/11/2026) — marca one-shot como DEC-152.
      markEndHelpHintSent(db, tenantId, input.conversationId)
    }
    // DEC-153: 1.ª oferta de Horários — dica textual one-shot (sem handoff automático).
    if (
      shouldAppendHumanHelpHint({
        replyText: next.replyText,
        interactive: next.interactive,
        proposalId: next.proposalId,
        alreadySent: wasHumanHelpHintSent(db, tenantId, input.conversationId),
        teamOfferAllowed: isHumanTeamOfferAllowed(db, tenantId, clock),
      })
    ) {
      next = {
        ...next,
        replyText: appendHumanHelpHint(next.replyText!, input.conversationId),
        notes: [next.notes, 'DEC-153'].filter(Boolean).join(' '),
      }
      markHumanHelpHintSent(db, tenantId, input.conversationId)
    }
    if (
      shouldAppendEndHelpHint({
        replyText: next.replyText,
        proposalId: next.proposalId,
        notes: next.notes,
        frameAtStart,
        frameNow,
        alreadySent: wasEndHelpHintSent(db, tenantId, input.conversationId),
      })
    ) {
      next = {
        ...next,
        replyText: appendEndHelpHint(next.replyText!, input.conversationId),
        notes: [next.notes, 'DEC-152'].filter(Boolean).join(' '),
      }
      markEndHelpHintSent(db, tenantId, input.conversationId)
    }
    if (!deferred.hasWork) return next
    const willSend =
      Boolean(next.replyText?.trim()) || Boolean(next.proposalId)
    if (willSend) {
      return { ...next, deferredFrame: deferred }
    }
    // Sem resposta à cliente: persiste o frame e devolve o outbox para fanout WS (#472).
    const flushed = deferred.flushNow(db, tenantId, input.conversationId, clock)
    return {
      ...next,
      outbox: [...next.outbox, ...flushed],
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
  turnTextForFriction = turnText

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
  // Baseline do progresso DEC-152: depois da revalidação, antes do turno.
  frameAtStart = getBookingFrame(db, tenantId, input.conversationId)

  // P1 / DEC-C4: gate cross-cutting antes de pending / fillers
  // (restart → exit A/B → reject C → ask_info). Handoff fica no autodraft.
  const gate = classifyCrossCuttingAct({ text: turnText })
  // CF-28 / #508 / DEC-138 practice 5: restart phrases clear the booking frame
  // and retire any open proposal without confirming (DEC-061). Reply = perguntar_servico.
  if (gate.kind === 'restart') {
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

  // DEC-147 A/B: abandono explícito (A) ou despedida após oferta (B).
  // B com proposta aberta NÃO retira o Confirmar (CF-23: «obrigada!» ≠ abandonar).
  // A limpa sempre; B limpa só com slots/pending/coleta sem proposta.
  if (gate.kind === 'exit_ab') {
    const frameSoft = getBookingFrame(db, tenantId, input.conversationId)
    const openProposal = getActiveProposalForConversation(
      db,
      tenantId,
      input.conversationId,
      clock,
    )
    const explicit = gate.explicit
    const inFunnelSlots = Boolean(
      frameSoft?.serviceId ||
        (frameSoft?.variantIds && frameSoft.variantIds.length > 0) ||
        frameSoft?.pending ||
        frameSoft?.lastOffer,
    )
    const shouldAbandon = explicit
      ? Boolean(openProposal || inFunnelSlots)
      : inFunnelSlots && !openProposal
    if (shouldAbandon) {
      deferred.clearSession()
      retireActiveProposal(db, tenantId, input.conversationId, clock)
      const replyText = sayAct(
        'acolher_adiamento',
        input.conversationId,
        {},
        'Sem problema. Quando quiser, é só chamar.',
      )
      return finish({
        ...none('needs_info', { confirmationMessageId: confirmation.id }),
        replyText,
        notes: explicit
          ? 'DEC-147 A: explicit abandon clears BookingFrame.'
          : 'DEC-147 B: farewell after slots (no open proposal).',
      })
    }
  }

  // DEC-147 C: «não» / «não serve» sobre slots — rejeita a oferta, mantém serviço/variante.
  if (gate.kind === 'reject_c') {
    const frameReject = getBookingFrame(db, tenantId, input.conversationId)
    const hasOpenSlots = Boolean(
      (frameReject?.pending && frameReject.pending.slot === 'horario') ||
        frameReject?.lastOffer,
    )
    if (hasOpenSlots && frameReject?.serviceId) {
      const svcReject = services.find((s) => s.id === frameReject.serviceId)
      if (svcReject) {
        const activeZones = svcReject.zones.filter((z) => z.active)
        const keptFromIds =
          frameReject.variantIds && frameReject.variantIds.length > 0
            ? activeZones.filter((z) => frameReject.variantIds!.includes(z.id))
            : activeZones
        // Ids ainda no quadro mas fora do catálogo activo: preservar (não abandonar).
        const variantIdsToKeep =
          keptFromIds.length > 0
            ? keptFromIds.map((z) => z.id)
            : (frameReject.variantIds ?? [])
        const zonesForOffer = keptFromIds.length > 0 ? keptFromIds : activeZones
        const preferred = preferredProfessionalId(
          db,
          tenantId,
          turnText,
          svcReject,
          clock,
          input.turn?.catalog.resources,
        )
        saveSession({
          serviceId: svcReject.id,
          variantIds: variantIdsToKeep.length > 0 ? variantIdsToKeep : null,
          pending: null,
          lastOffer: null,
          phase: 'coletando',
        })
        const offered = await offerNearestSlots({
          db,
          tenantId,
          service: svcReject,
          zones: zonesForOffer,
          tz,
          clock,
          forecast: input.forecast,
          professionalId: preferred,
          date: frameReject.date ?? null,
          period: (frameReject.period as DayPeriod | null) ?? null,
          limit: 3,
          conversationId: input.conversationId,
        })
        const interactive = applyOfferSideEffects(
          deferred,
          svcReject.id,
          catalog.version,
          offered,
          preferred,
          rememberOfferFrame,
        )
        return finish({
          ...none('needs_info', {
            confirmationMessageId: confirmation.id,
            serviceId: svcReject.id,
          }),
          replyText: offered.replyText,
          interactive,
          notes: 'DEC-147 C: slot reject keeps variants; re-offers times without abandon.',
        })
      }
    }
  }

  // P1 / DEC-C1/C4: ask_info mid-funnel — park → realize → resume (stack explícita).
  // Não depende de suppress leftover; não limpa variante / não reabre tipo por engano.
  // DEC-177: FAQ (explanation) usa o mesmo gate — factos do cadastro, sem leftover.
  if (gate.kind === 'ask_info') {
    const frameAsk = getBookingFrame(db, tenantId, input.conversationId)
    const svcAsk = frameAsk?.serviceId
      ? services.find((s) => s.id === frameAsk.serviceId)
      : null
    if (svcAsk && frameAsk?.serviceId) {
      const activeAsk = svcAsk.zones.filter((z) => z.active)
      const lineAsk = heldAudienceLine(frameAsk) ?? frameAsk.line ?? null
      const poolAsk =
        needsAudienceLine(activeAsk) && lineAsk
          ? zonesForAudienceLine(activeAsk, lineAsk)
          : activeAsk
      const pool = poolAsk.length > 0 ? poolAsk : activeAsk

      if (gate.topic === 'explanation') {
        runBookingUpdate({ type: 'ask_info', topic: 'explicacao' })
        const faq = answerFaqFromCatalog({
          text: turnText,
          conversationId: input.conversationId,
          service: svcAsk,
          zones: pool,
        })
        if (faq.kind === 'missing') {
          return finish({
            ...none('needs_info', {
              confirmationMessageId: confirmation.id,
              serviceId: svcAsk.id,
            }),
            replyText: faq.replyText,
            interactive: faqMissingChoiceInteractive(db, tenantId, clock),
            notes: 'DEC-177: FAQ missing catalog detail; Continuar/equipe; no leftover.',
          })
        }
        let replyText = faq.replyText
        // Com facto: retoma a pergunta de zonas se ainda não há variante (não avança Horários).
        const parked = parkFromFrame(frameAsk, 'ask_info', 'explanation')
        if (shouldResumeVariantAsk(parked)) {
          const ask = variantListQuestion(
            svcAsk.name,
            variantKindForAsk(svcAsk),
            pool,
            input.conversationId,
            { selectionMode: svcAsk.variantSelection },
          )
          replyText = `${faq.replyText}\n${ask}`
        }
        return finish({
          ...none('needs_info', {
            confirmationMessageId: confirmation.id,
            serviceId: svcAsk.id,
          }),
          replyText,
          notes: `DEC-177: FAQ ${faq.kind} from catalog facts (pending kept).`,
        })
      }

      const namedAsk = zonesNamedInText(turnText, pool, {
        ignoreWords: [svcAsk.name, ...(svcAsk.synonyms ?? [])],
      })
      // D4: ask_info não grava variante — só aplica o intent no actualizador.
      runBookingUpdate({
        type: 'ask_info',
        topic: gate.topic === 'price' ? 'preco' : 'duracao',
      })
      const realized = realizeAskInfo({
        conversationId: input.conversationId,
        topic: gate.topic,
        service: svcAsk,
        zones: pool,
        frame: frameAsk,
        namedZones: namedAsk,
        sameFunnel: true,
      })
      if (realized) {
        // T3: preço total → Marcar outro | Terminar (sem pending M5).
        let priceButtons =
          realized.quote.act === 'informar_preco_soma'
            ? ({
                mode: 'buttons' as const,
                buttons: priceFollowupInteractiveButtons(),
              } satisfies ChoiceInteractive)
            : null
        let replyText = realized.replyText
        let slotInteractive: ChoiceInteractive | null = null
        // rsamp_fa7f138: após preço, reofertar slots (não só «qual horário?»).
        if (gate.topic === 'price' && shouldResumeSlotAsk(realized.parked)) {
          const variantIds = frameAsk.variantIds ?? []
          const kept = poolAsk.filter((z) => variantIds.includes(z.id))
          const zonesOffer = kept.length > 0 ? kept : poolAsk
          const quoteOnly = realized.resume
            ? realized.replyText.slice(0, realized.replyText.indexOf('\n')).trim()
            : realized.replyText
          const preferred = preferredProfessionalId(
            db,
            tenantId,
            [turnText, ...older.map((m) => m.body)].join('\n'),
            svcAsk,
            clock,
            input.turn?.catalog.resources,
          )
          const offered = await offerNearestSlots({
            db,
            tenantId,
            service: svcAsk,
            zones: zonesOffer,
            tz,
            clock,
            forecast: input.forecast,
            professionalId: preferred,
            date: frameAsk.date ?? null,
            period: frameAsk.period ?? null,
            order: slotOrderFromText(turnText),
            limit: 3,
            conversationId: input.conversationId,
          })
          slotInteractive = applyOfferSideEffects(
            deferred,
            svcAsk.id,
            catalog.version,
            offered,
            preferred,
            rememberOfferFrame,
          )
          replyText =
            offered.slots.length > 0
              ? `${quoteOnly}\n${offered.replyText}`
              : quoteOnly
          priceButtons = null
        }
        return finish({
          ...none('needs_info', {
            confirmationMessageId: confirmation.id,
            serviceId: svcAsk.id,
          }),
          replyText,
          ...(priceButtons ? { interactive: priceButtons } : {}),
          ...(slotInteractive ? { interactive: slotInteractive } : {}),
          notes: `DEC-C1/C4: ask_info ${gate.topic} via interrupt stack (pending kept).`,
        })
      }
    }
    // Sem serviço aberto: cede aos fillers / catalog frio (não leftover).
  }

  // ADR-0015 / DEC-127: ler primeiro contra pending.options (cutover fechado — #472).
  const frameEarly = getBookingFrame(db, tenantId, input.conversationId)
  /** Obrigação tipada (DEC-C4); option-miss só sob escolha (DEC-C3). */
  const dialogueObligation = obligationFromFrame(frameEarly)
  let zoneEcho = input.zoneEcho
  let zoneAccum = input.zoneAccum
  if (frameEarly?.pending?.slot === 'eco' && !zoneEcho) {
    const echoed = norm(turnText).replace(/[^a-z0-9]+/g, ' ').trim()
    if (echoed === 'sim' || echoed === 'certo') zoneEcho = 'confirm'
    else if (echoed === 'corrigir') zoneEcho = 'correct'
  }
  if (frameEarly?.pending?.slot === 'acumular' && !zoneAccum) {
    const accumText = norm(turnText).replace(/[^a-z0-9]+/g, ' ').trim()
    if (accumText === 'mais') zoneAccum = 'mais'
    else if (accumText === 'pronto') {
      zoneAccum = 'pronto'
      zoneEcho = 'confirm'
    } else if (frameEarly.serviceId) {
      // Texto livre com Mais|Pronto aberto: limpa pending e segue eco DEC-137.
      saveSession({
        serviceId: frameEarly.serviceId,
        pending: null,
        lastOffer: null,
        phase: 'coletando',
      })
    }
  }
  if (zoneEcho === 'correct') {
    // #576 / #579: Corrigir devolve o Confirmar via actualizador.
    runBookingUpdate({ type: 'correct_echo' })
  }
  const presentZoneEcho = (
    serviceId: string,
    zones: ServiceRow['zones'],
    selectionMode?: ServiceRow['variantSelection'],
  ): { replyText: string; interactive: ChoiceInteractive } | null => {
    // DEC-145: modo `uma` não ecoa conjunto (DEC-137 fica para `varias`).
    if (!allowsMultipleVariants(selectionMode)) return null
    if (zoneEcho === 'skip' || zoneEcho === 'confirm' || zoneEcho === 'correct') return null
    if (zoneAccum === 'pick' || zoneAccum === 'mais' || zoneAccum === 'pronto') return null
    if (zones.length === 0) return null
    const open = getActiveProposalForConversation(db, tenantId, input.conversationId, clock)
    const openIds = open
      ? readZoneSnapshots(db, tenantId, 'proposal', open.id)
          .map((zone) => zone.zoneId)
          .filter((id): id is string => Boolean(id))
      : null
    // #576 / #579: suspender Confirmar é política do actualizador, não do ramo local.
    runBookingUpdate(
      {
        type: 'resolved_substitution_echo',
        nextVariantIds: zones.map((zone) => zone.id),
        openProposalVariantIds: openIds,
      },
      serviceId,
    )
    const built = buildZoneEchoInteractive(catalog.version)
    return {
      replyText: zoneEchoReply(zones),
      interactive: attachChoiceOfferToDeferred(deferred, serviceId, catalog.version, built),
    }
  }

  /** DEC-178: ack curto + Mais|Pronto após toque (sem eco DEC-137). */
  const presentZoneAccum = (
    serviceId: string,
    zones: Array<{ id: string; name: string }>,
  ): { replyText: string; interactive: ChoiceInteractive } => {
    const built = buildZoneAccumInteractive(catalog.version)
    return {
      replyText: zoneAccumAckReply(zones),
      interactive: attachChoiceOfferToDeferred(deferred, serviceId, catalog.version, built),
    }
  }

  // DEC-178: toque numa zona (modo `varias`) → acumula e pede Mais|Pronto.
  if (zoneAccum === 'pick' && input.pickedVariantId && frameEarly?.serviceId) {
    const svcAccum = services.find((s) => s.id === frameEarly.serviceId)
    if (svcAccum && allowsMultipleVariants(svcAccum.variantSelection)) {
      const addResult = runBookingUpdate(
        {
          type: 'select_variants',
          variantIds: [input.pickedVariantId],
          mode: 'add',
          selectionMode: svcAccum.variantSelection,
          priorVariantIds: frameEarly.variantIds,
        },
        svcAccum.id,
      )
      const ids = addResult.resolvedVariantIds ?? []
      const active = svcAccum.zones.filter((z) => z.active)
      const scoped = zonesForAudienceLine(active, frameEarly.line)
      const picked = scoped.filter((z) => ids.includes(z.id))
      const named = picked.length > 0 ? picked : active.filter((z) => ids.includes(z.id))
      if (named.length > 0) {
        const presented = presentZoneAccum(svcAccum.id, named)
        return finish({
          ...none('needs_info', {
            confirmationMessageId: confirmation.id,
            serviceId: svcAccum.id,
          }),
          replyText: presented.replyText,
          interactive: presented.interactive,
          notes: 'DEC-178: zona tocada; Mais|Pronto. Sem eco Entendi.',
        })
      }
    }
  }

  // DEC-178: Mais → reabre Opções, omite já escolhidas, corpo «já: …».
  if (zoneAccum === 'mais' && frameEarly?.serviceId) {
    const svcMais = services.find((s) => s.id === frameEarly.serviceId)
    if (svcMais && allowsMultipleVariants(svcMais.variantSelection)) {
      const active = svcMais.zones.filter((z) => z.active)
      const scoped = zonesForAudienceLine(active, frameEarly.line)
      const pool = scoped.length > 0 ? scoped : active
      const pickedIds = frameEarly.variantIds ?? []
      const pickedZones = pool.filter((z) => pickedIds.includes(z.id))
      const remaining = pool.filter((z) => !pickedIds.includes(z.id))
      if (remaining.length === 0) {
        const built = buildZoneAccumInteractive(catalog.version, { onlyPronto: true })
        return finish({
          ...none('needs_info', {
            confirmationMessageId: confirmation.id,
            serviceId: svcMais.id,
          }),
          replyText: zoneAccumMaisBody(pickedZones),
          interactive: attachChoiceOfferToDeferred(deferred, svcMais.id, catalog.version, built),
          notes: 'DEC-178: todas as zonas já escolhidas; só Pronto.',
        })
      }
      const interactive = variantChoiceFor(
        deferred,
        svcMais.id,
        catalog.version,
        remaining.map((z) => ({
          id: z.id,
          name: z.name,
          audience: z.audience,
          durationMinutes: z.durationMinutes,
          priceCents: z.priceCents,
        })),
        { includeTodas: false, omitIds: pickedIds },
      )
      return finish({
        ...none('needs_info', {
          confirmationMessageId: confirmation.id,
          serviceId: svcMais.id,
        }),
        replyText: zoneAccumMaisBody(pickedZones),
        interactive,
        notes: 'DEC-178: Mais reabre Opções (já escolhidas omitidas).',
      })
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
    } else if (
      frameEarly.pending.slot !== 'eco' &&
      frameEarly.pending.slot !== 'audiencia' &&
      frameEarly.pending.slot !== 'acumular'
    ) {
      // DEC-137: Sim/Corrigir do eco não são escolha de horário (DEC-127).
      // DEC-178: Mais/Pronto tratados acima (zoneAccum).
      const choice = matchPendingChoice(turnText, frameEarly.pending)
      if (choice.kind === 'match') {
        if (frameEarly.pending.slot === 'horario') {
          const bound = slotBindingFromChoice(choice.key, choice.label)
          pendingTimeOverride = bound?.time ?? choice.key.match(/\d{2}:\d{2}/)?.[0] ?? null
          pendingDateOverride = bound?.date ?? frameEarly.date
        } else if (frameEarly.pending.slot === 'linha' && frameEarly.serviceId) {
          // Texto livre contra pending de linha (DEC-128) → intent choose_offered.
          runBookingUpdate(
            {
              type: 'choose_offered',
              slot: 'linha',
              line: choice.key === 'masculino' ? 'masculino' : 'feminino',
            },
            frameEarly.serviceId,
          )
        } else if (frameEarly.pending.slot === 'variantes' && frameEarly.serviceId) {
          const svcPending = services.find((s) => s.id === frameEarly.serviceId)
          // DEC-178: em `varias`, texto livre não fecha via pending — limpa e segue eco DEC-137.
          if (allowsMultipleVariants(svcPending?.variantSelection)) {
            saveSession({
              serviceId: frameEarly.serviceId,
              pending: null,
              lastOffer: null,
              phase: 'coletando',
            })
          } else {
          const active = svcPending?.zones.filter((z) => z.active) ?? []
          const scoped = zonesForAudienceLine(
            active,
            frameEarly.line,
          )
          const ids =
            choice.key === 'todas'
              ? scoped.map((z) => z.id)
              : [choice.key]
          runBookingUpdate(
            {
              type: 'choose_offered',
              slot: 'variantes',
              variantIds: ids,
              selectionMode: svcPending?.variantSelection,
            },
            frameEarly.serviceId,
          )
          }
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
  let session = deferred.peekSession(db, tenantId, input.conversationId)
  let frame = deferred.peekFrame(db, tenantId, input.conversationId)
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
  // A-08: «a segunda opção» / «a segunda» é ordinal de pending, não weekday.
  // scheduleFactsFromText e extractDates ainda vêem «segunda» — não remapear nesses.
  const ordinalOptionReply = (() => {
    const folded = norm(turnText).trim()
    if (/\b(proxima|feira|que\s+vem|amanha|hoje|depois de amanha)\b/.test(folded)) {
      return false
    }
    if (/\b(tem\s+horario|horarios?|disponiveis?|vagas?)\b/.test(folded)) return false
    if (
      /\b(na|para)\s+(a\s+)?(proxima\s+)?(segunda|terca|quarta|quinta|sexta|sabado|domingo)\b/.test(
        folded,
      )
    ) {
      return false
    }
    return /^(a\s+)?(primeira|segunda|terceira|quarta|quinta|1[aª.]?|2[aª.]?|3[aª.]?|4[aª.]?|5[aª.]?)(\s+(opcao|vez))?[\s!.?]*$/.test(
      folded,
    )
  })()
  // Dia civil do turno (texto completo): «próxima segunda» ≠ rótulo «segunda» sozinho
  // (em segunda-feira extractDates('segunda') cai no dia corrente).
  const turnDayAbsolute = (() => {
    if (!turnFacts.dayLabel || ordinalOptionReply) return null
    const todayCivil = clinicCivilDateFromUtc(tz, confirmation.created_at)
    const fromTurn = [...extractDates(turnText, todayCivil)]
    if (fromTurn.length === 1) return fromTurn[0]!
    return [...extractDates(turnFacts.dayLabel, todayCivil)][0] ?? null
  })()
  // Quando o dia civil muda, a hora sticky/histórica não vale — senão ready=true
  // reemite proposta no dia antigo (rsamp_fa7f138). Det.time do histórico («As 1330»)
  // também precisa cair; ver dropStickyTimeAfterDayRemap abaixo.
  let dropStickyTimeAfterDayRemap = false
  // rsamp_f3b49 / TR-528: «Na sexta na parte da manhã» após oferta de «amanhã à tarde»
  // — detectExplicitConfirmation não devolve dia (sem serviço no turno), o sticky
  // amanhã ficava, e só o período remapeava → «amanhã de manhã».
  if (session?.serviceId && turnFacts.dayLabel && turnFacts.period) {
    const dayAbsolute = turnDayAbsolute
    const stickyDate = frame?.date ?? date ?? null
    if (dayAbsolute != null && dayAbsolute !== stickyDate) {
      if (openProposal) {
        retireActiveProposal(db, tenantId, input.conversationId, clock)
      }
      saveSession({
        serviceId: session.serviceId,
        date: dayAbsolute,
        period: turnFacts.period,
        clockTime: null,
        pending: null,
        lastOffer: null,
      })
      session = deferred.peekSession(db, tenantId, input.conversationId)
      frame = deferred.peekFrame(db, tenantId, input.conversationId)
      date = dayAbsolute
      dropStickyTimeAfterDayRemap = true
      missing = missing.filter((item) => item !== 'dia')
    } else if (dayAbsolute != null) {
      date = dayAbsolute
      missing = missing.filter((item) => item !== 'dia')
    }
  }
  // rsamp_fa7f138: «Para a próxima segunda tem horário?» com proposta aberta (dia-só,
  // sem período). #688 exigia período; aqui o sticky date+hora (frame/histórico)
  // mantinha ready e repropunha o dia corrente. Remapear dia civil ≠ sticky,
  // limpar hora/pending e retirar a proposta — reoferta de slots no dia novo.
  // Não disparar em ordinal A-08 («a segunda opção»).
  const funnelServiceId = session?.serviceId ?? frame?.serviceId ?? null
  if (
    funnelServiceId &&
    turnFacts.dayLabel &&
    !turnFacts.period &&
    !ordinalOptionReply &&
    turnDayAbsolute != null
  ) {
    const stickyDate = frame?.date ?? date ?? null
    if (turnDayAbsolute !== stickyDate) {
      if (openProposal) {
        retireActiveProposal(db, tenantId, input.conversationId, clock)
      }
      saveSession({
        serviceId: funnelServiceId,
        date: turnDayAbsolute,
        period: null,
        clockTime: null,
        pending: null,
        lastOffer: null,
      })
      session = deferred.peekSession(db, tenantId, input.conversationId)
      frame = deferred.peekFrame(db, tenantId, input.conversationId)
      date = turnDayAbsolute
      dropStickyTimeAfterDayRemap = true
      missing = missing.filter((item) => item !== 'dia')
      if (!missing.includes('horario')) missing = [...missing, 'horario']
    }
  }
  // rsamp_1241995755: «hoje à tarde» no 1.º turno — period gravava no saveSession
  // cedo; date civil só em rememberDayPeriod (ready com hora) ou remap mid-funnel.
  if (
    turnDayAbsolute != null &&
    !ordinalOptionReply &&
    date == null &&
    (det.service?.id ?? session?.serviceId)
  ) {
    date = turnDayAbsolute
    missing = missing.filter((item) => item !== 'dia')
  }
  // Staging Paulo 09/11/2026: period=noite sticky após «Quer ver outro período?» —
  // «Sim» limpa o filtro e reoferta; troca de dia sem período novo também limpa.
  const askedOtherPeriod = Boolean(
    prevClinic?.body && /outro\s+per[ií]odo\?/i.test(prevClinic.body),
  )
  const SHORT_AFFIRM_OTHER_PERIOD =
    /^(sim|pode ser|pode marcar|pode agendar|pode|confirmo|ok|okay|beleza|blz|👍|bora|isso|certo)([\s,]+(pode\s+marcar|confirmo|sim))?[\s!.?]*$/i
  const affirmsOtherPeriod =
    askedOtherPeriod &&
    !turnFacts.period &&
    SHORT_AFFIRM_OTHER_PERIOD.test(turnText.trim())
  const dayChangesWithoutPeriod = Boolean(turnFacts.dayLabel) && !turnFacts.period
  // Só com period sticky: limpar filtro (e, se o dia mudou, gravar a data nova).
  // Sem period no quadro, não mexer em pending/lastOffer — mid-booking «para hoje»
  // (G-07c) reoferta sem este wipe.
  if (
    session?.serviceId &&
    session.period &&
    !turnFacts.period &&
    (affirmsOtherPeriod || dayChangesWithoutPeriod)
  ) {
    const todayCivil = clinicCivilDateFromUtc(tz, confirmation.created_at)
    const dayAbsolute =
      turnFacts.dayLabel != null
        ? [...extractDates(turnFacts.dayLabel, todayCivil)][0] ?? null
        : undefined
    saveSession({
      serviceId: session.serviceId,
      period: null,
      ...(dayAbsolute !== undefined ? { date: dayAbsolute } : {}),
      pending: null,
      lastOffer: null,
    })
    session = deferred.peekSession(db, tenantId, input.conversationId)
    frame = deferred.peekFrame(db, tenantId, input.conversationId)
    if (dayAbsolute) {
      date = dayAbsolute
      missing = missing.filter((item) => item !== 'dia')
    }
  }
  // Sibling #655: após «Quer ver outro dia?» / «outra data?», afirmação curta ou
  // período sem dia novo não deve reusar date sticky no offerNearestSlots.
  const askedOtherDay = Boolean(
    prevClinic?.body &&
      (/outro\s+dia\?/i.test(prevClinic.body) || /outra\s+data\?/i.test(prevClinic.body)),
  )
  const SHORT_AFFIRM_OTHER_DAY = SHORT_AFFIRM_OTHER_PERIOD
  const affirmsOtherDay =
    askedOtherDay && !turnFacts.dayLabel && SHORT_AFFIRM_OTHER_DAY.test(turnText.trim())
  const periodOnlyAfterOtherDay =
    askedOtherDay && Boolean(turnFacts.period) && !turnFacts.dayLabel
  // date vive no BookingFrame (não na vista ScheduleSession).
  const stickyDate = frame?.date ?? null
  if (
    session?.serviceId &&
    stickyDate &&
    (affirmsOtherDay || periodOnlyAfterOtherDay)
  ) {
    saveSession({
      serviceId: session.serviceId,
      date: null,
      ...(turnFacts.period ? { period: turnFacts.period } : {}),
      pending: null,
      lastOffer: null,
    })
    session = deferred.peekSession(db, tenantId, input.conversationId)
    frame = deferred.peekFrame(db, tenantId, input.conversationId)
    // Não reaplicar det.date (pode vir do prevClinic «…(15/11)…» na copy vazia).
    date = undefined
    missing = missing.filter((item) => item !== 'dia')
  }
  // Silencioso 1 (Paulo 09/11/2026): Sim do eco não herda period sticky de
  // *tentativa anterior* (ex. noite vazia). Se a cliente nomeou o período antes
  // do eco nesta tentativa («sexta à tarde»), mantém — DEC-127 / hora solta.
  if (
    zoneEcho === 'confirm' &&
    session?.serviceId &&
    session.period &&
    !turnFacts.period
  ) {
    const stickyPeriod = session.period
    const namedBeforeEco = older
      .filter((m) => m.direction === 'inbound')
      .some((m) => scheduleFactsFromText(m.body).period === stickyPeriod)
    if (!namedBeforeEco) {
      saveSession({
        serviceId: session.serviceId,
        period: null,
        pending: null,
        lastOffer: null,
      })
      session = deferred.peekSession(db, tenantId, input.conversationId)
      frame = deferred.peekFrame(db, tenantId, input.conversationId)
    }
  }
    const rememberDayPeriod = (serviceId: string) => {
    // A-08: ordinal «a segunda opção» não grava weekday no quadro.
    const dayLabel = ordinalOptionReply ? undefined : turnFacts.dayLabel
    if (!dayLabel && !turnFacts.period) return
    const today = clinicCivilDateFromUtc(tz, confirmation.created_at)
  const absolute =
    dayLabel != null
      ? [...extractDates(turnText, today)][0] ??
        [...extractDates(dayLabel, today)][0] ??
        null
      : undefined
    // Novo dia/período invalida pending/lastOffer anteriores (nova oferta a seguir).
    // day_label deixa de ser gravado (#472 cutover); só date/period absolutos.
    // Dia novo sem período nomeado: limpa period sticky (não herdar «noite» no amanhã).
    saveSession({
      serviceId,
      ...(turnFacts.period
        ? { period: turnFacts.period }
        : dayLabel
          ? { period: null }
          : {}),
      ...(absolute !== undefined ? { date: absolute } : {}),
      pending: null,
      lastOffer: null,
    })
    if (absolute != null) {
      date = absolute
      missing = missing.filter((item) => item !== 'dia')
    }
  }
  if (pendingTimeOverride) {
    // Oferta viva no frame: identidade do serviço é a do quadro, não a do histórico
    // (detectExplicitConfirmation pode achar Massagem em turnos antigos — audit H1).
    const framePending = frame
    const liveFrameSvc =
      framePending?.serviceId &&
      (framePending.pending?.slot === 'horario' || Boolean(framePending.lastOffer))
        ? services.find((s) => s.id === framePending.serviceId)
        : undefined
    const pendingSvc =
      liveFrameSvc ??
      det.service ??
      (framePending?.serviceId
        ? services.find((s) => s.id === framePending.serviceId)
        : undefined)
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
    // Local após o guard: `session` é `let` e peekSession devolve nullável (TS18047).
    const live = session
    const stored = services.find((item) => item.id === live.serviceId)
    // «amanhã» / «na parte da manhã» não repetem o serviço. A sessão já o tem (CF-19 / A-02).
    // M5 / A-03: toque «Feminina»/«Masculina» (ou texto equivalente) continua o mesmo serviço.
    const dayContinues = Boolean(turnFacts.dayLabel) && !clockFromTurn
    const periodContinues =
      Boolean(turnFacts.period) &&
      !clockFromTurn &&
      Boolean(live.variantIds?.length || !stored?.zones.some((z) => z.active))
    const lineContinues = Boolean(explicitAudienceLine(turnText))
    const storedActive = stored?.zones.filter((zone) => zone.active) ?? []
    const storedPool =
      stored && needsAudienceLine(storedActive) && live.audienceLine
        ? zonesForAudienceLine(storedActive, live.audienceLine)
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
    // «Sim» a «Quer ver outro período?» continua o serviço (limpa period acima).
    const otherPeriodContinues = affirmsOtherPeriod
    // «Sim» / período-só a «Quer ver outro dia?» continua o serviço (date limpo acima).
    const otherDayContinues = affirmsOtherDay || periodOnlyAfterOtherDay
    if (
      stored &&
      (clockFromTurn ||
        namedNow ||
        catalogShortcutNow ||
        dayContinues ||
        periodContinues ||
        lineContinues ||
        echoContinues ||
        otherPeriodContinues ||
        otherDayContinues)
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
    const frameBound = frame
    const liveFrameSvc =
      frameBound?.serviceId &&
      (frameBound.pending?.slot === 'horario' || Boolean(frameBound.lastOffer))
        ? services.find((s) => s.id === frameBound.serviceId)
        : undefined
    const sessionSvcId = session?.serviceId
    const pendingSvc =
      liveFrameSvc ??
      det.service ??
      (sessionSvcId ? services.find((s) => s.id === sessionSvcId) : undefined) ??
      (frameBound?.serviceId
        ? services.find((s) => s.id === frameBound.serviceId)
        : undefined)
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
  let time = dropStickyTimeAfterDayRemap ? undefined : det.time
  if (
    !dropStickyTimeAfterDayRemap &&
    !time &&
    det.service &&
    session?.serviceId === det.service.id &&
    session.clockTime
  ) {
    time = session.clockTime
    missing = missing.filter((item) => item !== 'horario')
  }
  // Relógio neste turno (ex. «às 15») sobrevive ao remap de dia.
  if (!time && clockFromTurn) time = clockFromTurn
  // Hora pedida sem dia no quadro: o dia é o da proposta aberta, para a vaga
  // ser conferida sem gravar a hora nova (#577).
  // Após remap de dia (rsamp_fa7f138) a proposta antiga já caiu — não herdar o dia dela.
  if (
    !dropStickyTimeAfterDayRemap &&
    !date &&
    clockFromTurn &&
    openProposal &&
    det.service?.id === openProposal.serviceId
  ) {
    date = clinicCivilDateFromUtc(tz, openProposal.startsAt)
    missing = missing.filter((item) => item !== 'dia')
  }
  // Sim do eco de substituição: fecha o conjunto e segue para proposta nova
  // no dia e na hora da proposta suspensa (#576). Sim não marca.
  if (
    zoneEcho === 'confirm' &&
    openProposal &&
    det.service?.id === openProposal.serviceId &&
    !dropStickyTimeAfterDayRemap
  ) {
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
  // rsamp_fa7f138: pergunta de outro dia com hora sticky do histórico/oferta
  // não pode fechar `ready` no dia antigo — limpar hora e alinhar `date` local.
  if (
    funnelServiceId &&
    turnFacts.dayLabel &&
    !turnFacts.period &&
    !ordinalOptionReply &&
    turnDayAbsolute != null &&
    turnDayAbsolute !== (frame?.date ?? date ?? null)
  ) {
    const sid = det.service?.id ?? funnelServiceId
    saveSession({
      serviceId: sid,
      date: turnDayAbsolute,
      period: null,
      clockTime: null,
      pending: null,
      lastOffer: null,
    })
    session = deferred.peekSession(db, tenantId, input.conversationId)
    frame = deferred.peekFrame(db, tenantId, input.conversationId)
    date = turnDayAbsolute
    time = undefined
    dropStickyTimeAfterDayRemap = true
    missing = missing.filter((item) => item !== 'dia')
    if (!missing.includes('horario')) missing = [...missing, 'horario']
    if (det.service) {
      det = {
        ...det,
        ok: false,
        status: 'needs_info',
        date: turnDayAbsolute,
        time: undefined,
        missing,
      }
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
      // Funil activo = sessão do mesmo serviço. Sem isso (ex. fecho idle DEC-087),
      // inbound antigo («quero liberação») não pode escolher variante (#620 / F-09).
      const earlySameFunnel = Boolean(session && session.serviceId === det.service.id)
      const earlyFunnelOlder =
        earlySameFunnel && session
          ? older.filter(
              funnelMessageFilter(
                older,
                (m) => ({ direction: m.direction, at: m.created_at }),
                session.updatedAt,
              ),
            )
          : []
      // D3: polaridade («não quero X, só Y») antes do parser — a negação não reentra.
      const earlyPolarity = classifyVariantPolarity(turnText, mentionPool)
      const earlyPolarIds = resolvePolarityVariantIds(
        earlyPolarity,
        sessionIntact ? sessionIds : null,
      )
      const turnMention = mentionZones(turnText, mentionPool, det.service)
      // DEC-C3 / P1: leftover *só* (sem hora no turno) com obrigação `choose_slot`
      // → esclarecer; não option-miss de tipos. «09:00 e cotovelo» continua
      // option-miss (DEC-137: zona desconhecida a meio do pedido).
      if (
        dialogueObligation?.kind === 'choose_slot' &&
        turnMention.unrecognized &&
        turnMention.zones.length === 0 &&
        earlyPolarIds == null &&
        !clockFromTurn &&
        !pendingTimeOverride &&
        !input.boundSlot &&
        zoneEcho !== 'skip' &&
        zoneEcho !== 'confirm' &&
        zoneEcho !== 'correct' &&
        sessionIntact
      ) {
        // DEC-C3/C4: park → esclarecer → resume (pending/variante intactos).
        const clarified = realizeClarify({
          conversationId: input.conversationId,
          frame: frameEarly,
        })
        return finish({
          ...none('needs_info', {
            confirmationMessageId: confirmation.id,
            serviceId: det.service.id,
          }),
          replyText: clarified.replyText,
          notes: 'DEC-C3/C4: bare choose_slot leftover → esclarecer via stack (not option-miss).',
        })
      }
      // #510: Sim do eco ou quadro intacto sem menção nova → sem segundo parser.
      // Toque Opções (skip) com nomes no turnText continua a parsear.
      const frameOwnsVariants =
        zoneEcho === 'confirm' ||
        (sessionIntact &&
          zoneEcho !== 'correct' &&
          turnMention.zones.length === 0 &&
          !turnMention.unrecognized &&
          earlyPolarIds == null)
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
        : zonesChosenByClient(clientTurn, earlyFunnelOlder, mentionPool, det.service)
      let kept = chosen.zones
      let earlyAmbiguous = chosen.ambiguous
      // DEC-145 / staging: «tem»/«feira» na stop-list — pergunta de dia não dispara
      // «Não encontrei …» nem reaponta tipos com a variante já travada.
      const leftoverAsk =
        mention.unrecognized &&
        zoneEcho !== 'skip' &&
        zoneEcho !== 'confirm' &&
        zoneEcho !== 'correct' &&
        earlyPolarIds == null
      let mentionedForEarly = mention.zones
      if (zoneEcho === 'correct' || zoneEcho === 'confirm' || (frameOwnsVariants && sessionIntact)) {
        mentionedForEarly = []
      } else if (mention.zones.length > 0) {
        const seen = new Set<string>()
        earlyAmbiguous = mention.zones.some((zone) => {
          const key = zone.name.trim().toLocaleLowerCase('pt-BR')
          if (seen.has(key)) return true
          seen.add(key)
          return false
        })
      } else if (kept.length === 0 && !chosen.ambiguous && sessionIntact) {
        mentionedForEarly = []
      } else {
        mentionedForEarly = kept
      }
      const earlyUpdate =
        earlyPolarIds != null && zoneEcho !== 'correct' && zoneEcho !== 'confirm'
          ? runBookingUpdate(
              {
                type: 'select_variants',
                variantIds: earlyPolarIds,
                mode: 'replace',
                selectionMode: det.service.variantSelection,
                priorVariantIds: sessionIntact ? sessionIds : null,
              },
              det.service.id,
            )
          : runBookingUpdate(
              {
                type: 'admit_variants',
                mentionedIds: earlyAmbiguous ? [] : mentionedForEarly.map((z) => z.id),
                unrecognized: leftoverAsk,
                leftover: mention.leftover,
                ambiguous: earlyAmbiguous,
                zoneEcho: zoneEcho ?? null,
                timeAlreadyBound: Boolean(input.boundSlot || pendingTimeOverride || clockFromTurn),
                selectionMode: det.service.variantSelection,
                priorVariantIds: sessionIntact ? sessionIds : null,
              },
              det.service.id,
            )
      if (earlyUpdate.resolvedVariantIds?.length) {
        // Inclui `unresolved_variant` com matches (Paulo 10/11 opção 2): o quadro
        // já gravou o que casou; o funil só avança se não houver sobra.
        kept = mentionPool.filter((z) => earlyUpdate.resolvedVariantIds!.includes(z.id))
        chosen = { zones: kept, ambiguous: false }
      } else {
        kept = []
        chosen = { zones: [], ambiguous: earlyUpdate.reason === 'ambiguous_variants' }
      }
      saveSession({
        serviceId: det.service.id,
        ...(turnExplicit || frameLine ? { audienceLine: turnExplicit ?? frameLine } : {}),
        ...(turnDayAbsolute && !ordinalOptionReply ? { date: turnDayAbsolute } : date ? { date } : {}),
        ...(turnFacts.period ? { period: turnFacts.period } : {}),
        ...(clockFromTurn ? { clockTime: clockFromTurn } : {}),
      })
      const serviceIgnore = {
        ignoreWords: zoneMentionIgnore(det.service),
        selectionMode: det.service.variantSelection,
      }
      const multiVariants = allowsMultipleVariants(det.service.variantSelection)
      const contributed =
        Boolean(clockFromTurn) ||
        zonesNamedInText(turnText, pool.length > 0 ? pool : active, serviceIgnore).length > 0 ||
        zoneEcho === 'confirm' ||
        Boolean(input.boundSlot)
      // Sobra (leftoverAsk) nunca fecha marcação — mesmo com date+time+matches.
      if (!(date && time && kept.length > 0 && !chosen.ambiguous && contributed && !leftoverAsk)) {
        const plural = det.service.variantKindPlural?.trim() || ''
        const singular = det.service.variantKind?.trim() || ''
        const kindLabel = (
          multiVariants
            ? plural || singular || DEFAULT_OPTION_KIND_PLURAL
            : singular || plural || 'opção'
        ).toLocaleLowerCase('pt-BR')
        const earlyPhrase = multiVariants
          ? plural || !singular
            ? `as ${kindLabel}`
            : `a ${kindLabel}`
          : /^[aeiouáéíóúàâêôãõ]/i.test(kindLabel)
            ? `a ${kindLabel}`
            : `o ${kindLabel}`
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
          const kind = variantKindForAsk(det.service)
          const genericAsk = time
            ? askZonesReply(
                earlyPhrase,
                names,
                time,
                input.conversationId,
                kind,
                det.service.variantSelection,
              )
            : variantListQuestion(
                det.service.name,
                kind,
                zonePool,
                input.conversationId,
                { selectionMode: det.service.variantSelection },
              )
          if (mention.unrecognized) {
            const miss = askUnrecognizedZone(mention, zonePool, genericAsk, {
              conversationId: input.conversationId,
              emitOptionMiss: shouldEmitOptionMiss({
                obligation: dialogueObligation,
                unrecognizedLeftover: true,
                attemptedOptionMatch: true,
                timeInTurn: Boolean(clockFromTurn || pendingTimeOverride || input.boundSlot),
              }),
            })
            replyText = miss.text
            pushFriction(...miss.friction)
          } else {
            replyText = genericAsk
          }
          // T2: modo uma + cliente pediu «todas»/«tudo» (staging DEC-145).
          if (!multiVariants && claimsWholeCatalog(turnText)) {
            pushFriction(frictionModeUmaTodas(det.service.id))
          }
          // DEC-178: `varias` também envia Opções (toque → Mais|Pronto); `uma` sem Todas.
          // Texto livre + eco DEC-137 mantém-se em paralelo.
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
            { includeTodas: false },
          )
        } else if (!time) {
          // Período deste turno, ou o que o silencioso 1 deixou no quadro (nomeado antes do eco).
          const period =
            turnFacts.period ??
            (session?.serviceId === det.service.id ? session?.period : null)

          // Serviço sem variantes (ex. massagem): oferta de período com a data absoluta (#408 B-04).
          // CF-19 (#413): com serviço (e variantes) conhecidos, oferecer 2–3 horários reais
          // mesmo sem período — não perguntar «qual horário?» vazio.
          const canOffer =
            !chosen.ambiguous && (kept.length > 0 || active.length === 0)
          // DEC-137: zonas escritas num texto ainda não ecoado também pedem eco, mesmo quando o
          // texto é anterior a este turno (zonas ditas antes da linha, DEC-143).
          // DEC-145: só em modo `varias`.
          const turnNamed =
            mention.zones.length > 0 ||
            zonesChosenInClientTexts([turnText], mentionPool, serviceIgnore).zones.length > 0 ||
            (kept.length > 0 && !sessionIntact)
          const wantEcho =
            multiVariants &&
            canOffer &&
            zoneEcho !== 'skip' &&
            zoneEcho !== 'confirm' &&
            turnNamed
          if (wantEcho) {
            // DEC-137: texto livre ecoa o conjunto. Sim é que abre Horários.
            const echoed = presentZoneEcho(det.service.id, kept, det.service.variantSelection)
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
              order: slotOrderFromText(turnText),
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
            interactive = applyOfferSideEffects(
              deferred,
              det.service.id,
              catalog.version,
              offered,
              preferred,
              rememberOfferFrame,
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
            multiVariants &&
            substitution &&
            zoneEcho !== 'skip' &&
            zoneEcho !== 'confirm' &&
            zoneEcho !== 'correct'
          ) {
            // Hora já escolhida e data ainda fora do quadro: o eco da troca
            // vem antes da pergunta do dia (#576).
            const echoed = presentZoneEcho(det.service.id, kept, det.service.variantSelection)
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
        heldAudienceLine: heldAudienceLine(frame),
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
          pushFriction(...frictionForCatalogMiss(pedido))
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
              variantKindForAsk(svc),
              zoneNames,
              input.conversationId,
              { selectionMode: svc.variantSelection },
            )
            // DEC-178: Opções também em `varias` (Corrigir / re-ask).
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
              { includeTodas: false },
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
          // DEC-145: modo `uma` não fecha combinação vinda do extractor.
          const keptForMode =
            allowsMultipleVariants(svc.variantSelection) || kept.length <= 1 ? kept : []
          saveSession({
            serviceId: svc.id,
            ...(line ? { audienceLine: line } : {}),
            ...(keptForMode.length > 0 ? { variantIds: keptForMode.map((z) => z.id) } : {}),
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
          } else if (zonePool.length > 0 && keptForMode.length === 0) {
            // Não reutilizar booking.question de «linha» quando a audiência já veio
            // do hold DEC-142 (resolveBookingObject antigo ainda pedia F/M).
            const zoneAsk =
              booking.missing.includes('linha') && line
                ? null
                : booking.question
            replyText =
              zoneAsk ??
              variantListQuestion(
                svc.name,
                variantKindForAsk(svc),
                zonePool,
                input.conversationId,
                { selectionMode: svc.variantSelection },
              )
            // DEC-178: Opções em `varias` e `uma`.
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
              { includeTodas: false },
            )
          } else {
            const mention = mentionZones(turnText, zonePool, svc)
            const turnPicked =
              mention.zones.length > 0 ||
              zonesChosenInClientTexts([turnText], zonePool, {
                ignoreWords: zoneMentionIgnore(svc),
                selectionMode: svc.variantSelection,
              }).zones.length > 0
            if (
              mention.unrecognized &&
              zoneEcho !== 'skip' &&
              zoneEcho !== 'confirm'
            ) {
              const miss = askUnrecognizedZone(
                mention,
                zonePool,
                variantListQuestion(
                  svc.name,
                  variantKindForAsk(svc),
                  zonePool,
                  input.conversationId,
                  { selectionMode: svc.variantSelection },
                ),
                {
                  conversationId: input.conversationId,
                  emitOptionMiss: shouldEmitOptionMiss({
                    obligation: dialogueObligation,
                    unrecognizedLeftover: true,
                    attemptedOptionMatch: true,
                    timeInTurn: Boolean(clockFromTurn || pendingTimeOverride || input.boundSlot),
                  }),
                },
              )
              replyText = miss.text
              pushFriction(...miss.friction)
              if (
                !allowsMultipleVariants(svc.variantSelection) &&
                claimsWholeCatalog(turnText)
              ) {
                pushFriction(frictionModeUmaTodas(svc.id))
              }
              // DEC-178: Opções também após «Não encontrei…».
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
                { includeTodas: false },
              )
            } else {
            const resolvedRaw = mention.zones.length > 0 ? mention.zones : keptForMode
            const resolved =
              allowsMultipleVariants(svc.variantSelection) || resolvedRaw.length <= 1
                ? resolvedRaw
                : []
            const echoed =
              allowsMultipleVariants(svc.variantSelection) &&
              zoneEcho !== 'skip' &&
              zoneEcho !== 'confirm' &&
              zoneEcho !== 'correct' &&
              turnPicked &&
              resolved.length > 0
                ? presentZoneEcho(svc.id, resolved, svc.variantSelection)
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
            const offerPeriod =
              (turnFacts.period as DayPeriod | null) ??
              (session?.serviceId === svc.id ? (session.period as DayPeriod | null) : null)
            const offered = await offerNearestSlots({
              db,
              tenantId,
              service: svc,
              zones: resolved.length > 0 ? resolved : keptForMode,
              tz,
              clock,
              forecast: input.forecast,
              professionalId: preferred,
              date: date ?? null,
              period: offerPeriod,
              order: slotOrderFromText(turnText),
              limit: 3,
              conversationId: input.conversationId,
            })
            logPolicyShadow({
              tenantId,
              conversationId: input.conversationId,
              phase: 'cf19',
              current: offerPeriod
                ? { action: 'offer_slots', detail: 'period' }
                : { action: 'ask_empty_time' },
              proposed: {
                action: 'offer_slots',
                detail: offerPeriod ? 'period' : date ? 'date' : 'soonest',
              },
            })
            interactive = applyOfferSideEffects(
              deferred,
              svc.id,
              catalog.version,
              offered,
              preferred,
              rememberOfferFrame,
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
    runBookingUpdate({ type: 'set_audience_line', line: null }, svc.id)
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
    runBookingUpdate({ type: 'set_audience_line', line }, svc.id)
  }
  const scoped = needsAudienceLine(activeZones) ? zonesForAudienceLine(activeZones, line) : activeZones
  const mentionPool = scoped.length > 0 ? scoped : activeZones
  const sessionIds = sameFunnel && session?.variantIds?.length ? session.variantIds : []
  const fromSession = sessionIds.length
    ? mentionPool.filter((z) => sessionIds.includes(z.id))
    : []
  const sessionIntact = sessionIds.length > 0 && fromSession.length === sessionIds.length
  // D3: polaridade antes do admit — «não quero pernas» não reentra no conjunto.
  const readyPolarity = classifyVariantPolarity(turnText, mentionPool)
  const readyPolarIds = resolvePolarityVariantIds(
    readyPolarity,
    sessionIntact ? sessionIds : null,
  )
  const proposalMention = mentionZones(turnText, mentionPool, svc)
  // #510: eco Sim / toque Horários / Opções → quadro. Texto e histórico só
  // preenchem o que ainda falta; sessão suja («as duas» + catálogo inteiro)
  // não vence menções explícitas (axila e íntima).
  // #579: admissão de variantes é política do actualizador (inclui anti-`slotBound`).
  let mentionedForUpdate = proposalMention.zones
  let ambiguous = false
  if (zoneEcho === 'confirm' || input.boundSlot) {
    mentionedForUpdate = []
  } else if (proposalMention.zones.length > 0) {
    // Paulo 10/11 opção 2: com sobra, ainda assim admite o que casou (o
    // actualizador bloqueia proposta em `unrecognized`).
    const seen = new Set<string>()
    ambiguous = proposalMention.zones.some((zone) => {
      const key = zone.name.trim().toLocaleLowerCase('pt-BR')
      if (seen.has(key)) return true
      seen.add(key)
      return false
    })
  } else {
    const chosen = sameFunnel
      ? zonesChosenByClient(clientTurn, funnelOlder, scoped, svc)
      : zonesChosenByClient(clientTurn, [], scoped, svc)
    if (chosen.zones.length > 0 || chosen.ambiguous) {
      mentionedForUpdate = chosen.zones
      ambiguous = chosen.ambiguous
    } else if (sessionIntact) {
      mentionedForUpdate = []
    } else {
      mentionedForUpdate = chosen.zones
      ambiguous = chosen.ambiguous
    }
  }
  const variantUpdate =
    readyPolarIds != null && zoneEcho !== 'correct' && zoneEcho !== 'confirm' && !input.boundSlot
      ? runBookingUpdate(
          {
            type: 'select_variants',
            variantIds: readyPolarIds,
            mode: 'replace',
            selectionMode: svc.variantSelection,
            priorVariantIds: sessionIntact ? sessionIds : null,
          },
          svc.id,
        )
      : runBookingUpdate(
          {
            type: 'admit_variants',
            mentionedIds: ambiguous ? [] : mentionedForUpdate.map((z) => z.id),
            unrecognized: Boolean(
              proposalMention.unrecognized && zoneEcho !== 'skip' && readyPolarIds == null,
            ),
            leftover: readyPolarIds == null ? proposalMention.leftover : null,
            ambiguous,
            zoneEcho: zoneEcho ?? null,
            // Declarado de propósito: o actualizador IGNORA isto na sobra (#579).
            timeAlreadyBound: Boolean(input.boundSlot || pendingTimeOverride),
            selectionMode: svc.variantSelection,
            priorVariantIds: sessionIntact ? sessionIds : null,
          },
          svc.id,
        )
  // Sobra (#575 / opção 2): unresolved com matches grava no quadro, mas o funil
  // trata namedZones como vazio para perguntar a sobra (nunca Horários/proposta).
  const namedZones: typeof fromSession =
    variantUpdate.resolvedVariantIds?.length &&
    variantUpdate.reason !== 'unresolved_variant'
      ? mentionPool.filter((z) => variantUpdate.resolvedVariantIds!.includes(z.id))
      : []
  const echoLocked =
    variantUpdate.reason === 'echo_locked' || variantUpdate.reason === 'variants_preserved'
  if (echoLocked) ambiguous = false
  if (namedZones.length > 0 && !ambiguous) {
    // Relógio do turno: o actualizador não mistura temporal aqui (#577 à parte).
    saveSession({
      serviceId: svc.id,
      ...(clockFromTurn ? { clockTime: clockFromTurn } : { clockTime: time }),
    })
  } else if (clockFromTurn || time) {
    saveSession({ serviceId: svc.id, clockTime: clockFromTurn ?? time })
  }
  const plural = svc.variantKindPlural?.trim() || ''
  const singular = svc.variantKind?.trim() || ''
  const multiSvc = allowsMultipleVariants(svc.variantSelection)
  const kind = (
    multiSvc
      ? plural || singular || DEFAULT_OPTION_KIND_PLURAL
      : singular || plural || 'opção'
  ).toLocaleLowerCase('pt-BR')
  const phrase = multiSvc
    ? plural || !singular
      ? `as ${kind}`
      : `a ${kind}`
    : /^[aeiouáéíóúàâêôãõ]/i.test(kind)
      ? `a ${kind}`
      : `o ${kind}`
  const kindForAct = variantKindForAsk(svc)
  if (activeZones.length > 0 && (namedZones.length === 0 || ambiguous)) {
    const zonePool = scoped.length > 0 ? scoped : activeZones
    const names = stableVariantLabelList(zonePool)
    // DEC-178: Opções em `varias` e `uma` (sem Todas); toque multi → Mais|Pronto.
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
      { includeTodas: false },
    )
    const genericAsk = askZonesReply(
      phrase,
      names,
      time,
      input.conversationId,
      kindForAct,
      svc.variantSelection,
    )
    let replyForZones = genericAsk
    if (proposalMention.unrecognized && !ambiguous) {
      const miss = askUnrecognizedZone(proposalMention, zonePool, genericAsk, {
        conversationId: input.conversationId,
        emitOptionMiss: shouldEmitOptionMiss({
          obligation: dialogueObligation,
          unrecognizedLeftover: true,
          attemptedOptionMatch: true,
          timeInTurn: Boolean(clockFromTurn || pendingTimeOverride || input.boundSlot),
        }),
      })
      replyForZones = miss.text
      pushFriction(...miss.friction)
    }
    if (!multiSvc && claimsWholeCatalog(turnText)) {
      pushFriction(frictionModeUmaTodas(svc.id))
    }
    return finish({
      ...none('needs_info', { ...base, serviceId: svc.id, date, time }),
      // REQ-088 / AC-60: pergunta determinística — não depender do modelo nem silenciar.
      // #509: sobra sem match único → «Não encontrei {palavra}…» (copy proposta).
      replyText: replyForZones,
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
  // DEC-145: eco só em modo `varias`.
  const echoBeforeProposal = !clockFromTurn || proposalMention.approx
  if (
    allowsMultipleVariants(svc.variantSelection) &&
    echoBeforeProposal &&
    zoneEcho !== 'skip' &&
    zoneEcho !== 'confirm' &&
    zoneEcho !== 'correct' &&
    namedZones.length > 0 &&
    !ambiguous &&
    proposalMention.zones.length > 0
  ) {
    const echoed = presentZoneEcho(svc.id, namedZones, svc.variantSelection)
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
    const replyText =
      activeZones.length > 0
        ? askZonesReply(
            phrase,
            stableVariantLabelList(scoped.length > 0 ? scoped : activeZones),
            time,
            input.conversationId,
            kindForAct,
            svc.variantSelection,
          )
        : teamConfirmsSoonReply(svc.name, time, input.conversationId)
    // TR-487: «A equipe confirma em seguida» → alerta sem pausa.
    if (activeZones.length === 0) {
      promiseTeamFollowUp(
        db,
        tenantId,
        {
          conversationId: conv.id,
          detailText: `Não deu para calcular ${svc.name}: ${message}. A IA prometeu retorno da equipe.`,
        },
        clock,
      )
    }
    return finish({
      ...none('needs_info', { ...base, serviceId: svc.id, date, time }),
      // Não silenciar: o modelo pode ter deixado a mensagem vazia à espera da proposta.
      replyText,
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
    // #577 / #579: hora sem vaga não substitui a oferta — política no actualizador.
    runBookingUpdate(
      {
        type: 'admit_temporal',
        time: time,
        date,
        vacancy: 'unavailable',
        openProposalClock: openOffer
          ? {
              date: clinicCivilDateFromUtc(tz, openOffer.startsAt),
              time: localHHMM(tz, openOffer.startsAt),
            }
          : null,
      },
      openOffer?.serviceId ?? svc.id,
    )
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
    // TR-487 / DEC-125: copy promete retorno → alerta sem pausa (não notifyHumanHandoff).
    promiseTeamFollowUp(
      db,
      tenantId,
      {
        conversationId: conv.id,
        detailText: `Capacidade pausada: pedido de ${label}. A IA prometeu que a equipe confirma o horário.`,
      },
      clock,
    )
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
    if (!delivered) {
      // TR-487 / DEC-125: «equipe vai te responder» → alerta sem pausa.
      promiseTeamFollowUp(
        db,
        tenantId,
        {
          conversationId: conv.id,
          detailText: `Envio da proposta ${proposal.id} falhou (${sent.status}). A IA prometeu retorno da equipe.`,
        },
        clock,
      )
    }
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
    promiseTeamFollowUp(
      db,
      tenantId,
      {
        conversationId: conv.id,
        detailText: `Falha ao montar/enviar proposta para ${label}. A IA prometeu retorno da equipe.`,
      },
      clock,
    )
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
