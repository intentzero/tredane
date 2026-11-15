/**
 * Snapshots mínimos para jobs LLM (DEC-188).
 * Só o que DEC-011/118/120/185 autorizam; cópia imutável no job.
 */
import type { Clock } from '../../db/clock'
import type { ClinicCaller } from '../envelopes'
import type { ClinicDb } from '../store'
import { ensureClinicSettings } from '../config/settings'
import { clinicCivilDateFromUtc } from '../scheduling/timezone'
import { buildAiContextPayload } from './context'
import {
  catalogNamesFromServices,
  type ExtractorRaw,
} from './llm-extractor'
import { interpretTurn, type TurnInterpretation } from './nlu/interpret'
import { getBookingFrame, type BookingFramePending } from './schedule-session'
import type { AiAssistDeps } from './types'
import type { TurnContext } from './turn-context'

export type ExtractSnapshot = {
  purpose: 'extract'
  conversationId: string
  messageId: string
  turnText: string
  today: string
  frameVersion: number
  pending: BookingFramePending | null
  catalog: ReturnType<typeof catalogNamesFromServices>
  base: TurnInterpretation
}

export type RedactSnapshot = {
  purpose: 'redact'
  conversationId: string
  messageId: string
  question: string
  frameVersion: number
  /** Contexto DEC-120 já montado no DO (Worker não lê SQLite). */
  context: unknown
  computedFacts?: string
}

export type ExtractModelResult = {
  ok: boolean
  text: string
  raw: ExtractorRaw | null
  model: string | null
  inputTokens: number | null
  outputTokens: number | null
  latencyMs: number | null
  code?: string
}

export type RedactModelResult = {
  ok: boolean
  text: string
  model: string | null
  inputTokens: number | null
  outputTokens: number | null
  latencyMs: number | null
  code?: string
}

export function frameVersionOf(
  db: ClinicDb,
  tenantId: string,
  conversationId: string,
): number {
  const frame = getBookingFrame(db, tenantId, conversationId)
  return frame?.updatedAt ?? 0
}

export function buildExtractSnapshot(
  db: ClinicDb,
  tenantId: string,
  turn: TurnContext,
  clock: Clock,
): ExtractSnapshot | null {
  const settings = turn.settings ?? ensureClinicSettings(db, tenantId, clock)
  const today = clinicCivilDateFromUtc(settings.timezone || 'America/Sao_Paulo', clock.nowMs())
  const frame = getBookingFrame(db, tenantId, turn.conversationId)
  const professionals = [...turn.catalog.professionalsByService.values()].flat()
  const uniquePros = new Map(professionals.map((p) => [p.id, p]))
  const proList = [...uniquePros.values()]
  const base = interpretTurn({
    turnText: turn.turnText,
    messageId: turn.messageId,
    today,
    services: turn.catalog.services,
    pending: frame?.pending ?? null,
    professionals: proList,
  })
  if (!base.needsExtractor) return null
  return {
    purpose: 'extract',
    conversationId: turn.conversationId,
    messageId: turn.messageId,
    turnText: turn.turnText,
    today,
    frameVersion: frame?.updatedAt ?? 0,
    pending: frame?.pending ?? null,
    catalog: catalogNamesFromServices(turn.catalog.services, proList),
    base,
  }
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
  },
): Promise<RedactSnapshot> {
  const contextInspection = await buildAiContextPayload(db, caller.tenantId, input.conversationId, {
    clock,
    clinicName: deps.clinicName ?? null,
    forecast: deps.forecast,
    skipDebugExcluded: true,
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
  }
}
