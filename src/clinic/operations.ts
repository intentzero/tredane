import type { Clock } from '../db/clock'
import { writeOperationalAudit } from './audit'
import { upsertContact, type ContactRow } from './contacts'
import type { ClinicCaller } from './envelopes'
import { assertValidCaller } from './envelopes'
import { recordInboundEvent, type InboundRow } from './inbound'
import { assertClinicSchemaReady } from './migrations'
import {
  drainOutbox,
  insertOutboxEvent,
  type OutboxPublisher,
  type OutboxRow,
} from './outbox'
import type { ClinicDb } from './store'
import { bindOrAssertTenant } from './tenant'

export type IngestContactMessageInput = {
  providerEventKey: string
  waId: string
  displayName?: string
  body: string
}

export type IngestContactMessageResult = {
  duplicate: boolean
  contact: ContactRow
  inbound: InboundRow
  outbox: OutboxRow | null
  /**
   * Efeitos externos NÃO executados aqui — o chamador deve chamar
   * `publishPendingEffects` depois do commit (ou o DO faz drain pós-RPC).
   */
  externalCallsInsideTransaction: 0
}

/**
 * Primitiva transacional: dedup inbound + contacto + audit + outbox.
 * Proibido HTTP/Queues/R2 dentro de `transactionSync` (ADR-0012).
 */
export function ingestContactMessage(
  db: ClinicDb,
  caller: ClinicCaller,
  input: IngestContactMessageInput,
  clock: Clock,
): IngestContactMessageResult {
  assertClinicSchemaReady(db)
  assertValidCaller(caller)
  const meta = bindOrAssertTenant(db, caller, clock)

  return db.transactionSync(() => {
    const inbound = recordInboundEvent(
      db,
      {
        tenantId: meta.tenantId,
        providerEventKey: input.providerEventKey,
        payload: {
          waId: input.waId,
          displayName: input.displayName ?? null,
          body: input.body,
        },
      },
      clock,
    )

    if (inbound.duplicate) {
      const contact = upsertContact(
        db,
        { tenantId: meta.tenantId, waId: input.waId, displayName: input.displayName },
        clock,
      )
      return {
        duplicate: true,
        contact,
        inbound: inbound.row,
        outbox: null,
        externalCallsInsideTransaction: 0,
      }
    }

    const contact = upsertContact(
      db,
      { tenantId: meta.tenantId, waId: input.waId, displayName: input.displayName },
      clock,
    )

    writeOperationalAudit(
      db,
      {
        tenantId: meta.tenantId,
        actor: caller.actorId ?? caller.kind,
        action: 'contact.message_ingested',
        objectType: 'contact',
        objectId: contact.id,
        detail: {
          providerEventKey: input.providerEventKey,
          waId: input.waId,
        },
      },
      clock,
    )

    const outbox = insertOutboxEvent(
      db,
      {
        tenantId: meta.tenantId,
        type: 'contact.upserted',
        aggregateType: 'contact',
        aggregateId: contact.id,
        idempotencyKey: `contact.upserted:${input.providerEventKey}`,
        payload: {
          contactId: contact.id,
          waId: contact.waId,
          providerEventKey: input.providerEventKey,
          bodyPreview: input.body.slice(0, 120),
        },
      },
      clock,
    )

    return {
      duplicate: false,
      contact,
      inbound: inbound.row,
      outbox,
      externalCallsInsideTransaction: 0,
    }
  })
}

/**
 * Publicação pós-commit / recuperação após crash entre commit e publish.
 * Reprocessa outbox pending sem duplicar entidades de domínio.
 */
export async function publishPendingEffects(
  db: ClinicDb,
  caller: ClinicCaller,
  publisher: OutboxPublisher,
  clock: Clock,
): Promise<{ published: string[]; failed: string[] }> {
  assertClinicSchemaReady(db)
  const meta = bindOrAssertTenant(db, caller, clock)
  return drainOutbox(db, meta.tenantId, publisher, clock)
}
