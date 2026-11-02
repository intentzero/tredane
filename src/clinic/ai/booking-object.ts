/**
 * Identificação conversacional do objecto de marcação (serviço + variante).
 * Interpretação determinística: candidatos, informação em falta, pergunta mínima.
 * Não marca, não envia e não autoriza proposta — DEC-061.
 * Copy via catálogo M4 (#448): perguntar_servico / confirmar_servico.
 */
import type { ServiceAudience } from '../catalog/audience'
import type { ServiceRow, ServiceZoneRow, VariantAudience } from '../config/types'
import { variantChoiceLabel } from '../config/zones'
import { sayAct } from './dialogue-acts'
import { THIRD_PARTY_RE } from './nlu/sensitive'
import { citesServiceName } from './schedule-choice'
import {
  audienceLineQuestion,
  needsAudienceLine,
  variantListQuestion,
  zonesForAudienceLine,
  type AudienceLine,
} from './variant-line'

export type BookableOption = {
  key: string
  serviceId: string
  serviceName: string
  variantId: string | null
  variantName: string | null
  audience: VariantAudience | null
  durationMinutes: number
  priceCents: number | null
  serviceAudiencia: ServiceAudience
  hasVariants: boolean
  variantKind: string | null
  variantKindPlural: string | null
}

export type BookingMissing =
  | 'servico'
  | 'variante'
  | 'linha'
  | 'duracao'
  | 'audiencia_variante'

export type BookingMatchKind = 'selected' | 'clarify' | 'handoff' | 'none'

export type BookingHandoffReason =
  | 'terceiro'
  | 'multiplos_servicos'
  | 'inexistente'
  | 'historico_indisponivel'
  | 'catalogo_vazio'

export type BookingMatchResult = {
  kind: BookingMatchKind
  /** Opções ainda em jogo (1 = selecção quando kind=selected). */
  candidates: BookableOption[]
  missing: BookingMissing[]
  question: string | null
  handoffReason: BookingHandoffReason | null
  /** De onde veio a escolha principal. */
  source: 'explicit' | 'session' | 'deictic' | 'duration' | 'partial' | 'none'
  /** true se o texto corrige/troca serviço ou variante já na sessão. */
  correction: boolean
  /** Serviço escolhido (quando selected ou clarify com serviço único). */
  serviceId: string | null
  /** Variantes escolhidas (ids) quando selected com zonas. */
  variantIds: string[]
}

export type BookingSessionHint = {
  serviceId: string | null
  audienceLine: AudienceLine | null
  variantIds: string[] | null
}

const THIRD_PARTY = THIRD_PARTY_RE

const LAST_TIME = /\b(igual\s+(a|à)\s+ultima\s+vez|como\s+da\s+outra\s+vez|o\s+mesmo\s+de\s+sempre)\b/i

const DEICTIC = /\b(esse|essa|desse|dessa|aquele|aquela|o\s+mesmo|a\s+mesma)\b/i

const PRICE = /\b(pre[cç]o|custa|valor|quanto)\b/i

const BOOKING_INTENT =
  /\b(quero|gostaria|marcar|agendar|horario|horário|disponi|vaga|fazer|preciso|pode\s+ser)\b/i

function fold(text: string): string {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
}

function significantWords(name: string): string[] {
  return fold(name)
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3)
}

import { durationMinutesFromText } from '../catalog/duration'

export { durationMinutesFromText }

export function listBookableOptions(services: readonly ServiceRow[]): BookableOption[] {
  const out: BookableOption[] = []
  for (const service of services) {
    if (!service.active) continue
    const activeZones = (service.zones ?? []).filter((z) => z.active)
    if (activeZones.length === 0) {
      out.push({
        key: service.id,
        serviceId: service.id,
        serviceName: service.name,
        variantId: null,
        variantName: null,
        audience: null,
        durationMinutes: service.durationMinutes,
        priceCents: service.priceCents,
        serviceAudiencia: service.audiencia,
        hasVariants: false,
        variantKind: service.variantKind,
        variantKindPlural: service.variantKindPlural,
      })
      continue
    }
    for (const zone of activeZones) {
      out.push({
        key: `${service.id}:${zone.id}`,
        serviceId: service.id,
        serviceName: service.name,
        variantId: zone.id,
        variantName: zone.name,
        audience: zone.audience,
        durationMinutes: zone.durationMinutes,
        priceCents: zone.priceCents,
        serviceAudiencia: service.audiencia,
        hasVariants: true,
        variantKind: service.variantKind,
        variantKindPlural: service.variantKindPlural,
      })
    }
  }
  return out
}

function serviceNameHit(text: string, name: string): 'exact' | 'fuzzy' | 'partial' | null {
  const words = significantWords(name)
  if (words.length === 0) return null
  const folded = fold(text)
  const tokens = new Set(folded.split(/[^a-z0-9]+/).filter(Boolean))
  if (words.every((w) => tokens.has(w))) return 'exact'
  if (citesServiceName(text, name)) return 'fuzzy'
  // Uma palavra longa do nome (≥5) aparece sozinha — hit fraco.
  const long = words.filter((w) => w.length >= 5)
  if (long.length > 0 && long.some((w) => tokens.has(w))) return 'partial'
  return null
}

function variantNameHit(text: string, name: string): boolean {
  const n = fold(name.trim())
  if (n.length < 2) return false
  const re = new RegExp(`(?<![a-z0-9])${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![a-z0-9])`)
  return re.test(fold(text))
}

function audienceFromText(text: string): AudienceLine | null {
  const t = fold(text)
  const fem = /\bfeminin[oa]s?\b/.test(t)
  const masc = /\bmasculin[oa]s?\b/.test(t)
  if (fem === masc) return null
  return fem ? 'feminino' : 'masculino'
}

function detectCorrection(
  text: string,
  session: BookingSessionHint | null,
  nextServiceId: string | null,
): boolean {
  if (!session?.serviceId) return false
  if (/\b(na verdade|melhor|troca|trocar|muda|mudar|quero\s+outra|em\s+vez)\b/i.test(text)) {
    return true
  }
  return Boolean(nextServiceId && nextServiceId !== session.serviceId)
}

function uniqueServices(options: readonly BookableOption[]): string[] {
  return [...new Set(options.map((o) => o.serviceId))]
}

/**
 * Quando o nome de A é prefixo do de B e o texto não cita as palavras extra de B,
 * descarta B (F-08 / «tem limpeza hoje?» vs «Limpeza de pele profunda»).
 */
function preferBaseServiceName(options: BookableOption[], text: string): BookableOption[] {
  const tokens = new Set(fold(text).split(/[^a-z0-9]+/).filter(Boolean))
  const byService = new Map<string, BookableOption>()
  for (const option of options) {
    if (!byService.has(option.serviceId)) byService.set(option.serviceId, option)
  }
  const reps = [...byService.values()]
  const drop = new Set<string>()
  for (const a of reps) {
    for (const b of reps) {
      if (a.serviceId === b.serviceId) continue
      const aw = significantWords(a.serviceName)
      const bw = significantWords(b.serviceName)
      if (aw.length >= bw.length) continue
      if (!aw.every((w) => bw.includes(w))) continue
      const extra = bw.filter((w) => !aw.includes(w))
      if (!extra.some((w) => tokens.has(w))) drop.add(b.serviceId)
    }
  }
  if (drop.size === 0) return options
  const filtered = options.filter((o) => !drop.has(o.serviceId))
  return filtered.length > 0 ? filtered : options
}

function askServiceQuestion(conversationId: string, names: string[]): string {
  if (names.length >= 2) {
    const lista = names.join(', ')
    const fb = `Qual serviço você quer? Temos ${lista}.`
    return sayAct('perguntar_servico', conversationId, { lista }, fb)
  }
  if (names.length === 1) {
    const serviço = names[0]!
    const fb = `É ${serviço} que você quer agendar?`
    return sayAct('confirmar_servico', conversationId, { serviço }, fb)
  }
  const fb = 'Qual serviço você gostaria de agendar?'
  return sayAct('perguntar_servico', conversationId, {}, fb)
}

function clarifyingQuestion(
  services: readonly ServiceRow[],
  candidates: BookableOption[],
  missing: BookingMissing[],
  conversationId: string,
): string {
  const serviceIds = uniqueServices(candidates)
  if (missing.includes('servico') || serviceIds.length > 1) {
    const names = [
      ...new Set(
        candidates.map((c) => c.serviceName).filter((n) => n.trim().length > 0),
      ),
    ]
    return askServiceQuestion(conversationId, names)
  }
  const service = services.find((s) => s.id === serviceIds[0])
  if (!service) return askServiceQuestion(conversationId, [])
  const active = service.zones.filter((z) => z.active)
  if (missing.includes('linha') && needsAudienceLine(active)) {
    return audienceLineQuestion(service.name, conversationId)
  }
  if (missing.includes('variante') || missing.includes('duracao') || missing.includes('audiencia_variante')) {
    const lineHint = candidates.find((c) => c.audience === 'feminino' || c.audience === 'masculino')
      ?.audience as AudienceLine | undefined
    const scoped =
      needsAudienceLine(active) && lineHint ? zonesForAudienceLine(active, lineHint) : active
    const pool = scoped.length > 0 ? scoped : active
    if (pool.length === 0) {
      return `Para ${service.name}, qual opção você quer?`
    }
    // Duração só quando as variantes não se distinguem por nome (ex.: sessão 30/60).
    const names = new Set(candidates.map((c) => fold(c.variantName ?? '')))
    const durations = new Set(candidates.map((c) => c.durationMinutes))
    const durationOnly =
      missing.includes('duracao') &&
      durations.size > 1 &&
      names.size <= 1 &&
      candidates.every((c) => c.serviceId === service.id)
    if (durationOnly) {
      const labels = [...durations]
        .sort((a, b) => a - b)
        .map((d) => (d % 60 === 0 ? `${d / 60} h` : `${d} min`))
      return `Para ${service.name}, prefere ${labels.join(' ou ')}?`
    }
    // Laser / sessões: duração é o critério quando os nomes não são zonas concretas.
    if (
      missing.includes('duracao') &&
      durations.size > 1 &&
      candidates.every((c) => c.serviceId === service.id) &&
      pool.every((z) => /sess[aã]o/i.test(z.name))
    ) {
      const labels = [...durations]
        .sort((a, b) => a - b)
        .map((d) => (d % 60 === 0 ? `${d / 60} h` : `${d} min`))
      return `Para ${service.name}, prefere ${labels.join(' ou ')}?`
    }
    return variantListQuestion(service.name, service.variantKind, pool, conversationId)
  }
  return `Para ${service.name}, pode confirmar a opção?`
}

function handoff(reason: BookingHandoffReason): BookingMatchResult {
  return {
    kind: 'handoff',
    candidates: [],
    missing: [],
    question: null,
    handoffReason: reason,
    source: 'none',
    correction: false,
    serviceId: null,
    variantIds: [],
  }
}

function noneResult(): BookingMatchResult {
  return {
    kind: 'none',
    candidates: [],
    missing: [],
    question: null,
    handoffReason: null,
    source: 'none',
    correction: false,
    serviceId: null,
    variantIds: [],
  }
}

/**
 * Resolve o pedido da cliente para opções marcáveis.
 * `offeredKeys`: opções que a clínica listou no turno anterior (deixe «esse»).
 * Não assume histórico de visitas («igual à última vez» → handoff).
 */
export function resolveBookingObject(input: {
  text: string
  services: readonly ServiceRow[]
  session?: BookingSessionHint | null
  /** Textos das opções oferecidas pela clínica no turno anterior. */
  offeredKeys?: readonly string[] | null
  /** Catálogo mudou de forma material desde a sessão (ids inválidos). */
  catalogDrift?: boolean
  /** Id da conversa — escolhe a redação do catálogo (#448). */
  conversationId?: string
}): BookingMatchResult {
  const text = input.text.trim()
  const cnv = input.conversationId ?? ''
  if (!text) return noneResult()
  const services = input.services.filter((s) => s.active)
  // Catálogo vazio: não inventar handoff — deixa o rascunho/modelo seguir (ex.: «oi»).
  // «catalogo_vazio» só quando houve deriva material a meio da conversa.
  if (services.length === 0) {
    if (input.catalogDrift) return handoff('catalogo_vazio')
    return noneResult()
  }

  if (THIRD_PARTY.test(fold(text))) return handoff('terceiro')
  if (LAST_TIME.test(fold(text))) return handoff('historico_indisponivel')
  if (input.catalogDrift) return handoff('catalogo_vazio')

  const options = listBookableOptions(services)
  const duration = durationMinutesFromText(text)
  const line = audienceFromText(text)
  const wantsPrice = PRICE.test(text)

  // Vários serviços nomeados de forma exacta → handoff (sem booking composto).
  const exactServiceHits = services.filter((s) => serviceNameHit(text, s.name) === 'exact')
  if (exactServiceHits.length >= 2) return handoff('multiplos_servicos')

  type Scored = { option: BookableOption; score: number; source: BookingMatchResult['source'] }
  const scored: Scored[] = []

  for (const option of options) {
    let score = 0
    let source: BookingMatchResult['source'] = 'none'
    const svcHit = serviceNameHit(text, option.serviceName)
    if (svcHit === 'exact') {
      score += 50
      source = 'explicit'
    } else if (svcHit === 'fuzzy') {
      score += 35
      source = 'partial'
    } else if (svcHit === 'partial') {
      score += 15
      source = 'partial'
    }
    if (option.variantName && variantNameHit(text, option.variantName)) {
      score += 40
      if (source === 'none') source = 'explicit'
    }
    if (duration != null && option.durationMinutes === duration) {
      score += 25
      if (source === 'none' || source === 'partial') source = 'duration'
    }
    if (line && option.audience && (option.audience === line || option.audience === 'ambos')) {
      score += 10
    }
    if (line && option.audience && option.audience !== line && option.audience !== 'ambos') {
      score -= 40
    }
    if (
      input.session?.serviceId === option.serviceId &&
      input.session.variantIds?.includes(option.variantId ?? '')
    ) {
      score += 8
      if (source === 'none') source = 'session'
    } else if (input.session?.serviceId === option.serviceId && !option.hasVariants) {
      score += 8
      if (source === 'none') source = 'session'
    }
    if (score > 0) scored.push({ option, score, source })
  }

  // Deíctico: «esse» / «essa» com oferta anterior de uma opção.
  if (DEICTIC.test(fold(text)) && input.offeredKeys && input.offeredKeys.length === 1) {
    const key = input.offeredKeys[0]!
    const option = options.find((o) => o.key === key)
    if (option) {
      scored.push({ option, score: 60, source: 'deictic' })
    }
  }

  scored.sort((a, b) => b.score - a.score)
  const topScore = scored[0]?.score ?? 0
  let pool = scored.filter((s) => s.score >= Math.max(15, topScore - 10)).map((s) => s.option)
  // «limpeza» não empatar «Limpeza de pele» com «…profunda» se o texto omite as palavras a mais.
  pool = preferBaseServiceName(pool, text)

  // Sessão: se o texto não nomeia outro serviço e há sessão válida, restringe.
  if (input.session?.serviceId && exactServiceHits.length === 0) {
    const held = pool.filter((o) => o.serviceId === input.session!.serviceId)
    if (held.length > 0) pool = held
    else if (topScore < 30) {
      pool = options.filter((o) => o.serviceId === input.session!.serviceId)
    }
  }

  // Pedido inexistente: intenção de marcar + substantivo que não casa com o catálogo.
  if (pool.length === 0) {
    if (BOOKING_INTENT.test(text) && !wantsPrice) {
      const stop = new Set([
        'quero',
        'gostaria',
        'fazer',
        'marcar',
        'agendar',
        'horario',
        'horário',
        'pode',
        'ser',
        'algo',
        'uma',
        'um',
        'pra',
        'para',
        'esse',
        'essa',
        'disponivel',
        'disponível',
        'vaga',
        'preciso',
        'tarde',
        'manha',
        'noite',
        'hoje',
        'amanha',
        'segunda',
        'terca',
        'quarta',
        'quinta',
        'sexta',
        'sabado',
        'domingo',
        'sim',
        'confirma',
        'confirmo',
        'horario',
        'horarios',
      ])
      const contentWords = significantWords(text).filter((w) => !stop.has(w) && w.length >= 5)
      const catalogWords = new Set(
        services.flatMap((s) => [
          ...significantWords(s.name),
          ...s.zones.filter((z) => z.active).flatMap((z) => significantWords(z.name)),
        ]),
      )
      const unknown = contentWords.filter((w) => !catalogWords.has(w))
      if (unknown.length > 0 && exactServiceHits.length === 0 && scored.length === 0) {
        return handoff('inexistente')
      }
      return {
        kind: 'clarify',
        candidates: listBookableOptions(services).filter(
          (o, i, arr) => arr.findIndex((x) => x.serviceId === o.serviceId) === i,
        ),
        missing: ['servico'],
        question: clarifyingQuestion(services, listBookableOptions(services), ['servico'], cnv),
        handoffReason: null,
        source: 'none',
        correction: detectCorrection(text, input.session ?? null, null),
        serviceId: input.session?.serviceId ?? null,
        variantIds: [],
      }
    }
    return noneResult()
  }

  // Hit parcial único fraco: não fecha — pergunta.
  const best = scored[0]
  const weakOnly =
    best != null &&
    best.score < 40 &&
    best.source === 'partial' &&
    uniqueServices(pool).length === 1 &&
    !input.session?.serviceId

  const serviceIds = uniqueServices(pool)
  const correction = detectCorrection(text, input.session ?? null, serviceIds[0] ?? null)

  // Filtrar por duração se pedida e ainda ambíguo.
  if (duration != null) {
    const byDuration = pool.filter((o) => o.durationMinutes === duration)
    if (byDuration.length > 0) pool = byDuration
  }

  // Filtrar por linha se pedida.
  if (line) {
    const byLine = pool.filter(
      (o) => !o.audience || o.audience === line || o.audience === 'ambos',
    )
    if (byLine.length > 0) pool = byLine
  }

  const missing: BookingMissing[] = []
  const svcIds = uniqueServices(pool)

  if (svcIds.length !== 1 || weakOnly) {
    missing.push('servico')
    const question = clarifyingQuestion(services, pool, missing, cnv)
    return {
      kind: 'clarify',
      candidates: pool,
      missing,
      question,
      handoffReason: null,
      source: best?.source ?? 'partial',
      correction,
      serviceId: svcIds.length === 1 ? svcIds[0]! : null,
      variantIds: [],
    }
  }

  const serviceId = svcIds[0]!
  const service = services.find((s) => s.id === serviceId)!
  const active = service.zones.filter((z) => z.active)
  const servicePool = pool.filter((o) => o.serviceId === serviceId)

  if (active.length === 0) {
    // Serviço sem variantes: um hit exact/fuzzy/session basta; parcial fraco já foi clarificado.
    if (best && best.score < 35 && best.source === 'partial' && !input.session?.serviceId) {
      return {
        kind: 'clarify',
        candidates: servicePool,
        missing: ['servico'],
        question: clarifyingQuestion(services, servicePool, ['servico'], cnv),
        handoffReason: null,
        source: best.source,
        correction,
        serviceId,
        variantIds: [],
      }
    }
    return {
      kind: 'selected',
      candidates: servicePool.slice(0, 1),
      missing: [],
      question: null,
      handoffReason: null,
      source: best?.source ?? (input.session?.serviceId === serviceId ? 'session' : 'explicit'),
      correction,
      serviceId,
      variantIds: [],
    }
  }

  // Com variantes: exige linha quando o catálogo mistura F/M.
  const mixed = needsAudienceLine(active)
  const sessionLine =
    input.session?.serviceId === serviceId ? input.session.audienceLine : null
  const effectiveLine = line ?? sessionLine
  if (mixed && !effectiveLine) {
    return {
      kind: 'clarify',
      candidates: servicePool,
      missing: ['linha'],
      question: audienceLineQuestion(service.name, cnv),
      handoffReason: null,
      source: best?.source ?? 'explicit',
      correction,
      serviceId,
      variantIds: [],
    }
  }

  const scoped = mixed && effectiveLine ? zonesForAudienceLine(active, effectiveLine) : active
  let chosenZones: ServiceZoneRow[] = []
  // «em vez de axila» / «ao invés de axila» — exclui a variante rejeitada.
  const excludedNames = new Set<string>()
  for (const m of fold(text).matchAll(/\b(?:em\s+vez\s+de|ao\s+inves\s+de)\s+([a-z0-9][a-z0-9\s]{1,40}?)(?=\s*$|\s+e\b|\s*,|\s*\.|$)/g)) {
    const chunk = (m[1] ?? '').trim()
    if (chunk) excludedNames.add(chunk)
  }
  const named = scoped.filter((z) => {
    if (!variantNameHit(text, z.name)) return false
    const n = fold(z.name)
    for (const ex of excludedNames) {
      if (ex.includes(n) || n.includes(ex)) return false
    }
    return true
  })
  if (named.length > 0) {
    chosenZones = named
  } else if (
    input.session?.serviceId === serviceId &&
    input.session.variantIds &&
    input.session.variantIds.length > 0 &&
    !correction
  ) {
    chosenZones = scoped.filter((z) => input.session!.variantIds!.includes(z.id))
  } else if (duration != null) {
    const byDur = scoped.filter((z) => z.durationMinutes === duration)
    if (byDur.length === 1) chosenZones = byDur
  }

  // «Tudo» na linha.
  if (/\b(tudo|todas|todos|completo|completa)\b/i.test(fold(text))) {
    chosenZones = [...scoped]
  }

  if (chosenZones.length === 0) {
    const missingFields: BookingMissing[] = ['variante']
    if (duration == null && new Set(scoped.map((z) => z.durationMinutes)).size > 1) {
      missingFields.push('duracao')
    }
    const candidateOpts = servicePool.filter((o) =>
      scoped.some((z) => z.id === o.variantId),
    )
    return {
      kind: 'clarify',
      candidates: candidateOpts.length > 0 ? candidateOpts : servicePool,
      missing: missingFields,
      question: clarifyingQuestion(services, candidateOpts, missingFields, cnv),
      handoffReason: null,
      source: best?.source ?? 'explicit',
      correction,
      serviceId,
      variantIds: [],
    }
  }

  // Nome ambíguo (mesmo nome, variantes distintas sem desambiguação).
  const nameCounts = new Map<string, number>()
  for (const z of chosenZones) {
    const k = fold(z.name)
    nameCounts.set(k, (nameCounts.get(k) ?? 0) + 1)
  }
  const ambiguousName = [...nameCounts.values()].some((n) => n > 1)
  if (ambiguousName && duration == null && !effectiveLine) {
    const peers = chosenZones.map((z) => ({
      name: z.name,
      audience: z.audience,
      durationMinutes: z.durationMinutes,
      priceCents: z.priceCents,
    }))
    const labels = chosenZones.map((z, i) => variantChoiceLabel(peers[i]!, peers))
    return {
      kind: 'clarify',
      candidates: servicePool.filter((o) => chosenZones.some((z) => z.id === o.variantId)),
      missing: ['variante', 'audiencia_variante'],
      question: `Qual opção: ${labels.join(', ')}?`,
      handoffReason: null,
      source: best?.source ?? 'explicit',
      correction,
      serviceId,
      variantIds: [],
    }
  }

  const selectedOpts = servicePool.filter((o) =>
    chosenZones.some((z) => z.id === o.variantId),
  )
  return {
    kind: 'selected',
    candidates: selectedOpts,
    missing: [],
    question: null,
    handoffReason: null,
    source: best?.source ?? 'explicit',
    correction,
    serviceId,
    variantIds: chosenZones.map((z) => z.id),
  }
}

/** Serviços candidatos para `extractServices` / autobook — sem fechar em hit fraco. */
export function servicesFromBookingMatch(
  result: BookingMatchResult,
  services: readonly ServiceRow[],
): ServiceRow[] {
  if (result.kind === 'handoff' || result.kind === 'none') return []
  // Só devolve serviço quando o resolver já fechou ou tem um único serviço inequívoco.
  // Clarify genérico («qual serviço?») não pode inundar extractServices com o catálogo inteiro.
  if (result.serviceId) {
    const svc = services.find((s) => s.id === result.serviceId)
    return svc ? [svc] : []
  }
  if (result.kind === 'selected') {
    const ids = uniqueServices(result.candidates)
    if (ids.length === 1) {
      const svc = services.find((s) => s.id === ids[0])
      return svc ? [svc] : []
    }
  }
  return []
}
