/**
 * Resolver alerta «Pago sem horário» (#40 / REQ-080 / AC-48).
 * - Escolher outro horário: confirma com sinal já pago (sem nova cobrança).
 * - Devolver sinal: estorno idempotente; alerta só resolve quando Devolvido.
 * Conflito no horário alternativo preserva sinal pago e alerta aberto.
 */
import type { Clock } from '../../db/clock'
import type { PixProviderAdapter } from '../../pix'
import { writeOperationalAudit } from '../audit'
import type { ClinicCaller } from '../envelopes'
import { assertValidCaller } from '../envelopes'
import { ConflictError, NotFoundError, ValidationError } from '../errors'
import { assertClinicSchemaReady } from '../migrations'
import type { OutboxRow } from '../outbox'
import { readZoneSnapshots } from '../config/zones'
import { confirmAppointmentInTransaction } from '../scheduling/booking'
import type { ClinicDb } from '../store'
import { bindOrAssertTenant } from '../tenant'
import {
  getPixPaymentAlert,
  resolvePixPaymentAlert,
} from './alerts'
import { getPixCharge, linkChargeToAppointment } from './charges'
import {
  findPixExceptionCommand,
  savePixExceptionCommand,
} from './exception-commands'
import { requestRefundOp, type RefundOpResult } from './refund'
import type {
  PixChargeRow,
  PixPaymentAlertRow,
  ResolveAlertAltSlotInput,
  ResolveAlertRefundInput,
} from './types'

export type ResolveAlertAltSlotResult = {
  alert: PixPaymentAlertRow
  charge: PixChargeRow
  appointmentId: string
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

function requireActor(caller: ClinicCaller, actorId: string): string {
  if (!caller.actorId && !actorId.trim()) {
    throw new ValidationError('actor_required', 'Actor obrigatório')
  }
  return actorId.trim() || caller.actorId!
}

/**
 * Confirma horário alternativo usando o sinal já pago.
 * Conflito → erro; alerta permanece aberto (AC #40).
 */
export function resolveAlertAltSlotOp(
  db: ClinicDb,
  caller: ClinicCaller,
  input: ResolveAlertAltSlotInput,
  clock: Clock,
): ResolveAlertAltSlotResult {
  assertClinicSchemaReady(db)
  assertValidCaller(caller)
  const meta = bindOrAssertTenant(db, caller, clock)
  const clientRequestId = requireClientRequestId(input.clientRequestId)
  const actorId = requireActor(caller, input.actorClerkUserId)

  const existing = findPixExceptionCommand(db, meta.tenantId, clientRequestId)
  if (existing) {
    if (existing.command !== 'resolve_alert_alt_slot') {
      throw new ConflictError(
        'client_request_id_reuse',
        'clientRequestId já usado noutra operação',
      )
    }
    const parsed = JSON.parse(existing.resultJson) as ResolveAlertAltSlotResult
    return { ...parsed, outbox: [], idempotentReplay: true }
  }

  const alert = getPixPaymentAlert(db, meta.tenantId, input.alertId)
  if (!alert) {
    throw new NotFoundError('pix_alert_not_found', 'Alerta não encontrado')
  }
  if (alert.status !== 'open') {
    // Já resolvido — devolve estado actual sem reabrir.
    const charge = getPixCharge(db, meta.tenantId, alert.chargeId)!
    if (alert.resolvedAppointmentId) {
      return {
        alert,
        charge,
        appointmentId: alert.resolvedAppointmentId,
        outbox: [],
        idempotentReplay: true,
      }
    }
    throw new ConflictError(
      'alert_already_resolved',
      'Alerta já resolvido sem compromisso',
    )
  }

  const charge = getPixCharge(db, meta.tenantId, alert.chargeId)
  if (!charge || charge.status !== 'paid') {
    throw new ConflictError(
      'charge_not_paid_without_slot',
      'Cobrança do alerta não está paga',
      { status: charge?.status },
    )
  }
  if (charge.paymentResolution !== 'paid_without_slot') {
    throw new ConflictError(
      'charge_not_paid_without_slot',
      'Cobrança já não está em pago sem horário',
      { resolution: charge.paymentResolution },
    )
  }

  // TX única: confirmar compromisso + ligar cobrança + resolver alerta.
  // Conflito propaga-se — alerta NÃO é tocado.
  return db.transactionSync(() => {
    const confirmed = confirmAppointmentInTransaction(
      db,
      {
        ...caller,
        actorId,
      },
      {
        clientRequestId: `${clientRequestId}:apt`,
        serviceId: input.serviceId,
        professionalId: input.professionalId,
        roomResourceId: input.roomResourceId,
        startsAt: input.startsAt,
        contactId: charge.contactId,
        conversationId: charge.conversationId,
        opportunityId: charge.opportunityId,
        actorClerkUserId: actorId,
        frozenZoneSnapshots: readZoneSnapshots(db, meta.tenantId, 'pix_charge', charge.id),
      },
      clock,
    )

    const linked = linkChargeToAppointment(
      db,
      meta.tenantId,
      charge.id,
      confirmed.value.id,
      clock,
    )
    const resolved = resolvePixPaymentAlert(
      db,
      meta.tenantId,
      alert.id,
      {
        resolutionKind: 'alt_slot_confirmed',
        resolvedByClerkUserId: actorId,
        resolvedAppointmentId: confirmed.value.id,
      },
      clock,
    )

    writeOperationalAudit(
      db,
      {
        tenantId: meta.tenantId,
        actor: actorId,
        action: 'pix.alert_resolved_alt_slot',
        objectType: 'pix_payment_alert',
        objectId: alert.id,
        detail: {
          chargeId: charge.id,
          appointmentId: confirmed.value.id,
          amountCents: charge.amountCents,
        },
      },
      clock,
    )

    const payload: ResolveAlertAltSlotResult = {
      alert: resolved,
      charge: linked,
      appointmentId: confirmed.value.id,
      outbox: confirmed.outbox,
      idempotentReplay: false,
    }
    savePixExceptionCommand(db, {
      tenantId: meta.tenantId,
      clientRequestId,
      command: 'resolve_alert_alt_slot',
      chargeId: charge.id,
      alertId: alert.id,
      appointmentId: confirmed.value.id,
      result: { ...payload, outbox: [] },
      createdAt: clock.nowMs(),
    })
    return payload
  })
}

/** Devolver sinal a partir do alerta — estorno; alerta resolve só se confirmado. */
export async function resolveAlertRefundOp(
  db: ClinicDb,
  caller: ClinicCaller,
  input: ResolveAlertRefundInput,
  clock: Clock,
  deps: { adapter: PixProviderAdapter },
): Promise<RefundOpResult> {
  assertClinicSchemaReady(db)
  assertValidCaller(caller)
  const meta = bindOrAssertTenant(db, caller, clock)
  const clientRequestId = requireClientRequestId(input.clientRequestId)
  const actorId = requireActor(caller, input.actorClerkUserId)

  const existing = findPixExceptionCommand(db, meta.tenantId, clientRequestId)
  if (existing) {
    if (existing.command !== 'resolve_alert_refund') {
      throw new ConflictError(
        'client_request_id_reuse',
        'clientRequestId já usado noutra operação',
      )
    }
    const parsed = JSON.parse(existing.resultJson) as RefundOpResult
    return { ...parsed, outbox: [], idempotentReplay: true }
  }

  const alert = getPixPaymentAlert(db, meta.tenantId, input.alertId)
  if (!alert) {
    throw new NotFoundError('pix_alert_not_found', 'Alerta não encontrado')
  }
  if (alert.status !== 'open') {
    const charge = getPixCharge(db, meta.tenantId, alert.chargeId)!
    return {
      charge,
      alert,
      outbox: [],
      idempotentReplay: true,
      refundConfirmed: charge.status === 'refunded',
      uncertain: false,
    }
  }

  // Reutiliza requestRefundOp com o mesmo clientRequestId — grava como
  // resolve_alert_refund no fim se requestRefund gravar request_refund.
  // Para manter o command kind correcto, pedimos estorno e depois
  // re-gravamos o comando se necessário.
  // Mais simples: chamar a lógica de refund com chargeId e guardar
  // resolve_alert_refund via um clientRequestId interno + wrapper.

  const nestedId = `${clientRequestId}:refund`
  const result = await requestRefundOp(
    db,
    caller,
    {
      clientRequestId: nestedId,
      chargeId: alert.chargeId,
      actorClerkUserId: actorId,
      reason: input.reason ?? 'Devolver sinal — pago sem horário',
    },
    clock,
    deps,
  )

  db.transactionSync(() => {
    savePixExceptionCommand(db, {
      tenantId: meta.tenantId,
      clientRequestId,
      command: 'resolve_alert_refund',
      chargeId: alert.chargeId,
      alertId: alert.id,
      result: { ...result, outbox: [] },
      createdAt: clock.nowMs(),
    })
  })

  // Re-ler alerta (pode ter sido resolvido se refund confirmado).
  const freshAlert = getPixPaymentAlert(db, meta.tenantId, alert.id)
  return { ...result, alert: freshAlert }
}
