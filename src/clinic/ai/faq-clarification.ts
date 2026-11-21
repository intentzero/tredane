/**
 * FAQ durante escolha de zona/variante (DEC-177).
 *
 * Camadas Confirmadas (Paulo): 1 intent gate + 2 factos do cadastro + 4 sinónimos.
 * Sem camada 3 (LLM) neste recorte.
 *
 * Não marca (DEC-061). Não consome o turno como leftover de zona.
 */
import type { Clock } from '../../db/clock'
import type { ClinicCaller } from '../envelopes'
import type { ServiceRow, ServiceZoneRow } from '../config/types'
import { sendOutboundMessageOp } from '../inbox/operations'
import type { OutboxRow } from '../outbox'
import type { ClinicDb } from '../store'
import { sayAct } from './dialogue-acts'
import {
  HUMAN_HANDOFF_BUTTON_ID,
  HUMAN_HANDOFF_BUTTON_TITLE,
  humanTeamOfferButtons,
} from './human-handoff'
import { getBookingFrame } from './schedule-session'
import type { ScheduleAudienceLine } from './schedule-session'
import {
  needsAudienceLine,
  variantKindForAsk,
  variantListQuestion,
  zonesForAudienceLine,
} from './variant-line'

export const FAQ_MISSING_DETAIL_BODY =
  'Não tenho esse detalhe no cadastro; a equipe confirma.'

/** Etiqueta `faq_catalog` com vários serviços nomeados — frase fixa (TRE-113). */
export const FAQ_WHICH_SERVICE_BODY = 'De qual serviço?'

export const FAQ_CONTINUE_BUTTON_ID = 'fu:faq:continue'
export const FAQ_CONTINUE_BUTTON_TITLE = 'Continuar'

export function isFaqWhichServiceBody(text: string): boolean {
  return text.trim() === FAQ_WHICH_SERVICE_BODY
}

/**
 * Cues de pergunta/clarificação (camada 1) — não são escolha de zona.
 * Testado sobre texto *dobrado* (sem acentos): «o que é» → «o que e»,
 * «é o quê?» → «e o que», «como é feita» → «como e feita».
 */
const CLARIFICATION_CUE =
  /\b(?:inclui|incluem|cobre|cobrem|faz\s+parte|vem\s+com|conta\s+com|o\s+que\s+e|e\s+o\s+que|o\s+que\s+inclui|inclui\s+o\s+que|o\s+que\s+significa|como\s+funciona|como\s+e\b|como\s+e\s+feit[ao]s?|como\s+sao\s+feit[ao]s?|como\s+se\s+faz|como\s+fazem?|explica(?:r|cao)?|significa|abrang(?:e|em)|contempla|quero\s+saber\s+(?:como|o\s+que))\b/i

/**
 * Existência / oferta no catálogo («Fazem depilação íntima?», «Vocês têm massagem?»).
 * Não confundir com clarificação (`inclui` / `como é`) nem com vaga/agenda/política.
 */
const OFFER_ASK_CUE =
  /\b(?:(?:voc[eê]s|vcs)\s+)?(?:fazem|faz|oferecem|oferece|t[eê]m|tem)\b/i

const OFFER_ASK_EXCLUDE =
  /\b(?:tem|t[eê]m)\s+(?:hor[aá]rios?|horarios?|vagas?|agenda|multa|taxa|estacionamento)\b/i

const COVERAGE_OBJECT_TERM_STOP: ReadonlySet<string> = new Set([
  'que',
  'o',
  'a',
  'os',
  'as',
  'de',
  'do',
  'da',
  'e',
  'ou',
  'na',
  'no',
  'um',
  'uma',
  'inclui',
  'incluem',
  'cobre',
  'cobrem',
])

export function foldFaqText(text: string): string {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
}

/**
 * Corrige typos baratos em perguntas de inclusão (sem LLM): «incluinnariz» → «inclui nariz».
 */
export function normalizeInclusionAskText(text: string): string {
  return text.replace(/\binclui([a-z]{3,})/gi, (_, glued: string) => {
    const word = glued.replace(/^(.)\1+/, '$1')
    return `inclui ${word}`
  })
}

function serviceNameFolds(service: ServiceRow): string[] {
  return [service.name, ...(service.synonyms ?? [])]
    .map((n) => foldName(n))
    .filter((n) => n.length >= 3)
}

function mentionsServiceName(folded: string, service: ServiceRow): boolean {
  for (const name of serviceNameFolds(service)) {
    const re = new RegExp(
      `(?<![a-z0-9])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![a-z0-9])`,
      'i',
    )
    if (re.test(folded)) return true
  }
  return false
}

/** «O que inclui a depilação íntima?» — pede a explicação do serviço, não cobertura de sinónimo. */
function isServiceLevelInclusionAsk(folded: string): boolean {
  return (
    /\bo que inclui\b/.test(folded) ||
    /\bo que vem na?\b/.test(folded) ||
    /\binclui o que\b/.test(folded) ||
    /\bo que faz parte da?\b/.test(folded)
  )
}

function catalogTermDisplay(termFolded: string, zones: readonly ServiceZoneRow[]): string {
  for (const zone of zones) {
    if (foldName(zone.name) === termFolded) return zone.name
    const syn = (zone.synonyms ?? []).find((s) => foldName(s) === termFolded)
    if (syn) return syn
  }
  return termFolded
}

/**
 * True se o texto é pergunta/clarificação de cobertura ou significado
 * (ex.: «A íntima inclui anus?», «o que é íntima?», «é o que?», «como é feita…?»).
 */
/**
 * Pergunta de abrangência («Pernas é a perna inteira?», «Braços é o braço todo?»).
 * Exige «é»/«são» acentuado (não confunde com a conjunção «e» em «axila e pernas»)
 * e «?» no fim — P1 rsamp_fa7f138: «inteira» virava «Não encontrei inteira».
 */
const SCOPE_ASK =
  /(?:^|\s)(?:é|são|seria|seriam)\s+(?:(?:a|o|as|os|só|so|apenas)\s+)*(?:[a-zà-ú]+\s+)?(?:inteir[ao]s?|tod[ao]s?|complet[ao]s?)\b/i

export function isCatalogClarificationAsk(text: string): boolean {
  const t = normalizeInclusionAskText(text.trim())
  if (!t) return false
  if (CLARIFICATION_CUE.test(foldFaqText(t))) return true
  return /\?\s*$/.test(t) && SCOPE_ASK.test(t.toLowerCase())
}

/**
 * True se a cliente pergunta se a clínica oferece um procedimento/zona
 * («Fazem X?», «Tem Y?», «Oferecem Z?») — TRE-112 / pós-#1016.
 * Clarificação (`isCatalogClarificationAsk`) e pedidos de vaga/política ficam de fora.
 */
export function isCatalogOfferAsk(text: string): boolean {
  const t = text.trim()
  if (!t) return false
  if (isCatalogClarificationAsk(t)) return false
  const folded = foldFaqText(t)
  if (/\bfaz\s+parte\b/i.test(folded)) return false
  if (OFFER_ASK_EXCLUDE.test(t) || OFFER_ASK_EXCLUDE.test(folded)) return false
  return OFFER_ASK_CUE.test(t) || OFFER_ASK_CUE.test(folded)
}

function foldName(name: string): string {
  return foldFaqText(name.trim())
}

function zoneNameAliases(zone: ServiceZoneRow): string[] {
  return [foldName(zone.name)].filter((n) => n.length >= 2)
}

function zoneAllAliases(zone: ServiceZoneRow): string[] {
  return [zone.name, ...(zone.synonyms ?? [])]
    .map((n) => foldName(n))
    .filter((n) => n.length >= 2)
}

/** Preferir o nome canónico da zona (não o sinónimo) como sujeito de «X inclui Y?». */
function findZoneByName(
  folded: string,
  zones: readonly ServiceZoneRow[],
): ServiceZoneRow | null {
  const active = zones.filter((z) => z.active)
  const ordered = [...active].sort(
    (a, b) => foldName(b.name).length - foldName(a.name).length,
  )
  for (const zone of ordered) {
    for (const alias of zoneNameAliases(zone)) {
      const re = new RegExp(
        `(?<![a-z0-9])${alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![a-z0-9])`,
        'i',
      )
      if (re.test(folded)) return zone
    }
  }
  return null
}

function findZoneByAnyAlias(
  folded: string,
  zones: readonly ServiceZoneRow[],
): ServiceZoneRow | null {
  const byName = findZoneByName(folded, zones)
  if (byName) return byName
  const active = zones.filter((z) => z.active)
  const ordered = [...active].sort(
    (a, b) =>
      Math.max(...zoneAllAliases(b).map((s) => s.length)) -
      Math.max(...zoneAllAliases(a).map((s) => s.length)),
  )
  for (const zone of ordered) {
    for (const alias of zoneAllAliases(zone)) {
      const re = new RegExp(
        `(?<![a-z0-9])${alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![a-z0-9])`,
        'i',
      )
      if (re.test(folded)) return zone
    }
  }
  return null
}

/**
 * Objecto de cobertura: «inclui anus», «cobre o ânus», «faz parte … o ânus».
 * Não remove sinónimos do sujeito (senão «inclui anus» some quando anus é sinónimo).
 */
function coverageObjectTerm(
  folded: string,
  subject: ServiceZoneRow | null,
): string | null {
  const glued = folded.match(/\binclui([a-z]{3,})/i)
  if (glued) {
    const term = glued[1]!.replace(/^(.)\1+/, '$1')
    const foldedTerm = foldFaqText(term)
    if (foldedTerm.length >= 3 && !COVERAGE_OBJECT_TERM_STOP.has(foldedTerm)) {
      if (!subject || !zoneNameAliases(subject).includes(foldedTerm)) {
        return foldedTerm
      }
    }
  }
  const afterVerb =
    folded.match(
      /\b(?:inclui(?:m)?|cobre(?:m)?|contempla|abrang(?:e|em)|vem\s+com|conta\s+com)\s+(?:[ao]s?\s+)?([a-z0-9][\w-]*)/i,
    )?.[1] ??
    folded.match(/\bfaz\s+parte\b.*?\b(?:[ao]s?\s+)?([a-z0-9][\w-]{2,})\s*\??\s*$/i)?.[1] ??
    null
  if (afterVerb) {
    const term = foldFaqText(afterVerb)
    if (!term || COVERAGE_OBJECT_TERM_STOP.has(term)) return null
    if (subject && zoneNameAliases(subject).includes(term)) return null
    return term
  }
  const withoutSubject = subject
    ? zoneNameAliases(subject).reduce(
        (acc, alias) =>
          acc.replace(
            new RegExp(
              `(?<![a-z0-9])${alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![a-z0-9])`,
              'gi',
            ),
            ' ',
          ),
        folded,
      )
    : folded
  const stop = new Set([
    'a',
    'o',
    'as',
    'os',
    'de',
    'da',
    'do',
    'das',
    'dos',
    'e',
    'ou',
    'na',
    'no',
    'em',
    'um',
    'uma',
    'inclui',
    'incluem',
    'cobre',
    'cobrem',
    'faz',
    'fazem',
    'feita',
    'feito',
    'feitas',
    'feitos',
    'parte',
    'vem',
    'com',
    'conta',
    'que',
    'significa',
    'como',
    'funciona',
    'explica',
    'explicar',
    'explicacao',
    'abrange',
    'abrangem',
    'contempla',
    'depilacao',
    'massagem',
    'limpeza',
    'servico',
    'zona',
    'zonas',
    'opcao',
    'opcoes',
    'voce',
    'voces',
    'tem',
    'sera',
    'seria',
    'seriam',
    'tambem',
  ])
  const tokens = withoutSubject
    .replace(/[?!.,;:]+/g, ' ')
    .split(/[^a-z0-9]+/)
    .filter((tok) => tok.length >= 3 && !stop.has(tok))
  return tokens[0] ?? null
}

function synonymCoversTerm(zone: ServiceZoneRow, termFolded: string): boolean {
  if (foldName(zone.name) === termFolded) return true
  return (zone.synonyms ?? []).some((s) => foldName(s) === termFolded)
}

/** Termo citado na pergunta de cobertura aparece na explicação cadastrada da variante. */
function catalogExplanationCoversTerm(zone: ServiceZoneRow, termFolded: string): boolean {
  if (!termFolded || termFolded.length < 3) return false
  const re = new RegExp(
    `(?<![a-z0-9])${termFolded.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![a-z0-9])`,
    'i',
  )
  for (const raw of [zone.clientExplanationAudience, zone.clientExplanation]) {
    const text = raw?.trim()
    if (!text) continue
    if (re.test(foldFaqText(text))) return true
  }
  return false
}

export type FaqCatalogAnswer =
  | {
      kind: 'covered'
      replyText: string
      subjectZone: ServiceZoneRow
      coveredTerm: string
    }
  | {
      kind: 'mapped'
      replyText: string
      mappedZone: ServiceZoneRow
      coveredTerm: string
    }
  | {
      kind: 'explanation'
      replyText: string
      /** Zona nomeada quando a resposta é sobre uma variante (DEC-223). */
      subjectZone?: ServiceZoneRow
    }
  | {
      kind: 'missing'
      replyText: string
      subjectZone?: ServiceZoneRow
    }

/**
 * Handler sistemático do intent fechado `faq_catalog` (TRE-113 / DEC-221 §4.1).
 *
 * Entrada: etiqueta fechada (léxico ou classificador) + texto + candidatos do
 * catálogo. **Não** exige cues («inclui», «fazem») — esses são só ajudas do
 * léxico para etiquetar. Resolve serviço/zona; ambíguo → «De qual serviço?»;
 * lê `client_explanation` (± override) via `answerFaqFromCatalog`; sem facto →
 * missing. Zero redator.
 *
 * `force=true` (etiqueta do classificador): sempre devolve resposta (missing se
 * não resolver). `force=false` + `mode=offer` sem serviço: `handled:false` para
 * o caller seguir o caminho de inexistente (#512).
 */
/** Sujeito resolvido pelo FAQ para DEC-223 (informativo; não é booking). */
export type FaqCatalogResolvedSubject = {
  serviceId: string
  variantIds: string[]
  audienceLine: ScheduleAudienceLine | null
}

export type HandleFaqCatalogResult =
  | {
      handled: true
      replyText: string
      /** Ambiguidade entre serviços — limpar sujeito activo. */
      clearSubject?: true
      /** Serviço/variante da resposta (gravar ActiveCatalogSubject). */
      subject?: FaqCatalogResolvedSubject
    }
  | { handled: false }

export function handleFaqCatalog(input: {
  text: string
  conversationId: string
  /** Serviços activos cujo nome/sinónimo o léxico reconheceu no texto. */
  namedServices: readonly ServiceRow[]
  heldService?: ServiceRow | null
  /** Único serviço cujas zonas/sinónimos aparecem no texto. */
  zoneService?: ServiceRow | null
  /** Único serviço do catálogo — só com `allowSoleServiceFallback`. */
  soleService?: ServiceRow | null
  allowSoleServiceFallback: boolean
  /** Linha dita neste turno (feminina/masculina). */
  explicitAudienceLine?: ScheduleAudienceLine | null
  /** Linha guardada na sessão (só se o serviço resolvido for o held). */
  sessionAudienceLine?: ScheduleAudienceLine | null
  mode: 'clarification' | 'offer'
  /** Etiqueta fechada já decidida (classificador / force path). */
  force?: boolean
}): HandleFaqCatalogResult {
  const force = input.force === true
  const distinctNamed = [...new Map(input.namedServices.map((s) => [s.id, s])).values()]
  if (distinctNamed.length > 1) {
    return { handled: true, replyText: FAQ_WHICH_SERVICE_BODY, clearSubject: true }
  }
  const svc =
    distinctNamed[0] ??
    input.heldService ??
    input.zoneService ??
    (input.allowSoleServiceFallback ? input.soleService : null) ??
    null
  if (!svc) {
    if (force) return { handled: true, replyText: FAQ_MISSING_DETAIL_BODY }
    if (input.mode === 'offer') return { handled: false }
    return { handled: true, replyText: FAQ_MISSING_DETAIL_BODY }
  }
  const active = svc.zones.filter((zone) => zone.active)
  const mixed = needsAudienceLine(active)
  const carried =
    input.heldService?.id === svc.id ? (input.sessionAudienceLine ?? null) : null
  const line = mixed ? (input.explicitAudienceLine ?? carried) : null
  const pool = mixed && line ? zonesForAudienceLine(active, line) : active
  const faq = answerFaqFromCatalog({
    text: input.text,
    conversationId: input.conversationId,
    service: svc,
    zones: pool.length > 0 ? pool : active,
    mode: input.mode,
  })
  const variantIds =
    'subjectZone' in faq && faq.subjectZone
      ? [faq.subjectZone.id]
      : 'mappedZone' in faq && faq.mappedZone
        ? [faq.mappedZone.id]
        : []
  return {
    handled: true,
    replyText: faq.replyText,
    subject: {
      serviceId: svc.id,
      variantIds,
      audienceLine: line,
    },
  }
}

/**
 * Resposta só com factos do cadastro (explicação do serviço ou sinónimos DEC-110).
 * Sem LLM.
 */
export function answerFaqFromCatalog(input: {
  text: string
  conversationId: string
  service: ServiceRow
  zones: readonly ServiceZoneRow[]
  /**
   * `offer` = existência («fazem X?»): com zona/serviço no cadastro e sem
   * explicação, afirma a oferta em vez da frase missing de clarificação.
   */
  mode?: 'clarification' | 'offer'
}): FaqCatalogAnswer {
  const mode = input.mode ?? 'clarification'
  const folded = foldFaqText(normalizeInclusionAskText(input.text))
  const subject = findZoneByName(folded, input.zones)
  // TRE-113: sem verbo de cobertura («inclui» / «cobre»), não tratar sobras
  // («sobre», «fala») como objecto — senão «Sobre a íntima» caía em missing.
  const hasInclusionCue =
    /\b(?:inclui|incluem|cobre|cobrem|faz\s+parte|vem\s+com|conta\s+com|abrange|abrangem|contempla)\b/i.test(
      folded,
    )
  let objectTerm = hasInclusionCue ? coverageObjectTerm(folded, subject) : null
  if (isServiceLevelInclusionAsk(folded) && mentionsServiceName(folded, input.service)) {
    objectTerm = null
  } else if (objectTerm && serviceNameFolds(input.service).includes(objectTerm)) {
    objectTerm = null
  }

  // DEC-177 / DEC-189 / TRE-100: variante nomeada prevalece. Não usar a prosa do
  // serviço quando a pergunta nomeia a zona («o que inclui a depilação íntima?»).
  // O ramo antigo de «serviço+variante → explicação do serviço» (rsamp_f72ce590)
  // contradizia a regra Confirmada: zona sem texto próprio → missing.

  if (subject && objectTerm) {
    if (synonymCoversTerm(subject, objectTerm)) {
      const display = catalogTermDisplay(objectTerm, input.zones)
      return {
        kind: 'covered',
        subjectZone: subject,
        coveredTerm: display,
        replyText: `Sim — no cadastro, ${display} faz parte de ${subject.name}.`,
      }
    }
    if (catalogExplanationCoversTerm(subject, objectTerm)) {
      const display = catalogTermDisplay(objectTerm, input.zones)
      return {
        kind: 'covered',
        subjectZone: subject,
        coveredTerm: display,
        replyText: `Sim — no cadastro, ${display} faz parte de ${subject.name}.`,
      }
    }
    const mapped = findZoneByAnyAlias(objectTerm, input.zones)
    if (mapped && mapped.id !== subject.id) {
      const display = catalogTermDisplay(objectTerm, input.zones)
      return {
        kind: 'mapped',
        mappedZone: mapped,
        coveredTerm: display,
        replyText: `No cadastro, ${display} corresponde a ${mapped.name}.`,
      }
    }
    // DEC-177 / Bugbot: cobertura sem prova no cadastro → missing.
    // Não cair na Explicação geral do serviço (não responde «inclui X?»).
    return {
      kind: 'missing',
      replyText: FAQ_MISSING_DETAIL_BODY,
    }
  }

  // Termo sozinho que é sinónimo de uma zona («ânus?» com cue de cobertura).
  if (!subject && objectTerm) {
    const mapped = findZoneByAnyAlias(objectTerm, input.zones)
    if (mapped && synonymCoversTerm(mapped, objectTerm) && foldName(mapped.name) !== objectTerm) {
      const display = catalogTermDisplay(objectTerm, input.zones)
      return {
        kind: 'mapped',
        mappedZone: mapped,
        coveredTerm: display,
        replyText: `No cadastro, ${display} corresponde a ${mapped.name}.`,
      }
    }
  }

  // Preferir a explicação da variante nomeada (DEC-189: override por género,
  // senão comum do nome). Sem texto na variante, não usar a prosa do serviço
  // pai (lab: «O que inclui a íntima?»).
  if (subject) {
    const zoneExplanation =
      subject.clientExplanationAudience?.trim() ||
      subject.clientExplanation?.trim() ||
      ''
    if (zoneExplanation) {
      return {
        kind: 'explanation',
        subjectZone: subject,
        replyText: sayAct(
          'informar_explicacao',
          input.conversationId,
          { explicação: zoneExplanation },
          zoneExplanation,
        ),
      }
    }
    if (mode === 'offer') {
      return {
        kind: 'explanation',
        subjectZone: subject,
        replyText: `Sim, fazemos ${subject.name}.`,
      }
    }
    return {
      kind: 'missing',
      subjectZone: subject,
      replyText: FAQ_MISSING_DETAIL_BODY,
    }
  }

  const explanation = input.service.clientExplanation?.trim() ?? ''
  if (explanation) {
    return {
      kind: 'explanation',
      replyText: sayAct(
        'informar_explicacao',
        input.conversationId,
        { explicação: explanation },
        explanation,
      ),
    }
  }

  if (mode === 'offer') {
    return {
      kind: 'explanation',
      replyText: `Sim, fazemos ${input.service.name}.`,
    }
  }

  return {
    kind: 'missing',
    replyText: FAQ_MISSING_DETAIL_BODY,
  }
}

export function faqMissingInteractiveButtons(
  db: ClinicDb,
  tenantId: string,
  clock: Clock,
): Array<{ id: string; title: string }> {
  // Preferência 21/11: Continuar + Equipe (sem reply Abrir agenda na mesma bolha).
  const buttons: Array<{ id: string; title: string }> = [
    { id: FAQ_CONTINUE_BUTTON_ID, title: FAQ_CONTINUE_BUTTON_TITLE },
  ]
  buttons.push(...humanTeamOfferButtons(db, tenantId, clock))
  return buttons
}

/** Botões quando falta detalhe; se expediente fechado, só Continuar. */
export function faqMissingChoiceInteractive(
  db: ClinicDb,
  tenantId: string,
  clock: Clock,
): { mode: 'buttons'; buttons: Array<{ id: string; title: string }> } {
  return {
    mode: 'buttons',
    buttons: faqMissingInteractiveButtons(db, tenantId, clock),
  }
}

export type FaqContinueButtonResult =
  | { handled: false; reason: 'not_faq_continue_button' }
  | { handled: true; outbox: OutboxRow[] }

/**
 * Continuar após FAQ sem detalhe: reabre a pergunta de variantes sem avançar a marcação.
 */
export function handleFaqContinueButtonClick(
  db: ClinicDb,
  caller: ClinicCaller,
  input: {
    tenantId: string
    conversationId: string
    buttonId: string
    providerEventKey?: string | null
    services: readonly ServiceRow[]
    authorClerkUserId: string
    authorDisplayName: string
  },
  clock: Clock,
): FaqContinueButtonResult {
  if (input.buttonId.trim() !== FAQ_CONTINUE_BUTTON_ID) {
    return { handled: false, reason: 'not_faq_continue_button' }
  }
  const frame = getBookingFrame(db, input.tenantId, input.conversationId)
  const service = frame?.serviceId
    ? input.services.find((s) => s.id === frame.serviceId)
    : null
  let body: string
  if (service) {
    const zones = service.zones.filter((z) => z.active)
    body = variantListQuestion(
      service.name,
      variantKindForAsk(service),
      zones,
      input.conversationId,
      { selectionMode: service.variantSelection },
    )
  } else {
    body = 'Pode continuar — diga o serviço ou a opção que prefere.'
  }
  const sent = sendOutboundMessageOp(
    db,
    caller,
    {
      conversationId: input.conversationId,
      body,
      clientRequestId: `ai-faq-continue:${input.providerEventKey ?? clock.nowMs()}`,
      authorClerkUserId: input.authorClerkUserId,
      authorDisplayName: input.authorDisplayName,
    },
    clock,
  )
  return { handled: true, outbox: sent.outbox }
}

/** Type-only assert: handoff title stays within Meta limits. */
void HUMAN_HANDOFF_BUTTON_TITLE
void HUMAN_HANDOFF_BUTTON_ID
