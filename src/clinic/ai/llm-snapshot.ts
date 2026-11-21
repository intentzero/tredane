/**
 * Snapshots mínimos para jobs LLM (DEC-188).
 * Só o que DEC-011/118/120/185 autorizam; cópia imutável no job.
 */
import type { Clock } from '../../db/clock'
import type { ClinicCaller } from '../envelopes'
import type { ClinicDb } from '../store'
import { buildAiContextPayload } from './context'
import { getBookingFrame } from './schedule-session'
import type { AiAssistDeps } from './types'
import type { TurnContext } from './turn-context'

export type RedactSnapshot = {
  purpose: 'redact'
  conversationId: string
  messageId: string
  question: string
  frameVersion: number
  /** Contexto DEC-120 já montado no DO (Worker não lê SQLite). */
  context: unknown
  computedFacts?: string
  /** DEC-221 / staging: o Worker classifica a intenção (etiqueta) antes de redigir. */
  classify?: boolean
}

/** Etiqueta de intenção do classificador LLM; nunca escolhe serviço nem hora, nunca redige. */
export type IntentModelResult = {
  label:
    | 'agendar'
    | 'remarcar'
    | 'cancelar'
    | 'misto'
    | 'price'
    | 'team'
    | 'faq_catalog'
    | 'faq_clinic'
    | 'nenhum'
  raw: string
  confidence: number
  model: string | null
  inputTokens: number | null
  outputTokens: number | null
}

export type RedactModelResult = {
  ok: boolean
  text: string
  model: string | null
  inputTokens: number | null
  outputTokens: number | null
  latencyMs: number | null
  code?: string
  /** Só presente quando `snapshot.classify`; registada no resultado do job (origem = LLM). */
  intent?: IntentModelResult | null
}

export function frameVersionOf(
  db: ClinicDb,
  tenantId: string,
  conversationId: string,
): number {
  const frame = getBookingFrame(db, tenantId, conversationId)
  return frame?.updatedAt ?? 0
}

export async function buildRedactSnapshot(
  db: ClinicDb,
  caller: ClinicCaller,
  clock: Clock,
  deps: AiAssistDeps,
  input: {
    conversationId: string
    messageId: string
    question: string
    turn?: TurnContext
    computedFacts?: string
    classify?: boolean
  },
): Promise<RedactSnapshot> {
  const contextInspection = await buildAiContextPayload(db, caller.tenantId, input.conversationId, {
    clock,
    clinicName: deps.clinicName ?? null,
    skipDebugExcluded: true,
    // Sem freeSlots/queryAvailability — isso estourava CPU do DO no Lab (ca03).
    agendaMode: 'hours',
    ...(input.turn ? { turn: input.turn } : {}),
  })
  return {
    purpose: 'redact',
    conversationId: input.conversationId,
    messageId: input.messageId,
    question: input.question,
    frameVersion: frameVersionOf(db, caller.tenantId, input.conversationId),
    context: contextInspection.payload,
    ...(input.computedFacts ? { computedFacts: input.computedFacts } : {}),
    ...(input.classify ? { classify: true } : {}),
  }
}
