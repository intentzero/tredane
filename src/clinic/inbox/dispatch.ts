/**
 * Envio imediato de `whatsapp.send` (pedido HTTP) com a fila só como fallback.
 *
 * Idempotência: antes de chamar a Meta, quem envia (pedido inline OU consumer
 * da fila) tem de «reivindicar» o outbox no DO. Só um consegue; o outro vê
 * `in_flight`/`done` e não envia. Um claim que nunca recebeu resultado (worker
 * morreu a meio da chamada Meta) é resolvido como `unknown` («Verificando
 * envio…») com motivo `send_result_lost` — nunca reenviado, nunca deixado em
 * `pending` para sempre.
 */
import type { Clock } from '../../db/clock'
import type { ClinicDb } from '../store'
import type { ClinicCaller } from '../envelopes'
import { applyOutboundSendResultOp } from './operations'
import type { OutboxRow } from '../outbox'

/** Claim sem resultado após este tempo → resolvido como unknown. */
export const OUTBOUND_CLAIM_STALE_MS = 60_000
/** Mensagem `pending` já publicada sem claim (fluxo antigo) → unknown após isto. */
export const OUTBOUND_PENDING_STALE_MS = 120_000
/** Atraso do fallback da fila quando o envio inline foi agendado. */
export const OUTBOUND_INLINE_FALLBACK_DELAY_S = 20

export type ClaimOutboundSendResult =
  | { status: 'claimed' }
  | { status: 'done'; deliveryState: string }
  | { status: 'in_flight'; claimedAt: number }
  | { status: 'resolved_stale' }
  | { status: 'missing' }

type OutboxSql = {
  id: string
  aggregate_id: string
  type: string
  processing_state: string
  payload_json: string
  idempotency_key: string
}

function parsePayload(json: string): Record<string, unknown> {
  try {
    return JSON.parse(json) as Record<string, unknown>
  } catch {
    return {}
  }
}

export type ClaimOutboundSendOutcome = {
  value: ClaimOutboundSendResult
  /** Outbox de fan-out (delivery_updated) quando um claim antigo foi resolvido. */
  outbox: OutboxRow[]
}

export function claimOutboundSendOp(
  db: ClinicDb,
  caller: ClinicCaller,
  input: { outboxEventId: string; idempotencyKey: string; staleAfterMs?: number },
  clock: Clock,
): ClaimOutboundSendOutcome {
  const staleAfter = input.staleAfterMs ?? OUTBOUND_CLAIM_STALE_MS
  const now = clock.nowMs()
  const decision = db.transactionSync(():
    | ClaimOutboundSendResult
    | { status: 'stale'; outboundId: string } => {
    const row = db.get<OutboxSql>(
      `SELECT id, aggregate_id, type, processing_state, payload_json, idempotency_key
       FROM outbox_events WHERE tenant_id = ? AND id = ?`,
      caller.tenantId,
      input.outboxEventId,
    )
    if (!row || row.type !== 'whatsapp.send' || row.idempotency_key !== input.idempotencyKey) {
      return { status: 'missing' }
    }
    const ob = db.get<{ delivery_state: string }>(
      `SELECT delivery_state FROM outbound_messages WHERE tenant_id = ? AND id = ?`,
      caller.tenantId,
      row.aggregate_id,
    )
    if (!ob) return { status: 'missing' }
    if (
      row.processing_state === 'acknowledged' ||
      row.processing_state === 'failed' ||
      ob.delivery_state !== 'pending'
    ) {
      return { status: 'done', deliveryState: ob.delivery_state }
    }
    const payload = parsePayload(row.payload_json)
    const claimedAt =
      typeof payload.dispatchClaimedAt === 'number' ? payload.dispatchClaimedAt : null
    if (claimedAt != null) {
      if (now - claimedAt < staleAfter) return { status: 'in_flight', claimedAt }
      return { status: 'stale', outboundId: row.aggregate_id }
    }
    payload.dispatchClaimedAt = now
    db.run(
      `UPDATE outbox_events SET payload_json = ?, attempt_count = attempt_count + 1
       WHERE tenant_id = ? AND id = ?`,
      JSON.stringify(payload),
      caller.tenantId,
      row.id,
    )
    return { status: 'claimed' }
  })

  if (decision.status !== 'stale') return { value: decision, outbox: [] }
  const resolved = applyOutboundSendResultOp(
    db,
    caller,
    {
      outboundId: decision.outboundId,
      outboxEventId: input.outboxEventId,
      idempotencyKey: input.idempotencyKey,
      outcome: 'uncertain',
      errorCode: 'send_result_lost',
    },
    clock,
  )
  return { value: { status: 'resolved_stale' }, outbox: resolved.outbox }
}

/** Liberta um claim quando a Meta comprovadamente NÃO foi chamada. */
export function releaseOutboundSendOp(
  db: ClinicDb,
  caller: ClinicCaller,
  input: { outboxEventId: string; idempotencyKey: string },
): { released: boolean } {
  return db.transactionSync(() => {
    const row = db.get<OutboxSql>(
      `SELECT id, aggregate_id, type, processing_state, payload_json, idempotency_key
       FROM outbox_events WHERE tenant_id = ? AND id = ?`,
      caller.tenantId,
      input.outboxEventId,
    )
    if (!row || row.idempotency_key !== input.idempotencyKey) return { released: false }
    const payload = parsePayload(row.payload_json)
    if (payload.dispatchClaimedAt == null) return { released: false }
    delete payload.dispatchClaimedAt
    db.run(
      `UPDATE outbox_events SET payload_json = ? WHERE tenant_id = ? AND id = ?`,
      JSON.stringify(payload),
      caller.tenantId,
      row.id,
    )
    return { released: true }
  })
}

/**
 * Resolve envios presos em `pending` (resultado perdido: claim antigo, ou
 * mensagem da fila consumida sem resultado — caso 13:06 de 2026-10-27).
 * Não reenvia: marca `unknown` com motivo, para a equipa verificar.
 */
export function sweepStuckOutboundOp(
  db: ClinicDb,
  caller: ClinicCaller,
  clock: Clock,
  opts: { claimStaleMs?: number; pendingStaleMs?: number } = {},
): { resolved: string[]; outbox: OutboxRow[]; nextCheckAt: number | null } {
  const now = clock.nowMs()
  const claimStale = opts.claimStaleMs ?? OUTBOUND_CLAIM_STALE_MS
  const pendingStale = opts.pendingStaleMs ?? OUTBOUND_PENDING_STALE_MS
  const rows = db.all<OutboxSql & { created_at: number }>(
    `SELECT e.id, e.aggregate_id, e.type, e.processing_state, e.payload_json,
            e.idempotency_key, o.created_at AS created_at
     FROM outbox_events e
     JOIN outbound_messages o ON o.tenant_id = e.tenant_id AND o.id = e.aggregate_id
     WHERE e.tenant_id = ? AND e.type = 'whatsapp.send'
       AND e.processing_state = 'published' AND o.delivery_state = 'pending'
     LIMIT 50`,
    caller.tenantId,
  )
  const resolved: string[] = []
  const outbox: OutboxRow[] = []
  let nextCheckAt: number | null = null
  for (const row of rows) {
    const payload = parsePayload(row.payload_json)
    const claimedAt =
      typeof payload.dispatchClaimedAt === 'number' ? payload.dispatchClaimedAt : null
    const dueAt = claimedAt != null ? claimedAt + claimStale : row.created_at + pendingStale
    if (dueAt > now) {
      nextCheckAt = nextCheckAt == null ? dueAt : Math.min(nextCheckAt, dueAt)
      continue
    }
    const r = applyOutboundSendResultOp(
      db,
      caller,
      {
        outboundId: row.aggregate_id,
        outboxEventId: row.id,
        idempotencyKey: row.idempotency_key,
        outcome: 'uncertain',
        errorCode: 'send_result_lost',
      },
      clock,
    )
    resolved.push(row.aggregate_id)
    outbox.push(...r.outbox)
  }
  return { resolved, outbox, nextCheckAt }
}
