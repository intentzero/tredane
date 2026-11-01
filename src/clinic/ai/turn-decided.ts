/**
 * Evento `ai.turn_decided` (#407, CA-09) — log + outbox interna, sem texto da conversa.
 */
import type { Clock } from '../../db/clock'
import { insertOutboxEvent, type OutboxRow } from '../outbox'
import type { ClinicDb } from '../store'

/** Rotas do autodraft (DEC-108 / plano §4). */
export type TurnRoute =
  | 'reschedule'
  | `handoff:${string}`
  | 'catalog'
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
  textDiscarded: boolean
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
