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
import {
  variantKindForAsk,
  variantListQuestion,
} from './variant-line'

export const FAQ_MISSING_DETAIL_BODY =
  'Não tenho esse detalhe no cadastro; a equipe confirma.'

export const FAQ_CONTINUE_BUTTON_ID = 'fu:faq:continue'
export const FAQ_CONTINUE_BUTTON_TITLE = 'Continuar'

/** Cues de pergunta/clarificação (camada 1) — não são escolha de zona. */
const CLARIFICATION_CUE =
  /\b(?:inclui|incluem|cobre|cobrem|faz\s+parte|vem\s+com|conta\s+com|o\s+que\s+(?:e|é)|o\s+que\s+significa|como\s+funciona|explica(?:r|ção)?|significa|abrang(?:e|em)|contempla)\b/i

export function foldFaqText(text: string): string {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
}

/**
 * True se o texto é pergunta/clarificação de cobertura ou significado
 * (ex.: «A íntima inclui anus?», «o que é íntima?»).
 */
export function isCatalogClarificationAsk(text: string): boolean {
  const t = text.trim()
  if (!t) return false
  return CLARIFICATION_CUE.test(foldFaqText(t))
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
  const afterVerb =
    folded.match(
      /\b(?:inclui(?:m)?|cobre(?:m)?|contempla|abrang(?:e|em)|vem\s+com|conta\s+com)\s+(?:[ao]s?\s+)?([a-z0-9][\w-]*)/i,
    )?.[1] ??
    folded.match(/\bfaz\s+parte\b.*?\b(?:[ao]s?\s+)?([a-z0-9][\w-]{2,})\s*\??\s*$/i)?.[1] ??
    null
  if (afterVerb) {
    const term = foldFaqText(afterVerb)
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
    }
  | {
      kind: 'missing'
      replyText: string
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
}): FaqCatalogAnswer {
  const folded = foldFaqText(input.text)
  const subject = findZoneByName(folded, input.zones)
  const objectTerm = coverageObjectTerm(folded, subject)

  if (subject && objectTerm) {
    if (synonymCoversTerm(subject, objectTerm)) {
      const display =
        (subject.synonyms ?? []).find((s) => foldName(s) === objectTerm) ?? objectTerm
      return {
        kind: 'covered',
        subjectZone: subject,
        coveredTerm: display,
        replyText: `Sim — no cadastro, ${display} faz parte de ${subject.name}.`,
      }
    }
    const mapped = findZoneByAnyAlias(objectTerm, input.zones)
    if (mapped && mapped.id !== subject.id) {
      return {
        kind: 'mapped',
        mappedZone: mapped,
        coveredTerm: objectTerm,
        replyText: `No cadastro, ${objectTerm} corresponde a ${mapped.name}.`,
      }
    }
  }

  // Termo sozinho que é sinónimo de uma zona («ânus?» com cue de cobertura).
  if (!subject && objectTerm) {
    const mapped = findZoneByAnyAlias(objectTerm, input.zones)
    if (mapped && synonymCoversTerm(mapped, objectTerm) && foldName(mapped.name) !== objectTerm) {
      const display =
        (mapped.synonyms ?? []).find((s) => foldName(s) === objectTerm) ?? objectTerm
      return {
        kind: 'mapped',
        mappedZone: mapped,
        coveredTerm: display,
        replyText: `No cadastro, ${display} corresponde a ${mapped.name}.`,
      }
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
