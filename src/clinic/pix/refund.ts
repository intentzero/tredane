/**
 * Estorno total idempotente (#40 / REQ-082 / AC-50).
 * solicitado → devolvido | falhou; consulta antes de repetir efeito se incerto;
 * UI nunca mostra Devolvido antes de confirmação do provedor.
 */
import type { Clock } from '../../db/clock'
import type { PixProviderAdapter, PixRefund } from '../../pix'
import { writeOperationalAudit } from '../audit'
import type { ClinicCaller } from '../envelopes'
import { assertValidCaller } from '../envelopes'
import { ConflictError, NotFoundError, ValidationError } from '../errors'
import { assertClinicSchemaReady } from '../migrations'
import { insertOutboxEvent, type OutboxRow } from '../outbox'
import type { ClinicDb } from '../store'
import { bindOrAssertTenant } from '../tenant'
import {
  getPixPaymentAlertByCharge,
  resolvePixPaymentAlert,
} from './alerts'
import {
  findPixChargeByProviderId,
  getPixCharge,
  markChargeRefundFailed,
  markChargeRefundRequested,
  markChargeRefunded,
  recordSignalDisposition,
} from './charges'
import {
  findPixExceptionCommand,
  savePixExceptionCommand,
} from './exception-commands'
import {
  findPixLifecycleEvent,
  savePixLifecycleEvent,
} from './lifecycle-events'
import type {
  PixChargeRow,
  PixPaymentAlertRow,
  ProcessPixLifecycleInput,
  RequestRefundInput,
} from './types'

export type RefundOpResult = {
  charge: PixChargeRow
  alert: PixPaymentAlertRow | null
  outbox: OutboxRow[]
  idempotentReplay: boolean
  /** true se o provedor confirmou sucesso neste turno. */
  refundConfirmed: boolean
  uncertain: boolean
}

function requireClientRequestId(id: string): string {
  const trimmed = id?.trim()
  if (!trimmed) {
    throw new ValidationError(
      'client_request_id_required',
      'clientRequestId obrigatório para idempotência',
    )
  }
  return trimmed
}

function requireActor(caller: ClinicCaller, actorId: string): string {
  if (!caller.actorId && !actorId.trim()) {
    throw new ValidationError('actor_required', 'Actor obrigatório')
  }
  return actorId.trim() || caller.actorId!
}

function refundIdempotencyKey(chargeId: string): string {
  return `pixrefund:${chargeId}`
}

function emitEstornoAtualizado(
  db: ClinicDb,
  tenantId: string,
  charge: PixChargeRow,
  clock: Clock,
  extra?: Record<string, unknown>,
): OutboxRow {
  return insertOutboxEvent(
    db,
    {
      tenantId,
      type: 'estorno.atualizado',
      aggregateType: 'pix_charge',
      aggregateId: charge.id,
      idempotencyKey: `estorno.atualizado:${charge.id}:${charge.status}:${charge.refundCompletedAt ?? charge.refundRequestedAt ?? clock.nowMs()}`,
      payload: {
        chargeId: charge.id,
        status: charge.status,
        conversationId: charge.conversationId,
        contactId: charge.contactId,
        amountCents: charge.amountCents,
        refundProviderId: charge.refundProviderId,
        ...extra,
      },
    },
    clock,
  )
}

function applyProviderRefundResult(
  db: ClinicDb,
  tenantId: string,
  charge: PixChargeRow,
  refund: PixRefund,
  clock: Clock,
  actorId: string,
): { charge: PixChargeRow; alert: PixPaymentAlertRow | null; outbox: OutboxRow[] } {
  const outbox: OutboxRow[] = []
  let next: PixChargeRow
  if (refund.status === 'succeeded') {
    next = markChargeRefunded(
      db,
      tenantId,
      charge.id,
      { providerRefundId: refund.providerRefundId },
      clock,
    )
  } else if (refund.status === 'failed') {
    next = markChargeRefundFailed(
      db,
      tenantId,
      charge.id,
      refund.failureReason ?? 'Estorno falhou no provedor',
      clock,
    )
  } else {
    next = markChargeRefundRequested(
      db,
      tenantId,
      charge.id,
      {
        idempotencyKey: charge.refundIdempotencyKey ?? refundIdempotencyKey(charge.id),
        providerRefundId: refund.providerRefundId,
      },
      clock,
    )
  }

  outbox.push(emitEstornoAtualizado(db, tenantId, next, clock))

  let alert: PixPaymentAlertRow | null = getPixPaymentAlertByCharge(
    db,
    tenantId,
    charge.id,
  )

  // Alerta M-32 só resolve quando devolução confirmada (não no pedido).
  if (refund.status === 'succeeded' && alert?.status === 'open') {
    alert = resolvePixPaymentAlert(
      db,
      tenantId,
      alert.id,
      {
        resolutionKind: 'refunded',
        resolvedByClerkUserId: actorId,
      },
      clock,
    )
  }

  writeOperationalAudit(
    db,
    {
      tenantId,
      actor: actorId,
      action:
        refund.status === 'succeeded'
          ? 'pix.refund_succeeded'
          : refund.status === 'failed'
            ? 'pix.refund_failed'
            : 'pix.refund_requested',
      objectType: 'pix_charge',
      objectId: charge.id,
      detail: {
        refundStatus: refund.status,
        amountCents: charge.amountCents,
        // sem dados bancários / chave Pix
      },
    },
    clock,
  )

  return { charge: next, alert, outbox }
}

/**
 * Pede estorno total. Dois cliques / retries com o mesmo clientRequestId
 * não duplicam efeito. Status incerto → consulta getRefund / getCharge antes
 * de novo efeito.
 */
export async function requestRefundOp(
  db: ClinicDb,
  caller: ClinicCaller,
  input: RequestRefundInput,
  clock: Clock,
  deps: { adapter: PixProviderAdapter },
): Promise<RefundOpResult> {
  assertClinicSchemaReady(db)
  assertValidCaller(caller)
  const meta = bindOrAssertTenant(db, caller, clock)
  const clientRequestId = requireClientRequestId(input.clientRequestId)
  const actorId = requireActor(caller, input.actorClerkUserId)

  const existingCmd = findPixExceptionCommand(db, meta.tenantId, clientRequestId)
  if (existingCmd) {
    if (
      existingCmd.command !== 'request_refund' &&
      existingCmd.command !== 'retry_refund' &&
      existingCmd.command !== 'resolve_alert_refund'
    ) {
      throw new ConflictError(
        'client_request_id_reuse',
        'clientRequestId já usado noutra operação',
      )
    }
    const parsed = JSON.parse(existingCmd.resultJson) as RefundOpResult
    return { ...parsed, outbox: [], idempotentReplay: true }
  }

  const charge = getPixCharge(db, meta.tenantId, input.chargeId)
  if (!charge) {
    throw new NotFoundError('pix_charge_not_found', 'Cobrança não encontrada')
  }

  if (charge.status === 'refunded') {
    const alert = getPixPaymentAlertByCharge(db, meta.tenantId, charge.id)
    return {
      charge,
      alert,
      outbox: [],
      idempotentReplay: true,
      refundConfirmed: true,
      uncertain: false,
    }
  }

  if (
    charge.status !== 'paid' &&
    charge.status !== 'refund_failed' &&
    charge.status !== 'refund_requested'
  ) {
    throw new ConflictError(
      'charge_not_refundable',
      'Só é possível devolver sinal pago (ou retentar estorno falhado)',
      { status: charge.status },
    )
  }

  if (!charge.providerChargeId) {
    throw new ValidationError(
      'provider_charge_missing',
      'Cobrança sem identificador no provedor',
    )
  }

  // Nova tentativa após falha confirmada → nova chave (não reutilizar a falhada).
  // Mesmo clientRequestId já foi tratado acima (idempotência de clique).
  const idemKey =
    charge.status === 'refund_failed'
      ? `pixrefund:${charge.id}:r${clock.nowMs()}`
      : charge.refundIdempotencyKey ?? refundIdempotencyKey(charge.id)

  // Status incerto / já solicitado: consultar antes de repetir efeito.
  if (charge.status === 'refund_requested' && charge.refundProviderId) {
    const consulted = await deps.adapter.getRefund(charge.refundProviderId)
    if (consulted.ok) {
      const applied = db.transactionSync(() => {
        const current = getPixCharge(db, meta.tenantId, charge.id)!
        const result = applyProviderRefundResult(
          db,
          meta.tenantId,
          current,
          consulted.value,
          clock,
          actorId,
        )
        const payload: RefundOpResult = {
          ...result,
          idempotentReplay: false,
          refundConfirmed: consulted.value.status === 'succeeded',
          uncertain: false,
        }
        savePixExceptionCommand(db, {
          tenantId: meta.tenantId,
          clientRequestId,
          command: 'retry_refund',
          chargeId: charge.id,
          result: { ...payload, outbox: [] },
          createdAt: clock.nowMs(),
        })
        return payload
      })
      return applied
    }
    // not_found no getRefund (Woovi): não criar segundo estorno cego —
    // mantém refund_requested e sinaliza uncertain.
    if (consulted.code === 'not_found' || consulted.uncertain) {
      return {
        charge,
        alert: getPixPaymentAlertByCharge(db, meta.tenantId, charge.id),
        outbox: [],
        idempotentReplay: false,
        refundConfirmed: false,
        uncertain: true,
      }
    }
  }

  // Marca solicitado localmente ANTES do I/O (separar intenção de sucesso financeiro).
  db.transactionSync(() => {
    const current = getPixCharge(db, meta.tenantId, charge.id)!
    if (!current.signalDisposition) {
      recordSignalDisposition(
        db,
        meta.tenantId,
        current.id,
        {
          disposition: 'refund',
          actorClerkUserId: actorId,
          note: input.reason ?? null,
        },
        clock,
      )
    }
    markChargeRefundRequested(
      db,
      meta.tenantId,
      current.id,
      { idempotencyKey: idemKey },
      clock,
    )
  })

  const providerResult = await deps.adapter.requestRefund({
    providerChargeId: charge.providerChargeId,
    tenantId: meta.tenantId,
    accountId: charge.accountId,
    amountCents: charge.amountCents,
    idempotencyKey: idemKey,
    reason: input.reason ?? undefined,
  })

  if (!providerResult.ok) {
    if (providerResult.uncertain || providerResult.code === 'timeout') {
      // Não marcar falhou — consulta obrigatória no retry.
      const current = getPixCharge(db, meta.tenantId, charge.id)!
      const outbox = [
        emitEstornoAtualizado(db, meta.tenantId, current, clock, {
          uncertain: true,
        }),
      ]
      const payload: RefundOpResult = {
        charge: current,
        alert: getPixPaymentAlertByCharge(db, meta.tenantId, charge.id),
        outbox,
        idempotentReplay: false,
        refundConfirmed: false,
        uncertain: true,
      }
      db.transactionSync(() => {
        savePixExceptionCommand(db, {
          tenantId: meta.tenantId,
          clientRequestId,
          command: 'request_refund',
          chargeId: charge.id,
          result: { ...payload, outbox: [] },
          createdAt: clock.nowMs(),
        })
      })
      return payload
    }

    const applied = db.transactionSync(() => {
      const failed = markChargeRefundFailed(
        db,
        meta.tenantId,
        charge.id,
        providerResult.message,
        clock,
      )
      const outbox = [emitEstornoAtualizado(db, meta.tenantId, failed, clock)]
      writeOperationalAudit(
        db,
        {
          tenantId: meta.tenantId,
          actor: actorId,
          action: 'pix.refund_failed',
          objectType: 'pix_charge',
          objectId: charge.id,
          detail: { code: providerResult.code, amountCents: charge.amountCents },
        },
        clock,
      )
      const payload: RefundOpResult = {
        charge: failed,
        alert: getPixPaymentAlertByCharge(db, meta.tenantId, charge.id),
        outbox,
        idempotentReplay: false,
        refundConfirmed: false,
        uncertain: false,
      }
      savePixExceptionCommand(db, {
        tenantId: meta.tenantId,
        clientRequestId,
        command: 'request_refund',
        chargeId: charge.id,
        result: { ...payload, outbox: [] },
        createdAt: clock.nowMs(),
      })
      return payload
    })
    return applied
  }

  const applied = db.transactionSync(() => {
    const current = getPixCharge(db, meta.tenantId, charge.id)!
    const result = applyProviderRefundResult(
      db,
      meta.tenantId,
      current,
      providerResult.value,
      clock,
      actorId,
    )
    const payload: RefundOpResult = {
      ...result,
      idempotentReplay: false,
      refundConfirmed: providerResult.value.status === 'succeeded',
      uncertain: false,
    }
    savePixExceptionCommand(db, {
      tenantId: meta.tenantId,
      clientRequestId,
      command: 'request_refund',
      chargeId: charge.id,
      result: { ...payload, outbox: [] },
      createdAt: clock.nowMs(),
    })
    return payload
  })
  return applied
}

/** Webhook refund.updated — confirma Devolvido / falha sem mostrar cedo demais. */
export function processPixLifecycleRefundOp(
  db: ClinicDb,
  caller: ClinicCaller,
  input: ProcessPixLifecycleInput,
  clock: Clock,
): RefundOpResult {
  assertClinicSchemaReady(db)
  assertValidCaller(caller)
  const meta = bindOrAssertTenant(db, caller, clock)

  if (input.eventType !== 'refund.updated') {
    throw new ValidationError(
      'unsupported_lifecycle_event',
      'Esperado refund.updated',
    )
  }
  if (!input.refund) {
    throw new ValidationError('refund_payload_required', 'Payload de estorno ausente')
  }

  const existing = findPixLifecycleEvent(db, meta.tenantId, input.eventId)
  if (existing?.chargeId) {
    const charge = getPixCharge(db, meta.tenantId, existing.chargeId)!
    return {
      charge,
      alert: getPixPaymentAlertByCharge(db, meta.tenantId, charge.id),
      outbox: [],
      idempotentReplay: true,
      refundConfirmed: charge.status === 'refunded',
      uncertain: false,
    }
  }

  return db.transactionSync(() => {
    const again = findPixLifecycleEvent(db, meta.tenantId, input.eventId)
    if (again?.chargeId) {
      const c = getPixCharge(db, meta.tenantId, again.chargeId)!
      return {
        charge: c,
        alert: getPixPaymentAlertByCharge(db, meta.tenantId, c.id),
        outbox: [],
        idempotentReplay: true,
        refundConfirmed: c.status === 'refunded',
        uncertain: false,
      }
    }

    const charge = findPixChargeByProviderId(
      db,
      meta.tenantId,
      input.providerChargeId,
    )
    if (!charge) {
      throw new NotFoundError(
        'pix_charge_not_found',
        'Cobrança desconhecida nesta clínica',
      )
    }

    const refund: PixRefund = {
      providerRefundId: input.refund!.providerRefundId,
      providerChargeId: input.providerChargeId,
      tenantId: meta.tenantId,
      accountId: input.accountId,
      amountCents: input.refund!.amountCents,
      status: input.refund!.status,
      createdAt: input.occurredAt,
      updatedAt: input.occurredAt,
      failureReason: input.refund!.failureReason ?? undefined,
    }

    const applied = applyProviderRefundResult(
      db,
      meta.tenantId,
      charge,
      refund,
      clock,
      'system:pix_webhook',
    )
    savePixLifecycleEvent(db, {
      tenantId: meta.tenantId,
      eventId: input.eventId,
      chargeId: charge.id,
      eventType: 'refund.updated',
      outcome:
        refund.status === 'succeeded'
          ? 'refunded'
          : refund.status === 'failed'
            ? 'refund_failed'
            : 'refund_requested',
      processedAt: clock.nowMs(),
    })
    return {
      ...applied,
      idempotentReplay: false,
      refundConfirmed: refund.status === 'succeeded',
      uncertain: false,
    }
  })
}
