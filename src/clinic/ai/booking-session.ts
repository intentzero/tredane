/**
 * Analytics de sessão de marcação — T1/T2/T3 (DEC-148).
 * Projecção `booking_sessions` + outbox `booking_session.opened` / `.ended` / `.flow`.
 * Sem corpo de mensagem da cliente. Janela W de abandono: Confirmado 24 h (Paulo P4, DEC-127).
 * T3: Flow ↔ sessão (`booking_session.flow` + `flowUsed` em opened/completed).
 */
import { createHash } from 'node:crypto'
import type { Clock } from '../../db/clock'
import { newId } from '../ids'
import { insertOutboxEvent, type OutboxRow } from '../outbox'
import type { ClinicDb } from '../store'
import type { BookingFrame } from './schedule-session'

/** Confirmado (Paulo P4, 07/11/2026): 24 h, alinhado à validade do frame DEC-127. */
export const BOOKING_SESSION_ABANDON_WINDOW_MS = 24 * 60 * 60 * 1000

export type BookingSessionOutcome = 'agendado' | 'handoff' | 'abandon'

export type BookingSessionStep =
  | 'hub'
  | 'audience'
  | 'service'
  | 'variant_ask'
  | 'day_ask'
  | 'echo'
  | 'slot_offer'
  | 'proposal'
  | 'confirm'

export type BookingSessionOpenReason =
  | 'hub'
  | 'intent'
  | 'service_named'
  | 'flow_agendar'
  | 'catalog_mid_booking'

export type BookingSessionRow = {
  sessionId: string
  tenantId: string
  conversationId: string
  openedAt: number
  closedAt: number | null
  outcome: BookingSessionOutcome | null
  dropStep: BookingSessionStep | null
  maxStep: BookingSessionStep | null
  inboundTurns: number
  flowUsed: boolean
  openReason: BookingSessionOpenReason
  serviceId: string | null
  variantSelectionMode: 'uma' | 'varias' | null
}

export type BookingSessionOpenedPayload = {
  event: 'booking_session.opened'
  sessionId: string
  tenantId: string
  conversationId: string
  occurredAt: number
  openReason: BookingSessionOpenReason
  serviceId: string | null
  variantSelectionMode: 'uma' | 'varias' | null
  source: 'clinic_do'
}

export type BookingSessionEndedPayload = {
  event: 'booking_session.ended'
  sessionId: string
  tenantId: string
  conversationId: string
  occurredAt: number
  outcome: BookingSessionOutcome
  dropStep: BookingSessionStep | null
  inboundTurns: number
  flowUsed: boolean
  durationMs: number
  source: 'clinic_do'
}

/** Estados do funil Flow ligados à sessão (session-analytics §4.1 T3). */
export type BookingSessionFlowState =
  | 'sent'
  | 'opened'
  | 'completed'
  | 'replaced'
  | 'expired'
  | 'skipped'

export type BookingSessionFlowSkipReason =
  | 'not_configured'
  | 'no_active_binding'
  | 'build_failed'

export type BookingSessionFlowPayload = {
  event: 'booking_session.flow'
  /** Sessão T1 aberta na conversa, ou null (ex.: CTA hub antes de haver sessão). */
  sessionId: string | null
  tenantId: string
  conversationId: string
  occurredAt: number
  /** sha256 truncado do flow_token — nunca o token em claro. */
  flowTokenId: string | null
  flowState: BookingSessionFlowState
  skipReason?: BookingSessionFlowSkipReason
  source: 'clinic_do'
}

const BODY_KEYS = /\b(body|mensagem|message|text|inbound|outbound|suggestedText)\b/i

/** Hash opaco do flow_token para analytics (16 hex). Sem token → null. */
export function hashFlowTokenForAnalytics(token: string | null | undefined): string | null {
  if (!token) return null
  return createHash('sha256').update(token, 'utf8').digest('hex').slice(0, 16)
}

type FrameHint = Pick<
  BookingFrame,
  'phase' | 'serviceId' | 'line' | 'variantIds' | 'date' | 'period' | 'time' | 'pending' | 'lastOffer' | 'proposal'
>

/** Passo do funil derivado do quadro (T1: sem `step_reached` ainda). */
export function deriveDropStep(frame: FrameHint | null | undefined): BookingSessionStep {
  if (!frame || frame.phase === 'idle') return 'hub'
  if (frame.proposal) return 'proposal'
  if (frame.lastOffer || frame.pending?.slot === 'horario' || frame.time) return 'slot_offer'
  if (frame.pending?.slot === 'eco') return 'echo'
  if (frame.date || frame.period) return 'day_ask'
  if (frame.pending?.slot === 'variantes' || (frame.variantIds?.length ?? 0) > 0) {
    return 'variant_ask'
  }
  if (frame.serviceId) return 'service'
  if (frame.line || frame.pending?.slot === 'linha') return 'audience'
  return 'hub'
}

function assertMinimizedPayload(payload: Record<string, unknown>, label: string): void {
  const json = JSON.stringify(payload)
  if (/"body"\s*:/.test(json) || /"mensagem"\s*:/.test(json) || /"suggestedText"\s*:/.test(json)) {
    throw new Error(`${label}: payload contém chave de texto de conversa`)
  }
  const walk = (v: unknown): void => {
    if (typeof v === 'string') {
      if (v.length > 120 && !BODY_KEYS.test(v) && (/\s{2,}|\n/.test(v) || v.split(' ').length > 12)) {
        throw new Error(`${label}: possível corpo de mensagem no payload`)
      }
    } else if (v && typeof v === 'object') {
      for (const x of Object.values(v as Record<string, unknown>)) walk(x)
    }
  }
  walk(payload)
}

export function assertBookingSessionOpenedMinimized(payload: BookingSessionOpenedPayload): void {
  assertMinimizedPayload({ ...payload }, 'booking_session.opened')
}

export function assertBookingSessionEndedMinimized(payload: BookingSessionEndedPayload): void {
  assertMinimizedPayload({ ...payload }, 'booking_session.ended')
}

export function assertBookingSessionFlowMinimized(payload: BookingSessionFlowPayload): void {
  assertMinimizedPayload({ ...payload }, 'booking_session.flow')
  // Token em claro nunca no payload (só hash truncado).
  if (payload.flowTokenId && payload.flowTokenId.startsWith('fl1_')) {
    throw new Error('booking_session.flow: flowTokenId não pode ser o token em claro')
  }
}

function mapRow(row: {
  session_id: string
  tenant_id: string
  conversation_id: string
  opened_at: number
  closed_at: number | null
  outcome: string | null
  drop_step: string | null
  max_step: string | null
  inbound_turns: number
  flow_used: number
  open_reason: string
  service_id: string | null
  variant_selection_mode: string | null
}): BookingSessionRow {
  return {
    sessionId: row.session_id,
    tenantId: row.tenant_id,
    conversationId: row.conversation_id,
    openedAt: row.opened_at,
    closedAt: row.closed_at,
    outcome: (row.outcome as BookingSessionOutcome | null) ?? null,
    dropStep: (row.drop_step as BookingSessionStep | null) ?? null,
    maxStep: (row.max_step as BookingSessionStep | null) ?? null,
    inboundTurns: row.inbound_turns,
    flowUsed: row.flow_used === 1,
    openReason: row.open_reason as BookingSessionOpenReason,
    serviceId: row.service_id,
    variantSelectionMode: (row.variant_selection_mode as 'uma' | 'varias' | null) ?? null,
  }
}

export function getOpenBookingSession(
  db: ClinicDb,
  tenantId: string,
  conversationId: string,
): BookingSessionRow | null {
  const row = db.get<{
    session_id: string
    tenant_id: string
    conversation_id: string
    opened_at: number
    closed_at: number | null
    outcome: string | null
    drop_step: string | null
    max_step: string | null
    inbound_turns: number
    flow_used: number
    open_reason: string
    service_id: string | null
    variant_selection_mode: string | null
  }>(
    `SELECT * FROM booking_sessions
     WHERE tenant_id = ? AND conversation_id = ? AND closed_at IS NULL
     LIMIT 1`,
    tenantId,
    conversationId,
  )
  return row ? mapRow(row) : null
}

function readVariantSelectionMode(
  db: ClinicDb,
  tenantId: string,
  serviceId: string | null,
): 'uma' | 'varias' | null {
  if (!serviceId) return null
  const row = db.get<{ mode: string }>(
    `SELECT variant_selection AS mode FROM services WHERE tenant_id = ? AND id = ?`,
    tenantId,
    serviceId,
  )
  if (row?.mode === 'uma' || row?.mode === 'varias') return row.mode
  return null
}

function inferOpenReason(
  frame: FrameHint,
  explicit?: BookingSessionOpenReason,
): BookingSessionOpenReason {
  if (explicit) return explicit
  if (!frame.serviceId && (frame.line || frame.pending)) return 'catalog_mid_booking'
  if (frame.serviceId) return 'service_named'
  return 'intent'
}

/**
 * Abre uma sessão se ainda não houver uma aberta nesta conversa e o quadro
 * indicar tentativa de marcar (não remarcação).
 */
export function openBookingSessionIfNeeded(
  db: ClinicDb,
  tenantId: string,
  conversationId: string,
  frame: FrameHint,
  clock: Clock,
  opts?: { openReason?: BookingSessionOpenReason },
): { session: BookingSessionRow | null; outbox: OutboxRow | null } {
  if (frame.phase === 'remarcando') {
    return { session: null, outbox: null }
  }
  const meaningful =
    Boolean(frame.serviceId) || Boolean(frame.line) || Boolean(frame.pending) || Boolean(frame.proposal)
  if (!meaningful) return { session: null, outbox: null }

  const existing = getOpenBookingSession(db, tenantId, conversationId)
  if (existing) {
    // Actualiza service_id / modo se o quadro avançou (mesma sessão).
    if (frame.serviceId && frame.serviceId !== existing.serviceId) {
      const mode = readVariantSelectionMode(db, tenantId, frame.serviceId)
      db.run(
        `UPDATE booking_sessions
         SET service_id = ?, variant_selection_mode = COALESCE(?, variant_selection_mode)
         WHERE session_id = ? AND closed_at IS NULL`,
        frame.serviceId,
        mode,
        existing.sessionId,
      )
      return {
        session: { ...existing, serviceId: frame.serviceId, variantSelectionMode: mode ?? existing.variantSelectionMode },
        outbox: null,
      }
    }
    return { session: existing, outbox: null }
  }

  const now = clock.nowMs()
  const sessionId = newId('bss')
  const openReason = inferOpenReason(frame, opts?.openReason)
  const serviceId = frame.serviceId
  const variantSelectionMode = readVariantSelectionMode(db, tenantId, serviceId)
  const step = deriveDropStep(frame)
  // T3: fecho Agendar via Flow → a sessão já usou Flow (opened/completed).
  const flowUsed = openReason === 'flow_agendar' ? 1 : 0

  db.run(
    `INSERT INTO booking_sessions (
       session_id, tenant_id, conversation_id, opened_at, closed_at,
       outcome, drop_step, max_step, inbound_turns, flow_used,
       open_reason, service_id, variant_selection_mode
     ) VALUES (?, ?, ?, ?, NULL, NULL, NULL, ?, 0, ?, ?, ?, ?)`,
    sessionId,
    tenantId,
    conversationId,
    now,
    step,
    flowUsed,
    openReason,
    serviceId,
    variantSelectionMode,
  )

  const payload: BookingSessionOpenedPayload = {
    event: 'booking_session.opened',
    sessionId,
    tenantId,
    conversationId,
    occurredAt: now,
    openReason,
    serviceId,
    variantSelectionMode,
    source: 'clinic_do',
  }
  assertBookingSessionOpenedMinimized(payload)
  console.log(JSON.stringify({ level: 'info', ...payload }))
  const outbox = insertOutboxEvent(
    db,
    {
      tenantId,
      type: 'booking_session.opened',
      aggregateType: 'booking_session',
      aggregateId: sessionId,
      idempotencyKey: `booking_session.opened:${sessionId}`,
      payload: { ...payload },
    },
    clock,
  )

  return {
    session: {
      sessionId,
      tenantId,
      conversationId,
      openedAt: now,
      closedAt: null,
      outcome: null,
      dropStep: null,
      maxStep: step,
      inboundTurns: 0,
      flowUsed: flowUsed === 1,
      openReason,
      serviceId,
      variantSelectionMode,
    },
    outbox,
  }
}

export type EndBookingSessionInput = {
  outcome: BookingSessionOutcome
  /** Quadro no momento do fecho (para dropStep). Ignorado se outcome = agendado. */
  frame?: FrameHint | null
  dropStep?: BookingSessionStep | null
}

/**
 * Fecha a sessão aberta da conversa (idempotente se já fechada).
 * `agendado` → dropStep null; restantes → dropStep do quadro ou explícito.
 */
export function endBookingSession(
  db: ClinicDb,
  tenantId: string,
  conversationId: string,
  input: EndBookingSessionInput,
  clock: Clock,
): { session: BookingSessionRow | null; outbox: OutboxRow | null } {
  const open = getOpenBookingSession(db, tenantId, conversationId)
  if (!open) return { session: null, outbox: null }

  const now = clock.nowMs()
  const dropStep =
    input.outcome === 'agendado'
      ? null
      : (input.dropStep ?? deriveDropStep(input.frame ?? null))
  const maxStep = open.maxStep ?? dropStep

  db.run(
    `UPDATE booking_sessions
     SET closed_at = ?, outcome = ?, drop_step = ?, max_step = COALESCE(?, max_step)
     WHERE session_id = ? AND closed_at IS NULL`,
    now,
    input.outcome,
    dropStep,
    maxStep,
    open.sessionId,
  )

  const payload: BookingSessionEndedPayload = {
    event: 'booking_session.ended',
    sessionId: open.sessionId,
    tenantId,
    conversationId,
    occurredAt: now,
    outcome: input.outcome,
    dropStep,
    inboundTurns: open.inboundTurns,
    flowUsed: open.flowUsed,
    durationMs: Math.max(0, now - open.openedAt),
    source: 'clinic_do',
  }
  assertBookingSessionEndedMinimized(payload)
  console.log(JSON.stringify({ level: 'info', ...payload }))
  const outbox = insertOutboxEvent(
    db,
    {
      tenantId,
      type: 'booking_session.ended',
      aggregateType: 'booking_session',
      aggregateId: open.sessionId,
      idempotencyKey: `booking_session.ended:${open.sessionId}`,
      payload: { ...payload },
    },
    clock,
  )

  return {
    session: {
      ...open,
      closedAt: now,
      outcome: input.outcome,
      dropStep,
      maxStep: maxStep ?? open.maxStep,
    },
    outbox,
  }
}

const STEP_RANK: Record<BookingSessionStep, number> = {
  hub: 0,
  audience: 1,
  service: 2,
  variant_ask: 3,
  day_ask: 4,
  echo: 5,
  slot_offer: 6,
  proposal: 7,
  confirm: 8,
}

/**
 * T2: incrementa `inbound_turns` e actualiza `max_step` na sessão aberta.
 * Devolve o `sessionId` (ou null se não houver sessão aberta).
 */
export function touchBookingSessionOnTurn(
  db: ClinicDb,
  tenantId: string,
  conversationId: string,
  step: BookingSessionStep | null,
): string | null {
  const open = getOpenBookingSession(db, tenantId, conversationId)
  if (!open) return null
  const nextMax =
    step && (open.maxStep == null || STEP_RANK[step] > STEP_RANK[open.maxStep])
      ? step
      : open.maxStep
  db.run(
    `UPDATE booking_sessions
     SET inbound_turns = inbound_turns + 1,
         max_step = COALESCE(?, max_step)
     WHERE session_id = ? AND closed_at IS NULL`,
    nextMax,
    open.sessionId,
  )
  return open.sessionId
}

export type RecordBookingSessionFlowInput = {
  flowState: BookingSessionFlowState
  /** Token em claro — só usado para derivar `flowTokenId` (hash); nunca vai ao payload. */
  flowToken?: string | null
  skipReason?: BookingSessionFlowSkipReason
  /**
   * Chave extra de idempotência (ex. messageId do hub) quando não há token
   * (`skipped` sem binding / sem secrets).
   */
  attemptId?: string | null
}

/**
 * T3: emite `booking_session.flow` (outbox + log) e marca `flowUsed` em
 * `opened` / `completed` quando há sessão aberta. Sem corpo de mensagem.
 * Idempotente por `(flowState, flowTokenId|attemptId)`.
 */
export function recordBookingSessionFlow(
  db: ClinicDb,
  tenantId: string,
  conversationId: string,
  input: RecordBookingSessionFlowInput,
  clock: Clock,
): { sessionId: string | null; outbox: OutboxRow; payload: BookingSessionFlowPayload } {
  const open = getOpenBookingSession(db, tenantId, conversationId)
  const sessionId = open?.sessionId ?? null
  const flowTokenId = hashFlowTokenForAnalytics(input.flowToken)
  const now = clock.nowMs()

  const marksUsed = input.flowState === 'opened' || input.flowState === 'completed'
  if (marksUsed && open && !open.flowUsed) {
    db.run(
      `UPDATE booking_sessions SET flow_used = 1
       WHERE session_id = ? AND closed_at IS NULL`,
      open.sessionId,
    )
  }

  const payload: BookingSessionFlowPayload = {
    event: 'booking_session.flow',
    sessionId,
    tenantId,
    conversationId,
    occurredAt: now,
    flowTokenId,
    flowState: input.flowState,
    ...(input.flowState === 'skipped' && input.skipReason
      ? { skipReason: input.skipReason }
      : {}),
    source: 'clinic_do',
  }
  assertBookingSessionFlowMinimized(payload)
  console.log(
    JSON.stringify({
      level: input.flowState === 'skipped' ? 'warn' : 'info',
      ...payload,
    }),
  )

  const idKey =
    flowTokenId ??
    (input.attemptId ? `attempt:${input.attemptId}` : `cnv:${conversationId}:${now}`)
  const idempotencyKey =
    input.flowState === 'skipped' && input.skipReason
      ? `booking_session.flow:skipped:${idKey}:${input.skipReason}`
      : `booking_session.flow:${input.flowState}:${idKey}`

  const outbox = insertOutboxEvent(
    db,
    {
      tenantId,
      type: 'booking_session.flow',
      aggregateType: 'booking_session',
      aggregateId: sessionId ?? conversationId,
      idempotencyKey,
      payload: { ...payload },
    },
    clock,
  )

  return { sessionId, outbox, payload }
}

/**
 * Fecha sessões abertas sem inbound há mais de W (Confirmado: 24 h, P4).
 * Chamável por idle / manutenção; não é obrigatório no caminho quente T1.
 */
export function endAbandonedSessionsPastWindow(
  db: ClinicDb,
  tenantId: string,
  clock: Clock,
  windowMs: number = BOOKING_SESSION_ABANDON_WINDOW_MS,
): OutboxRow[] {
  const cutoff = clock.nowMs() - windowMs
  const rows = db.all<{ session_id: string; conversation_id: string }>(
    `SELECT session_id, conversation_id FROM booking_sessions
     WHERE tenant_id = ? AND closed_at IS NULL AND opened_at <= ?`,
    tenantId,
    cutoff,
  )
  const out: OutboxRow[] = []
  for (const row of rows) {
    const { outbox } = endBookingSession(
      db,
      tenantId,
      row.conversation_id,
      { outcome: 'abandon', dropStep: 'hub' },
      clock,
    )
    if (outbox) out.push(outbox)
  }
  return out
}
