/**
 * Cancelar compromisso com sinal pago (#40 / REQ-082 / AC-50).
 * Motivo obrigatório + Devolver/Reter registados; cancelamento da reserva
 * é independente do sucesso financeiro do estorno.
 */
import type { Clock } from '../../db/clock'
import type { PixProviderAdapter } from '../../pix'
import { PIX_SIGNAL_DISPOSITIONS } from '../constants'
import type { ClinicCaller } from '../envelopes'
import { assertValidCaller } from '../envelopes'
import { ConflictError, ValidationError } from '../errors'
import { assertClinicSchemaReady } from '../migrations'
import type { OutboxRow } from '../outbox'
import { cancelAppointmentOp } from '../scheduling'
import type { AppointmentDetail } from '../scheduling/booking-types'
import type { ClinicDb } from '../store'
import { bindOrAssertTenant } from '../tenant'
import {
  findPixChargeByAppointment,
  getPixCharge,
  recordSignalDisposition,
} from './charges'
import {
  findPixExceptionCommand,
  savePixExceptionCommand,
} from './exception-commands'
import { requestRefundOp, type RefundOpResult } from './refund'
import type { CancelPaidWithSignalInput, PixChargeRow } from './types'

export type CancelPaidWithSignalResult = {
  appointment: AppointmentDetail
  charge: PixChargeRow | null
  refund: RefundOpResult | null
  outbox: OutboxRow[]
  idempotentReplay: boolean
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

/**
 * Cancela a reserva sempre (se confirmada). Se há sinal pago:
 * - retain: regista decisão humana; sem estorno
 * - refund: regista decisão + pede estorno (pode falhar sem reverter o cancel)
 */
export async function cancelPaidAppointmentWithSignalOp(
  db: ClinicDb,
  caller: ClinicCaller,
  input: CancelPaidWithSignalInput,
  clock: Clock,
  deps?: { adapter?: PixProviderAdapter },
): Promise<CancelPaidWithSignalResult> {
  assertClinicSchemaReady(db)
  assertValidCaller(caller)
  const meta = bindOrAssertTenant(db, caller, clock)
  const clientRequestId = requireClientRequestId(input.clientRequestId)

  const existing = findPixExceptionCommand(db, meta.tenantId, clientRequestId)
  if (existing) {
    if (existing.command !== 'cancel_paid_with_signal') {
      throw new ConflictError(
        'client_request_id_reuse',
        'clientRequestId já usado noutra operação',
      )
    }
    const parsed = JSON.parse(existing.resultJson) as CancelPaidWithSignalResult
    return { ...parsed, outbox: [], refund: null, idempotentReplay: true }
  }

  if (
    !(PIX_SIGNAL_DISPOSITIONS as readonly string[]).includes(
      input.signalDisposition,
    )
  ) {
    throw new ValidationError(
      'signal_disposition_required',
      'Escolha Devolver ou Reter sinal (REQ-082)',
    )
  }

  const paidCharge = findPixChargeByAppointment(
    db,
    meta.tenantId,
    input.appointmentId,
  )

  // Sem cobrança paga ligada: cancelamento normal (sem decisão Pix).
  // Ainda assim exigimos disposition no contrato #40 quando a UI sabe que há sinal;
  // se não houver cobrança, ignoramos disposition e cancelamos.
  const cancelled = cancelAppointmentOp(
    db,
    caller,
    {
      clientRequestId: `${clientRequestId}:apt`,
      appointmentId: input.appointmentId,
      reason: input.reason,
      actorClerkUserId: input.actorClerkUserId,
      expectedVersion: input.expectedVersion,
    },
    clock,
  )

  let charge: PixChargeRow | null = paidCharge
  let refund: RefundOpResult | null = null
  const outbox: OutboxRow[] = [...cancelled.outbox]

  if (paidCharge && paidCharge.status === 'paid') {
    charge = recordSignalDisposition(
      db,
      meta.tenantId,
      paidCharge.id,
      {
        disposition: input.signalDisposition,
        actorClerkUserId: input.actorClerkUserId,
        note: input.note ?? null,
      },
      clock,
    )

    if (input.signalDisposition === 'refund') {
      if (!deps?.adapter) {
        throw new ValidationError(
          'pix_adapter_required',
          'Adaptador Pix necessário para devolver o sinal',
        )
      }
      // Estorno separado — falha financeira NÃO reabre o compromisso.
      refund = await requestRefundOp(
        db,
        caller,
        {
          clientRequestId: `${clientRequestId}:refund`,
          chargeId: paidCharge.id,
          actorClerkUserId: input.actorClerkUserId,
          reason: input.note ?? `Cancelamento: ${input.reason}`,
        },
        clock,
        { adapter: deps.adapter },
      )
      charge = refund.charge
      outbox.push(...refund.outbox)
    }
  } else if (paidCharge) {
    charge = getPixCharge(db, meta.tenantId, paidCharge.id)
  }

  const payload: CancelPaidWithSignalResult = {
    appointment: cancelled.value,
    charge,
    refund,
    outbox,
    idempotentReplay: false,
  }

  db.transactionSync(() => {
    savePixExceptionCommand(db, {
      tenantId: meta.tenantId,
      clientRequestId,
      command: 'cancel_paid_with_signal',
      chargeId: charge?.id ?? null,
      appointmentId: input.appointmentId,
      result: {
        appointment: payload.appointment,
        charge: payload.charge,
        refund: payload.refund
          ? { ...payload.refund, outbox: [] }
          : null,
        outbox: [],
        idempotentReplay: false,
      },
      createdAt: clock.nowMs(),
    })
  })

  return payload
}

/** Indica se o compromisso tem sinal pago que exige Devolver/Reter. */
export function getPaidSignalForAppointmentOp(
  db: ClinicDb,
  caller: ClinicCaller,
  appointmentId: string,
  clock: Clock,
): PixChargeRow | null {
  assertClinicSchemaReady(db)
  assertValidCaller(caller)
  const meta = bindOrAssertTenant(db, caller, clock)
  const charge = findPixChargeByAppointment(db, meta.tenantId, appointmentId)
  if (!charge) return null
  if (
    charge.status === 'paid' ||
    charge.status === 'refund_requested' ||
    charge.status === 'refund_failed' ||
    charge.status === 'refunded'
  ) {
    return charge
  }
  return null
}
