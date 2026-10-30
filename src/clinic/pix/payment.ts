/**
 * Processar pagamento Pix e confirmar horário atomicamente (#39 / DEC-047).
 * Uma transactionSync: pagamento + disputa de recursos + alerta; sem estado parcial.
 * Expiração / estorno / resolver alerta = #40.
 */
import type { Clock } from '../../db/clock'
import { writeOperationalAudit } from '../audit'
import type { ClinicCaller } from '../envelopes'
import { assertValidCaller } from '../envelopes'
import { NotFoundError, ValidationError } from '../errors'
import { assertClinicSchemaReady } from '../migrations'
import { insertOutboxEvent, type OutboxRow } from '../outbox'
import { readComboSnapshot } from '../config/combos'
import { readZoneSnapshots, snapshotDuration } from '../config/zones'
import { confirmAppointmentInTransaction } from '../scheduling/booking'
import { checkSlotAvailability } from '../scheduling/check'
import type { ClinicDb } from '../store'
import { bindOrAssertTenant } from '../tenant'
import {
  getPixPaymentAlertByCharge,
  listOpenPixPaymentAlerts,
  listOpenPixPaymentAlertsForConversation,
  upsertOpenPixPaymentAlert,
} from './alerts'
import {
  findPixChargeByProviderId,
  markChargePaidConfirmed,
  markChargePaidWithoutSlot,
} from './charges'
import { getSchedulingIntent, updateSchedulingIntent } from './intents'
import type {
  PixChargeRow,
  PixPaymentAlertRow,
  ProcessPixPaymentInput,
  SchedulingIntentRow,
} from './types'
import type { PixPaidWithoutSlotReason, PixPaymentResolution } from '../constants'

export type ProcessPixPaymentResult = {
  charge: PixChargeRow
  resolution: PixPaymentResolution
  appointmentId: string | null
  alert: PixPaymentAlertRow | null
  intent: SchedulingIntentRow | null
  outbox: OutboxRow[]
  idempotentReplay: boolean
  reason: PixPaidWithoutSlotReason | null
}

type WebhookEventSql = {
  tenant_id: string
  event_id: string
  charge_id: string | null
  outcome: string
  appointment_id: string | null
  alert_id: string | null
  processed_at: number
}

function findWebhookEvent(
  db: ClinicDb,
  tenantId: string,
  eventId: string,
): WebhookEventSql | null {
  return (
    db.get<WebhookEventSql>(
      `SELECT * FROM pix_webhook_events WHERE tenant_id = ? AND event_id = ?`,
      tenantId,
      eventId,
    ) ?? null
  )
}

function saveWebhookEvent(
  db: ClinicDb,
  input: {
    tenantId: string
    eventId: string
    chargeId: string | null
    outcome: string
    appointmentId: string | null
    alertId: string | null
    processedAt: number
  },
): void {
  db.run(
    `INSERT OR IGNORE INTO pix_webhook_events (
      tenant_id, event_id, charge_id, outcome, appointment_id, alert_id, processed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    input.tenantId,
    input.eventId,
    input.chargeId,
    input.outcome,
    input.appointmentId,
    input.alertId,
    input.processedAt,
  )
}

function parseOccurredAtMs(occurredAt: string, fallback: number): number {
  const t = Date.parse(occurredAt)
  return Number.isFinite(t) ? t : fallback
}

function replayFromCharge(
  db: ClinicDb,
  tenantId: string,
  charge: PixChargeRow,
): ProcessPixPaymentResult {
  const alert =
    charge.paymentResolution === 'paid_without_slot'
      ? getPixPaymentAlertByCharge(db, tenantId, charge.id)
      : null
  const intent = charge.schedulingIntentId
    ? getSchedulingIntent(db, tenantId, charge.schedulingIntentId)
    : null
  return {
    charge,
    resolution: charge.paymentResolution ?? 'paid_without_slot',
    appointmentId: charge.appointmentId,
    alert,
    intent,
    outbox: [],
    idempotentReplay: true,
    reason: charge.paidWithoutSlotReason,
  }
}

/**
 * Aplica `charge.paid` no DO.
 * Associa cobrança↔conta↔tenant; valor deve bater com o ledger local.
 * Confirma compromisso na mesma TX se o slot estiver livre e o prazo local válido.
 */
export function processPixPaymentOp(
  db: ClinicDb,
  caller: ClinicCaller,
  input: ProcessPixPaymentInput,
  clock: Clock,
): ProcessPixPaymentResult {
  assertClinicSchemaReady(db)
  assertValidCaller(caller)
  const meta = bindOrAssertTenant(db, caller, clock)

  if (input.eventType !== 'charge.paid') {
    throw new ValidationError(
      'unsupported_pix_event',
      'Só charge.paid aqui; use processPixLifecycle* para expired/cancel/refund',
      { eventType: input.eventType },
    )
  }
  if (!input.eventId?.trim()) {
    throw new ValidationError('event_id_required', 'eventId obrigatório')
  }
  if (!input.providerChargeId?.trim()) {
    throw new ValidationError(
      'provider_charge_id_required',
      'providerChargeId obrigatório',
    )
  }
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
    throw new ValidationError('amount_mismatch', 'Valor do pagamento inválido')
  }

  const existingEvt = findWebhookEvent(db, meta.tenantId, input.eventId)
  if (existingEvt?.charge_id) {
    const charge = findPixChargeByProviderId(
      db,
      meta.tenantId,
      input.providerChargeId,
    )
    if (charge) return replayFromCharge(db, meta.tenantId, charge)
  }

  return db.transactionSync(() => {
    // Re-check idempotência dentro da TX (reentrega concorrente).
    const evtAgain = findWebhookEvent(db, meta.tenantId, input.eventId)
    if (evtAgain?.charge_id) {
      const c = findPixChargeByProviderId(
        db,
        meta.tenantId,
        input.providerChargeId,
      )
      if (c) return replayFromCharge(db, meta.tenantId, c)
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

    // Associação verificada conta ↔ tenant (ledger local).
    if (charge.accountId !== input.accountId) {
      throw new ValidationError(
        'account_mismatch',
        'Conta do webhook não corresponde à cobrança',
        { expected: charge.accountId },
      )
    }
    if (charge.amountCents !== input.amountCents) {
      throw new ValidationError(
        'amount_mismatch',
        'Valor do webhook não corresponde à cobrança local',
        { expected: charge.amountCents, got: input.amountCents },
      )
    }

    // Já processado por outro eventId (fora de ordem / reentrega diferente).
    if (charge.paymentResolution) {
      saveWebhookEvent(db, {
        tenantId: meta.tenantId,
        eventId: input.eventId,
        chargeId: charge.id,
        outcome: 'ignored_duplicate',
        appointmentId: charge.appointmentId,
        alertId: getPixPaymentAlertByCharge(db, meta.tenantId, charge.id)?.id ?? null,
        processedAt: clock.nowMs(),
      })
      return replayFromCharge(db, meta.tenantId, charge)
    }

    const paidAt = parseOccurredAtMs(input.occurredAt, clock.nowMs())
    const now = clock.nowMs()
    const intent = charge.schedulingIntentId
      ? getSchedulingIntent(db, meta.tenantId, charge.schedulingIntentId)
      : null

    const expiredLocally =
      charge.expiresAt != null && paidAt > charge.expiresAt
    const intentOk = intent?.status === 'awaiting_signal'
    const chargeAwaiting =
      charge.status === 'awaiting_payment' ||
      // Cancelada localmente (ex.: confirmar sem sinal) — pagamento real ainda conta.
      charge.status === 'cancelled' ||
      charge.status === 'expired'

    let withoutSlotReason: PixPaidWithoutSlotReason | null = null
    if (expiredLocally) {
      withoutSlotReason = 'payment_after_expiry'
    } else if (!chargeAwaiting || charge.status === 'cancelled' || charge.status === 'expired') {
      withoutSlotReason = 'charge_not_awaiting'
    } else if (!intentOk || !intent) {
      withoutSlotReason = 'intent_unavailable'
    } else if (
      !charge.serviceId ||
      !charge.professionalId ||
      charge.startsAt == null
    ) {
      withoutSlotReason = 'intent_unavailable'
    } else {
      const paidZones = readZoneSnapshots(db, meta.tenantId, 'pix_charge', charge.id)
      const paidMinutes = snapshotDuration(paidZones)
      const check = checkSlotAvailability(
        db,
        meta.tenantId,
        {
          serviceId: charge.serviceId,
          professionalId: charge.professionalId,
          roomResourceId: charge.roomResourceId,
          startsAt: charge.startsAt,
          ...(paidMinutes != null ? { durationMinutesOverride: paidMinutes } : {}),
        },
        clock,
      )
      if (!check.available) {
        withoutSlotReason = 'slot_occupied'
      }
    }

    const outbox: OutboxRow[] = []

    if (
      !withoutSlotReason &&
      intent &&
      charge.serviceId &&
      charge.professionalId &&
      charge.startsAt != null
    ) {
      // Confirmar na mesma TX (nested savepoint). Conflito de corrida → pago sem horário.
      let confirmedAppointmentId: string | null = null
      try {
        const confirmed = confirmAppointmentInTransaction(
          db,
          {
            ...caller,
            actorId: caller.actorId ?? 'system:pix_webhook',
          },
          {
            clientRequestId: `pixpay:${charge.id}`,
            serviceId: charge.serviceId,
            professionalId: charge.professionalId,
            roomResourceId: charge.roomResourceId,
            startsAt: charge.startsAt,
            contactId: charge.contactId,
            conversationId: charge.conversationId,
            opportunityId: charge.opportunityId,
            actorClerkUserId: 'system:pix_webhook',
            frozenZoneSnapshots: readZoneSnapshots(db, meta.tenantId, 'pix_charge', charge.id),
            frozenCombo: readComboSnapshot(db, meta.tenantId, 'pix_charge', charge.id),
          },
          clock,
        )
        confirmedAppointmentId = confirmed.value.id
        outbox.push(...confirmed.outbox)
      } catch (err) {
        const code =
          err && typeof err === 'object' && 'code' in err
            ? String((err as { code: unknown }).code)
            : ''
        if (code === 'appointment_conflict') {
          withoutSlotReason = 'slot_occupied'
        } else {
          throw err
        }
      }

      if (confirmedAppointmentId && !withoutSlotReason) {
        const paid = markChargePaidConfirmed(
          db,
          meta.tenantId,
          charge.id,
          confirmedAppointmentId,
          paidAt,
          clock,
        )
        const nextIntent = updateSchedulingIntent(
          db,
          meta.tenantId,
          intent.id,
          {
            status: 'confirmed',
            appointmentId: confirmedAppointmentId,
            activeChargeId: charge.id,
          },
          clock,
        )
        outbox.push(
          insertOutboxEvent(
            db,
            {
              tenantId: meta.tenantId,
              type: 'cobranca.paga',
              aggregateType: 'pix_charge',
              aggregateId: charge.id,
              idempotencyKey: `cobranca.paga:${charge.id}`,
              payload: {
                chargeId: charge.id,
                appointmentId: confirmedAppointmentId,
                conversationId: charge.conversationId,
                contactId: charge.contactId,
                amountCents: charge.amountCents,
                resolution: 'appointment_confirmed',
                eventId: input.eventId,
              },
            },
            clock,
          ),
        )
        writeOperationalAudit(
          db,
          {
            tenantId: meta.tenantId,
            actor: 'system:pix_webhook',
            action: 'pix.payment_confirmed_appointment',
            objectType: 'pix_charge',
            objectId: charge.id,
            detail: {
              appointmentId: confirmedAppointmentId,
              eventId: input.eventId,
              amountCents: charge.amountCents,
              // sem dados bancários
            },
          },
          clock,
        )
        saveWebhookEvent(db, {
          tenantId: meta.tenantId,
          eventId: input.eventId,
          chargeId: charge.id,
          outcome: 'appointment_confirmed',
          appointmentId: confirmedAppointmentId,
          alertId: null,
          processedAt: now,
        })
        return {
          charge: paid,
          resolution: 'appointment_confirmed',
          appointmentId: confirmedAppointmentId,
          alert: null,
          intent: nextIntent,
          outbox,
          idempotentReplay: false,
          reason: null,
        }
      }
    }

    // Pago sem horário — pagamento real registado; alerta durável.
    const reason = withoutSlotReason ?? 'slot_occupied'
    const paid = markChargePaidWithoutSlot(
      db,
      meta.tenantId,
      charge.id,
      reason,
      paidAt,
      clock,
    )
    if (intent && intent.status === 'awaiting_signal') {
      updateSchedulingIntent(
        db,
        meta.tenantId,
        intent.id,
        {
          status: 'failed',
          activeChargeId: charge.id,
        },
        clock,
      )
    }
    const alert = upsertOpenPixPaymentAlert(
      db,
      meta.tenantId,
      {
        chargeId: charge.id,
        conversationId: charge.conversationId,
        contactId: charge.contactId,
        opportunityId: charge.opportunityId,
        reason,
      },
      clock,
    )
    outbox.push(
      insertOutboxEvent(
        db,
        {
          tenantId: meta.tenantId,
          type: 'cobranca.paga',
          aggregateType: 'pix_charge',
          aggregateId: charge.id,
          idempotencyKey: `cobranca.paga:${charge.id}`,
          payload: {
            chargeId: charge.id,
            appointmentId: null,
            conversationId: charge.conversationId,
            contactId: charge.contactId,
            amountCents: charge.amountCents,
            resolution: 'paid_without_slot',
            reason,
            eventId: input.eventId,
          },
        },
        clock,
      ),
    )
    outbox.push(
      insertOutboxEvent(
        db,
        {
          tenantId: meta.tenantId,
          type: 'cobranca.sem_horario',
          aggregateType: 'pix_charge',
          aggregateId: charge.id,
          idempotencyKey: `cobranca.sem_horario:${charge.id}`,
          payload: {
            chargeId: charge.id,
            alertId: alert.id,
            conversationId: charge.conversationId,
            contactId: charge.contactId,
            reason,
            eventId: input.eventId,
          },
        },
        clock,
      ),
    )
    writeOperationalAudit(
      db,
      {
        tenantId: meta.tenantId,
        actor: 'system:pix_webhook',
        action: 'pix.payment_without_slot',
        objectType: 'pix_charge',
        objectId: charge.id,
        detail: {
          reason,
          alertId: alert.id,
          eventId: input.eventId,
          amountCents: charge.amountCents,
        },
      },
      clock,
    )
    saveWebhookEvent(db, {
      tenantId: meta.tenantId,
      eventId: input.eventId,
      chargeId: charge.id,
      outcome: 'paid_without_slot',
      appointmentId: null,
      alertId: alert.id,
      processedAt: now,
    })
    return {
      charge: paid,
      resolution: 'paid_without_slot',
      appointmentId: null,
      alert,
      intent: intent
        ? getSchedulingIntent(db, meta.tenantId, intent.id)
        : null,
      outbox,
      idempotentReplay: false,
      reason,
    }
  })
}

export function listOpenPaymentAlertsOp(
  db: ClinicDb,
  caller: ClinicCaller,
  clock: Clock,
  conversationId?: string,
): PixPaymentAlertRow[] {
  assertClinicSchemaReady(db)
  assertValidCaller(caller)
  const meta = bindOrAssertTenant(db, caller, clock)
  if (conversationId) {
    return listOpenPixPaymentAlertsForConversation(
      db,
      meta.tenantId,
      conversationId,
    )
  }
  return listOpenPixPaymentAlerts(db, meta.tenantId)
}
