/**
 * Evento `ai.turn_decided` (#407, CA-09) — log + outbox interna, sem texto da conversa.
 * T2 (session-analytics): `sessionId` + `step` + friction flags mínimas.
 */
import type { Clock } from '../../db/clock'
import { insertOutboxEvent, type OutboxRow } from '../outbox'
import type { ClinicDb } from '../store'
import type { BookingSessionStep } from './booking-session'
import {
  assertFrictionMinimized,
  type TurnFrictionEvent,
} from './turn-friction'

/** Rotas do autodraft (DEC-108 / plano §4). */
export type TurnRoute =
  | 'reschedule'
  | `handoff:${string}`
  | 'catalog'
  | 'media_ask_text'
  | 'model'
  | 'proposal'
  | 'deterministic_question'
  | 'fallback'
  | `skip:${string}`

export type TurnDecidedPayload = {
  tenantId: string
  conversationId: string
  messageIds: string[]
  route: TurnRoute | string
  slotsFilled: string[]
  slotsMissing: string[]
  modelCalled: boolean
  /**
   * EE-06 / #491: número de chamadas ao LLM neste turno (extrator + redator).
   * `modelCalled` continua true quando `modelCalls > 0`.
   */
  modelCalls: number
  textDiscarded: boolean
  /**
   * DEC-143 (medida a): o conjunto de variantes do mesmo serviço mudou neste turno.
   * Só ids comparados; nunca o texto. `false` quando o quadro não tem serviço/variantes no fim,
   * ou quando o serviço mudou no mesmo turno (catálogo/resolução, não «zonas no texto»).
   */
  variantsChanged: boolean
  /**
   * DEC-143: `pending.slot` do quadro antes do turno (ex.: `variantes`, `eco`, `horario`),
   * ou null. Separa «zonas escritas sem pergunta» de «resposta à pergunta das zonas» e do Sim do eco.
   */
  pendingSlotBefore: string | null
  /**
   * DEC-143: antes do turno o bot já só precisava das zonas (serviço com zonas, linha escolhida
   * ou sem mistura de linhas, e ainda sem variantes). `variantsChanged && !zonesAskedBefore`
   * = a cliente escreveu zonas sem lhas terem pedido; `true` = respondeu à pergunta das zonas.
   * Não depende de `pendingSlotBefore`: a pergunta em texto simples não deixa pendente.
   */
  zonesAskedBefore: boolean
  /**
   * T2 / DEC-148: `booking_sessions.session_id` aberta nesta conversa, ou null.
   */
  sessionId: string | null
  /**
   * T2: passo do funil derivado do quadro após o turno (session-analytics §4.2).
   */
  step: BookingSessionStep | null
  /**
   * T2: friction flags disparadas neste turno (sem transcript / sem termo em claro).
   */
  friction: TurnFrictionEvent[]
  model: string | null
  latencyMs: {
    debounce: number | null
    model: number | null
    decision: number | null
    send: number | null
  }
  tokens: { input: number | null; output: number | null }
}

const BODY_LEAK =
  /\b(body|mensagem|message|text|inbound|outbound)\b/i

/** Garante que o payload serializado não leva corpo de mensagem. */
export function assertTurnDecidedMinimized(payload: TurnDecidedPayload): void {
  const json = JSON.stringify(payload)
  // Chaves permitidas; valores não podem parecer prosa longa de conversa.
  if (/"body"\s*:/.test(json) || /"mensagem"\s*:/.test(json) || /"suggestedText"\s*:/.test(json)) {
    throw new Error('ai.turn_decided: payload contém chave de texto de conversa')
  }
  for (const id of payload.messageIds) {
    if (id.length > 80 || /\s/.test(id)) {
      throw new Error('ai.turn_decided: messageId inválido')
    }
  }
  if (payload.sessionId != null && (payload.sessionId.length > 80 || /\s/.test(payload.sessionId))) {
    throw new Error('ai.turn_decided: sessionId inválido')
  }
  assertFrictionMinimized(payload.friction)
  // Nenhum valor string longo (provável corpo).
  const walk = (v: unknown): void => {
    if (typeof v === 'string' && v.length > 120 && BODY_LEAK.test(v) === false) {
      // strings longas só se forem enums/rotas curtas — bloquear prosa
      if (/\s{2,}|\n/.test(v) || v.split(' ').length > 12) {
        throw new Error('ai.turn_decided: possível corpo de mensagem no payload')
      }
    } else if (v && typeof v === 'object') {
      for (const x of Object.values(v as Record<string, unknown>)) walk(x)
    }
  }
  walk(payload)
}

export function emitTurnDecided(
  db: ClinicDb,
  payload: TurnDecidedPayload,
  clock: Clock,
): OutboxRow {
  assertTurnDecidedMinimized(payload)
  const line = JSON.stringify({ level: 'info', event: 'ai.turn_decided', ...payload })
  console.log(line)
  const msgKey = payload.messageIds[0] ?? 'none'
  return insertOutboxEvent(
    db,
    {
      tenantId: payload.tenantId,
      type: 'ai.turn_decided',
      aggregateType: 'conversation',
      aggregateId: payload.conversationId,
      idempotencyKey: `ai.turn_decided:${payload.conversationId}:${msgKey}:${payload.route}`,
      payload: { ...payload },
    },
    clock,
  )
}

/** Conjunto de variantes como chave estável (ordem não conta). */
function variantKey(ids: string[] | null | undefined): string {
  return [...(ids ?? [])].sort().join('\0')
}

/**
 * DEC-143: variantes do mesmo serviço mudaram entre o quadro antes e depois do turno.
 * Primeiro preenchimento (sem serviço antes) conta; troca de serviço no mesmo turno não
 * (costuma ser catálogo/resolução, não zonas escritas). Ficar sem variantes não conta.
 */
export function variantsChangedInTurn(
  before: { serviceId: string | null; variantIds: string[] | null } | null,
  after: { serviceId: string | null; variantIds: string[] | null } | null,
): boolean {
  if (!after?.serviceId || !after.variantIds?.length) return false
  if (before?.serviceId && before.serviceId !== after.serviceId) return false
  return variantKey(before?.variantIds) !== variantKey(after.variantIds)
}

/**
 * DEC-143: o quadro anterior só esperava as zonas. `activeZones` = zonas activas do serviço do
 * quadro; `needsLine` = o serviço mistura linhas (feminino/masculino).
 */
export function zonesAskedBeforeTurn(
  before: { serviceId: string | null; line: string | null; variantIds: string[] | null } | null,
  service: { activeZones: number; needsLine: boolean } | null,
): boolean {
  if (!before?.serviceId || !service || service.activeZones === 0) return false
  if (before.variantIds?.length) return false
  return !service.needsLine || before.line != null
}

/** Deriva a rota a partir do outcome do autodraft. */
export function routeFromAutodraftOutcome(input: {
  status: string
  reason?: string | null
  proposalId?: string | null
  deterministicReply?: boolean
  fallbackSent?: boolean
  modelCalled?: boolean
  textDiscarded?: boolean
}): TurnRoute | string {
  if (input.reason === 'reschedule_flow') return 'reschedule'
  if (input.reason === 'human_handoff') return 'handoff:pause'
  if (input.reason === 'media_ask_text') return 'media_ask_text'
  if (input.reason === 'catalog_reply') return 'catalog'
  if (input.reason?.startsWith('abuse_limit')) return `skip:${input.reason}`
  if (input.status === 'skipped' && input.reason) return `skip:${input.reason}`
  if (input.status === 'cap_reached') return 'skip:cap_reached'
  if (input.fallbackSent) return 'fallback'
  if (input.proposalId) return 'proposal'
  if (input.deterministicReply) return 'deterministic_question'
  if (input.modelCalled) return 'model'
  return `skip:${input.reason ?? input.status}`
}
