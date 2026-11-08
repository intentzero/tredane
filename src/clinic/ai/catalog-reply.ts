/**
 * Respostas de catálogo sem modelo: preço com duração, expediente com o vão,
 * quem faz, zona antes do horário. Copy via catálogo M4 (#448). Sem sala/buffer (DEC-090).
 */
import { formatBRL } from '../../ai/prompt'
import type { Clock } from '../../db/clock'
import { currentClientTurnText, explicitAudienceLine } from '../catalog/audience'
import { allowsMultipleVariants } from '../catalog/variant-selection'
import { listEffectiveWeeklyWindows } from '../config/availability'
import { listResources } from '../config/resources'
import { listServices } from '../config/services'
import { ensureClinicSettings } from '../config/settings'
import type { ServiceRow } from '../config/types'
import { textCitesSynonym } from '../config/synonyms'
import { recordUnmatchedTerm } from '../config/unmatched-terms'
import { resolveZoneMention, textNamesMixAudiences, variantAudiencesConflict, zonesNamedInText } from '../config/zones'
import { listMessages } from '../inbox/messages'
import { clinicCivilDateFromUtc } from '../scheduling/timezone'
import type { ClinicDb } from '../store'
import {
  catalogMissHint,
  catalogServiceList,
  resolveBookingObject,
} from './booking-object'
import {
  mixedAudienceReply,
  serviceChangedReply,
  serviceNotFoundReply,
} from './client-copy'
import { isCatalogInfoAsk, isShortBookingAffirm } from './booking-intent-text'
import { sayAct } from './dialogue-acts'
import { audienceLineFromClientTexts, citesServiceName, zonesChosenInClientTexts } from './schedule-choice'
import { formatOpeningHours } from './schedule-context'
import {
  funnelMessageFilter,
  getBookingFrame,
  getScheduleSession,
  heldAudienceLine,
  saveScheduleSession,
  type ScheduleAudienceLine,
  scheduleFactsFromText,
  type ScheduleSessionPatch,
} from './schedule-session'
import {
  audienceLineQuestion,
  needsAudienceLine,
  variantKindForAsk,
  variantListQuestion,
  zonesForAudienceLine,
} from './variant-line'
import { extractDates, parseTemporal } from './nlu/temporal'

const HOURS = /\b(hor[aá]rio de funcionamento|que horas (voc[eê]s )?(abrem|funcionam|atendem)|at[eé] que horas)\b/i
const WHO = /\b(quem faz|quem atende|qual sala|em qual sala)\b/i
const PRICE = /\b(pre[cç]o|custa|valor|quanto)\b/i
const PERIOD = /\b(amanh[aã]|hoje|segunda|ter[cç]a|quarta|quinta|sexta|s[aá]bado|domingo|manh[aã]|tarde|noite)\b/i
/** `\b` antes de «às» falha no JS (à não é word-char); usar fronteira ASCII. */
const CLOCK =
  /(?:^|[^a-z0-9])(?:[aà]s\s+\d{1,2}(?:h(?:rs|s)?(?:\d{2})?)?|\d{1,2}[:h]\d{2}|\d{3,4})\b/i
const SHORT_CONFIRM =
  /^(sim|pode ser|pode marcar|pode agendar|pode|confirmo|ok|okay|beleza|blz|👍|bora)([,\s]+(pode\s+marcar|confirmo|sim))?[\s!.?]*$/i

function proNames(db: ClinicDb, tenantId: string, service: ServiceRow, clock: Clock): string[] {
  const resources = listResources(db, tenantId, clock)
  return service.professionalIds
    .map((id) => resources.find((r) => r.id === id)?.name)
    .filter((n): n is string => Boolean(n))
}

function poolFor(services: ServiceRow[], text: string): ServiceRow[] {
  const named = services.filter((s) => text.toLowerCase().includes(s.name.trim().toLowerCase()))
  if (named.length > 0) return named
  return services.length === 1 ? services : services
}

function serviceFromNamedZones(services: ServiceRow[], source: string): ServiceRow | undefined {
  const hits = services.filter((service) => {
    const named = zonesNamedInText(
      source,
      service.zones.filter((zone) => zone.active),
      { ignoreWords: [service.name, ...(service.synonyms ?? [])] },
    )
    return named.length > 0
  })
  return hits.length === 1 ? hits[0] : undefined
}

function namedServices(services: ServiceRow[], text: string): ServiceRow[] {
  const folded = text.toLowerCase()
  const exact = services.filter((service) => {
    const name = service.name.trim().toLowerCase()
    return name.length > 0 && folded.includes(name)
  })
  if (exact.length > 0) return exact
  // #509 / DEC-110: sinónimo da ficha («depilar» → Depilação).
  const bySynonym = services.filter((service) =>
    (service.synonyms ?? []).some((syn) => textCitesSynonym(text, syn)),
  )
  if (bySynonym.length > 0) return bySynonym
  return services.filter((service) => citesServiceName(text, service.name))
}

function mixedAudienceRefusal(
  services: ServiceRow[],
  source: string,
  conversationId: string,
  session: ReturnType<typeof getScheduleSession> | null,
  heldLine: ScheduleAudienceLine | null = null,
): string | null {
  for (const service of services) {
    const active = service.zones.filter((zone) => zone.active)
    const mixed = needsAudienceLine(active)
    const carried = session?.serviceId === service.id ? session.audienceLine : heldLine
    const line = mixed ? (explicitAudienceLine(source) ?? carried) : null
    // Linha travada → só variantes dessa linha (e ambos), como Opções / DEC-079.
    const scoped = mixed && line ? zonesForAudienceLine(active, line) : active
    const named = zonesNamedInText(source, scoped, {
      ignoreWords: [service.name, ...(service.synonyms ?? [])],
    })
    if (textNamesMixAudiences(source, named)) {
      return mixedAudienceReply(conversationId)
    }
  }
  return null
}

/** «às 3» sem manhã/tarde/noite não é 03:00. 8–23 e HH:MM ficam como estão. */
function ambiguousAfternoonHour(text: string, conversationId: string): string | null {
  const hour = parseTemporal(text, { civilDate: '1970-01-01' }).ambiguousAfternoonHour
  if (hour == null) return null
  const hora24 = `${String(hour + 12).padStart(2, '0')}:00`
  const fallback = `Às ${hour} da tarde seria ${hora24}. É esse horário?`
  return sayAct('confirmar_hora_ambigua', conversationId, { hora24 }, fallback)
}

function clientSource(
  db: ClinicDb,
  tenantId: string,
  body: string,
  conversationId?: string,
  turn?: { messages: Array<{ direction: string; body: string }>; turnText: string },
): string {
  if (turn?.turnText.trim()) return turn.turnText.trim()
  if (!conversationId) return body
  const { messages } = listMessages(db, tenantId, { conversationId, limit: 40 })
  const text = currentClientTurnText(messages.map((message) => ({ direction: message.direction, body: message.body })))
  return text.trim() || body
}

/**
 * A cliente já nomeou zonas (e a linha, se o serviço a exige) e ainda não disse
 * dia nem horário. Grava a escolha na sessão e devolve null para o autodraft
 * seguir ao `tryAiAutoBook`, que oferece slots reais com a lista interativa
 * **Horários** (DEC-135) — igual ao caminho do toque em Opções/Todas.
 * Antes devolvia só `perguntar_horario` em prosa + «Falar com a equipe».
 */
function zoneNameRepeated(zones: readonly { name: string }[]): boolean {
  const seen = new Set<string>()
  for (const zone of zones) {
    const key = zone.name.trim().toLocaleLowerCase('pt-BR')
    if (seen.has(key)) return true
    seen.add(key)
  }
  return false
}

/** @returns true se gravou variantes e o catálogo deve ceder o turno ao autobook. */
function rememberZonesWhenKnown(
  db: ClinicDb,
  tenantId: string,
  services: ServiceRow[],
  source: string,
  session: ReturnType<typeof getScheduleSession>,
  heldLine: ScheduleAudienceLine | null,
  clock: Clock,
  conversationId: string | undefined,
  turn?: { messages: Array<{ direction: string; body: string }> },
  deferredFrame?: import('./deferred-booking-frame').DeferredBookingFrame,
): boolean {
  if (PRICE.test(source) || PERIOD.test(source) || CLOCK.test(source)) return false
  const held = session ? services.find((service) => service.id === session.serviceId) : undefined
  const svc = held ?? serviceFromNamedZones(services, source)
  if (!svc) return false
  const active = svc.zones.filter((zone) => zone.active)
  if (active.length === 0) return false
  const mixed = needsAudienceLine(active)
  const prior = turn
    ? turn.messages
        .filter((message) => message.direction === 'inbound')
        .map((message) => message.body)
        .reverse()
    : conversationId
      ? listMessages(db, tenantId, { conversationId, limit: 40 })
          .messages.filter((message) => message.direction === 'inbound')
          .map((message) => message.body)
          .reverse()
      : []
  const carried = session && session.serviceId === svc.id ? session.audienceLine : heldLine
  const line = mixed ? (explicitAudienceLine(source) ?? carried ?? audienceLineFromClientTexts(prior)) : null
  if (mixed && !line) return false
  // Horário já guardado: o autobook fecha a proposta. Não alterar a sessão aqui.
  if (session?.clockTime) return false
  const scoped = mixed ? zonesForAudienceLine(active, line) : active
  const mention = resolveZoneMention(source, scoped, {
    ignoreWords: [svc.name, ...(svc.synonyms ?? [])],
  })
  // DEC-137 / #509: sobra não resolvida — cede ao autobook sem gravar o conjunto parcial.
  if (mention.unrecognized) return true
  const named = mention.zones
  // D4 bridge: «Quanto custa a Liberação…?» não grava variante; «Quero» a seguir
  // trava a única variante citada na pergunta imediata e cede ao autobook (slots).
  if (
    named.length === 0 &&
    isShortBookingAffirm(source) &&
    conversationId &&
    !(session?.variantIds && session.variantIds.length > 0 && session.serviceId === svc.id)
  ) {
    const previous = prior.find((body) => body.trim() && body.trim() !== source.trim())
    if (previous && isCatalogInfoAsk(previous)) {
      const quoted = zonesNamedInText(previous, scoped, {
        ignoreWords: [svc.name, ...(svc.synonyms ?? [])],
      })
      if (
        quoted.length === 1 &&
        !variantAudiencesConflict(quoted) &&
        !zoneNameRepeated(quoted)
      ) {
        const patch: ScheduleSessionPatch = {
          serviceId: svc.id,
          variantIds: [quoted[0]!.id],
        }
        if (line) patch.audienceLine = line
        // Grava já: o catálogo cede com `null` e o deferred do autodraft
        // não é flushed — o tryAiAutoBook precisa do tipo no quadro.
        saveScheduleSession(db, tenantId, conversationId, patch, clock)
        return true
      }
    }
  }
  if (named.length === 0 || variantAudiencesConflict(named) || zoneNameRepeated(named)) return false
  if (conversationId) {
    const patch: ScheduleSessionPatch = {
      serviceId: svc.id,
      variantIds: named.map((zone) => zone.id),
    }
    if (line) patch.audienceLine = line
    if (deferredFrame) deferredFrame.save(patch)
    else saveScheduleSession(db, tenantId, conversationId, patch, clock)
  }
  // Cede ao tryAiAutoBook (DEC-135): evita mixedAudienceRefusal sem linha e o
  // perguntar_horario em prosa que só levava «Falar com a equipe».
  return true
}

/** Texto determinístico, ou null para seguir o modelo / a proposta. */
export function catalogReply(
  db: ClinicDb,
  tenantId: string,
  text: string,
  clock: Clock,
  opts: {
    conversationId?: string
    turn?: {
      catalog: {
        version?: string
        services: ServiceRow[]
        resources: import('../config/types').ResourceRow[]
      }
      messages: Array<{ direction: string; body: string; createdAt?: number }>
      turnText: string
      session: ReturnType<typeof getScheduleSession>
    }
    /** ADR-0015: acumula frame para a mesma TX do outbound. */
    deferredFrame?: import('./deferred-booking-frame').DeferredBookingFrame
  } = {},
): string | null {
  const body = text.trim()
  if (!body) return null
  const deferred = opts.deferredFrame
  const catalogVersion = opts.turn?.catalog.version
  const saveSession = (conversationId: string, patch: ScheduleSessionPatch) => {
    const stamped =
      catalogVersion != null && catalogVersion !== ''
        ? { ...patch, catalogVersion: patch.catalogVersion ?? catalogVersion }
        : patch
    if (deferred) deferred.save(stamped)
    else saveScheduleSession(db, tenantId, conversationId, stamped, clock)
  }
  const cnv = opts.conversationId ?? ''
  const services = opts.turn?.catalog.services ?? listServices(db, tenantId).filter((s) => s.active)
  if (HOURS.test(body) && !PRICE.test(body)) {
    const resources = opts.turn?.catalog.resources ?? listResources(db, tenantId, clock)
    const pros = new Set(
      resources.filter((r) => r.kind === 'professional').map((r) => r.id),
    )
    const lines = formatOpeningHours(
      listEffectiveWeeklyWindows(db, tenantId)
        .filter((w) => pros.has(w.resourceId))
        .map((w) => ({ dayOfWeek: w.dayOfWeek, startMinute: w.startMinute, endMinute: w.endMinute })),
    )
    const lista = lines.join('\n')
    const fallback = `Funcionamos assim:\n${lista}`
    return sayAct('informar_expediente', cnv, { lista }, fallback)
  }

  const source = clientSource(db, tenantId, body, opts.conversationId, opts.turn)
  // Sessão: relê sempre (gravações no mesmo turno invalidam o snapshot do TurnContext).
  const session = opts.conversationId ? getScheduleSession(db, tenantId, opts.conversationId) : null
  // CF-45 / DEC-142: audiência fixada pela consulta de catálogo, sem serviço em jogo.
  const heldLineNow = opts.conversationId
    ? heldAudienceLine(getBookingFrame(db, tenantId, opts.conversationId))
    : null
  const explicit = explicitAudienceLine(source)
  const targets = poolFor(services, body)
  const who = WHO.test(body)
  if (who) {
    // DEC-090: a sala é organização interna — nunca nomear sala ao cliente.
    const people = [
      ...new Set(
        targets.flatMap((s) => {
          const names = opts.turn
            ? opts.turn.catalog.resources
                .filter((r) => r.kind === 'professional' && s.professionalIds.includes(r.id))
                .map((r) => r.name)
            : proNames(db, tenantId, s, clock)
          return names
        }),
      ),
    ]
    const pessoas = people.length > 0 ? people.join(', ') : 'a equipe'
    const fallback =
      people.length > 0
        ? targets.map((s) => {
            const names = opts.turn
              ? opts.turn.catalog.resources
                  .filter((r) => r.kind === 'professional' && s.professionalIds.includes(r.id))
                  .map((r) => r.name)
              : proNames(db, tenantId, s, clock)
            return `${s.name}: ${names.length > 0 ? names.join(', ') : 'a equipe confirma quem atende'}.`
          }).join('\n')
        : 'A equipe confirma quem atende.'
    return sayAct('informar_quem_faz', cnv, { pessoas }, fallback)
  }

  const namedService = namedServices(services, source)
  const namedPick =
    namedService.find((service) => service.zones.some((zone) => zone.active)) ?? namedService[0]
  const held = session ? services.find((service) => service.id === session.serviceId) : undefined
  const inPlay = namedPick ?? held ?? serviceFromNamedZones(services, source)
  const fallback = targets.find((service) => service.zones.some((zone) => zone.active)) ?? targets[0]
  const svc = inPlay ?? fallback

  const afternoon = ambiguousAfternoonHour(body, cnv)
  if (afternoon) return afternoon

  const asksPrice = PRICE.test(source)
  const openPeriod = PERIOD.test(source) && !CLOCK.test(source)
  const lineOnly = explicit != null && !asksPrice && !PERIOD.test(source) && !CLOCK.test(source)
  // Zonas já ditas, sem dia nem preço: grava a escolha e cede ao autodraft /
  // tryAiAutoBook (oferta de slots + lista Horários, DEC-135). Sai antes da
  // recusa de géneros sem linha (nomes homónimos F/M no catálogo completo).
  if (
    rememberZonesWhenKnown(
      db,
      tenantId,
      services,
      source,
      session,
      heldLineNow,
      clock,
      opts.conversationId,
      opts.turn,
      deferred,
    )
  ) {
    return null
  }

  const mixedVisit = mixedAudienceRefusal(services, source, cnv, session, heldLineNow)
  if (mixedVisit) return mixedVisit

  // Handoffs e ambiguidade de serviço — sem roubar o funil de linha/zonas/dia.
  const bookingMatch = resolveBookingObject({
    text: source,
    services,
    session: session
      ? {
          serviceId: session.serviceId,
          audienceLine: session.audienceLine,
          variantIds: session.variantIds,
        }
      : null,
    conversationId: cnv,
  })
  if (bookingMatch.kind === 'handoff') {
    if (bookingMatch.handoffReason === 'terceiro') {
      // Allowlist (#448 / leva 3): decisão DEC-083 vs frase própria — fora do catálogo.
      return 'Para agendar para outra pessoa, a equipe precisa continuar este atendimento.'
    }
    if (bookingMatch.handoffReason === 'multiplos_servicos') {
      const fb = 'Neste momento marcamos um serviço de cada vez. Qual você quer primeiro?'
      return sayAct('varios_servicos', cnv, {}, fb)
    }
    // Hora / «sim» / período: deixa o autobook seguir; não declarar «inexistente».
    if (
      bookingMatch.handoffReason === 'inexistente' &&
      !CLOCK.test(body) &&
      !PERIOD.test(source) &&
      !SHORT_CONFIRM.test(body.trim())
    ) {
      // Prática 10 / #512: dizer o que faltou + opções reais; sem link Google.
      const pedido = catalogMissHint(source, services)
      // DEC-141: o termo (só ele) vira sugestão de sinónimo para a owner.
      recordUnmatchedTerm(db, tenantId, pedido, clock)
      return serviceNotFoundReply(cnv, {
        pedido,
        lista: catalogServiceList(services),
      })
    }
    if (bookingMatch.handoffReason === 'historico_indisponivel') {
      const fb = 'Não tenho o detalhe da sua visita anterior aqui. Qual serviço você quer agora?'
      return sayAct('historico_indisponivel', cnv, {}, fb)
    }
    if (bookingMatch.handoffReason === 'catalogo_vazio') {
      return serviceChangedReply(cnv)
    }
  }
  // Clarify de serviço só com intenção de marcar/agendar — «oi» / «fazem pacote…» ficam no extrator.
  // Pergunta curta «Vocês fazem botox?» fecha antes via handoff `inexistente` (#512).
  const bookingIntent =
    /\b(quero|gostaria|marcar|agendar|horario|horário|disponi|vaga|fazer|preciso)\b/i.test(source)
  if (
    bookingMatch.kind === 'clarify' &&
    bookingMatch.question &&
    bookingMatch.missing.includes('servico') &&
    bookingIntent &&
    !inPlay &&
    !asksPrice &&
    !openPeriod &&
    !CLOCK.test(body) &&
    !CLOCK.test(source) &&
    !SHORT_CONFIRM.test(body.trim())
  ) {
    if (opts.conversationId && bookingMatch.serviceId) {
      saveSession(opts.conversationId, { serviceId: bookingMatch.serviceId })
    }
    return bookingMatch.question
  }

  // E-01 / E-07 / C-12: preço ou duração de serviço sem variantes — antes do early-return.
  const asksDuration = /\b(dura|dura[cç][aã]o|tempo|minutos)\b/i.test(source)
  if ((asksPrice || asksDuration) && svc) {
    const activeZones = svc.zones.filter((zone) => zone.active)
    if (activeZones.length === 0) {
      if (asksPrice) {
        if (svc.priceCents == null) {
          return sayAct(
            'informar_preco_sem_cadastro',
            cnv,
            {},
            'A equipe confirma o valor.',
          )
        }
        const preço = formatBRL(svc.priceCents)
        const duração = String(svc.durationMinutes)
        const fb = `${preço}, ${duração} min. Quer que eu veja horários?`
        return sayAct('informar_preco', cnv, { preço, duração }, fb)
      }
      const duração = String(svc.durationMinutes)
      return sayAct('informar_duracao', cnv, { duração }, `${duração} min.`)
    }
  }

  if (!asksPrice && !openPeriod && !lineOnly) return null
  if (!svc) return null

  const active = svc.zones.filter((zone) => zone.active)
  const mixed = needsAudienceLine(active)
  // A linha só entra quando o serviço já está em jogo. Sem isso, não lista zonas duplicadas.
  if (mixed && !inPlay) return null

  const facts = scheduleFactsFromText(source)
  const sameFunnel = Boolean(session && session.serviceId === svc.id)
  // listMessages devolve ordem cronológica; filtramos ao início do funil e invertemos (mais novo primeiro).
  const historyMsgs =
    opts.turn?.messages ??
    (opts.conversationId
      ? listMessages(db, tenantId, { conversationId: opts.conversationId, limit: 40 }).messages
      : [])
  const inFunnel =
    sameFunnel && session
      ? funnelMessageFilter(
          historyMsgs,
          (message) => ({ direction: message.direction, at: message.createdAt ?? 0 }),
          session.updatedAt,
        )
      : null
  const funnelInboundNewestFirst = historyMsgs
    .filter((message) => message.direction === 'inbound' && (!inFunnel || inFunnel(message)))
    .map((message) => message.body)
    .reverse()
  const inboundNewestFirst = [source, ...funnelInboundNewestFirst.filter((body) => body !== source)]
  const carried = sameFunnel && session ? session.audienceLine : heldLineNow
  // Histórico só no funil activo (sessão do serviço). Após DEC-086 a sessão foi limpa.
  const historyLine = sameFunnel ? audienceLineFromClientTexts(inboundNewestFirst) : null
  const line = mixed ? (explicit ?? carried ?? historyLine) : null
  if (opts.conversationId && inPlay) {
    const patch: ScheduleSessionPatch = { serviceId: inPlay.id }
    if (explicit || (mixed && line)) patch.audienceLine = line
    else if (mixed && !line) patch.audienceLine = null
    // #472: day_label deixa de ser gravado — resolver data absoluta (CF-21).
    if (facts.dayLabel) {
      const settings = ensureClinicSettings(db, tenantId, clock)
      const tz = settings.timezone || 'America/Sao_Paulo'
      const today = clinicCivilDateFromUtc(tz, clock.nowMs())
      const absolute = [...extractDates(facts.dayLabel, today)][0] ?? null
      if (absolute) patch.date = absolute
    }
    if (facts.period) patch.period = facts.period
    const sameService = session?.serviceId === inPlay.id
    const lineChanging =
      patch.audienceLine !== undefined &&
      patch.audienceLine !== (sameService ? session?.audienceLine : null)
    const existingDate = sameService
      ? (db.get<{ date: string | null }>(
          `SELECT date FROM schedule_sessions WHERE tenant_id = ? AND conversation_id = ?`,
          tenantId,
          opts.conversationId,
        )?.date ?? null)
      : null
    const dayChanging = patch.date !== undefined && patch.date !== existingDate
    const periodChanging = patch.period !== undefined && patch.period !== session?.period
    if (lineChanging || dayChanging || periodChanging || !sameService) {
      saveSession(opts.conversationId, patch)
    }
  }

  if (active.length > 0 && mixed && !line) return audienceLineQuestion(svc.name, cnv)

  const scoped = mixed ? zonesForAudienceLine(active, line) : active
  const serviceIgnore = {
    ignoreWords: [svc.name, ...(svc.synonyms ?? [])],
    selectionMode: svc.variantSelection,
  }
  const namedRaw = scoped.length > 0 ? zonesNamedInText(source, scoped, serviceIgnore) : []
  // DEC-145: modo `uma` não fecha combinação de vários nomes.
  const named =
    allowsMultipleVariants(svc.variantSelection) || namedRaw.length <= 1 ? namedRaw : []
  const namedOk = named.length > 0 && !variantAudiencesConflict(named)
  // D4 / PR-D: pergunta de preço ou duração NÃO grava variante no quadro de marcação.
  // O adaptador responde o catálogo; ask_info fica implícito (sem write).
  if (opts.conversationId && inPlay && namedOk && !asksPrice && !asksDuration) {
    saveSession(opts.conversationId, {
      serviceId: inPlay.id,
      variantIds: named.map((zone) => zone.id),
    })
  }
  const chosenEarlier =
    sameFunnel && scoped.length > 0
      ? zonesChosenInClientTexts(inboundNewestFirst, scoped, serviceIgnore)
      : { zones: [] as typeof scoped, ambiguous: false }
  // A gravação da sessão não avança updated_at no mesmo serviço, então a mensagem
  // que escolheu as zonas pode ficar de fora da janela. Os ids da sessão contam.
  const sessionZones =
    sameFunnel && session?.variantIds?.length && scoped.length > 0
      ? scoped.filter((zone) => session.variantIds!.includes(zone.id))
      : []
  const sessionKept =
    session?.variantIds != null &&
    session.variantIds.length > 0 &&
    sessionZones.length === session.variantIds.length

  // Zonas já ditas neste funil (sessão do serviço + mensagens desde o início do funil).
  if (
    active.length > 0 &&
    named.length === 0 &&
    !asksPrice &&
    sameFunnel &&
    (chosenEarlier.zones.length > 0 || sessionKept) &&
    !chosenEarlier.ambiguous
  ) {
    return null
  }

  if (active.length > 0 && named.length === 0 && (asksPrice || openPeriod || lineOnly)) {
    const pool = scoped.length > 0 ? scoped : active
    return variantListQuestion(svc.name, variantKindForAsk(svc), pool, cnv, {
      selectionMode: svc.variantSelection,
    })
  }

  if (asksPrice && named.length === 1) {
    const z = named[0]!
    const preço = z.priceCents == null ? 'a equipe confirma o valor' : formatBRL(z.priceCents)
    const duração = String(z.durationMinutes)
    const fb = `${z.name} custa ${preço} e dura ${duração} min.`
    return sayAct(
      'informar_preco_variante',
      cnv,
      { variante: z.name, preço, duração },
      fb,
    )
  }

  if (asksPrice && named.length >= 2) {
    if (textNamesMixAudiences(source, named)) {
      return mixedAudienceReply(cnv)
    }
    const minutes = named.reduce((n, z) => n + z.durationMinutes, 0)
    const missing = named.some((z) => z.priceCents == null)
    const cents = named.reduce((n, z) => n + (z.priceCents ?? 0), 0)
    const preço = missing ? 'a equipe confirma o valor' : formatBRL(cents)
    const duração = String(minutes)
    // DEC-090: duração de atendimento ok; nunca citar intervalo/buffer da agenda ao cliente.
    const fb = `No total, ficam ${preço} e ${duração} min de atendimento.`
    return sayAct('informar_preco_soma', cnv, { preço, duração }, fb)
  }

  if (!asksPrice && active.length === 0 && openPeriod) return null
  return null
}
