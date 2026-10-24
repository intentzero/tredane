import { describe, expect, it } from 'vitest'
import { createControllableClock } from '../db/clock'
import {
  acknowledgeOutboxResult,
  assertClinicSchemaReady,
  CLINIC_SCHEMA_VERSION,
  getBoundTenant,
  ingestContactMessage,
  listContacts,
  listOperationalAudit,
  listPendingOutbox,
  markClinicSchemaFailed,
  publishPendingEffects,
  queueCaller,
  runClinicMigrations,
  SchemaNotReadyError,
  TenantMismatchError,
  UnauthorizedCallerError,
  workerCaller,
} from './index'
import { bootClinicDb, openClinicMemoryDb } from './test-db'
import { fromNodeSqlite } from './store'
import { CLINIC_MIGRATIONS } from './migrations'

describe('Clinic SQLite — migrations por instância', () => {
  it('aplica fundação empty → ready na versão alvo', () => {
    const { db, close } = bootClinicDb()
    try {
      assertClinicSchemaReady(db)
      const state = db.get<{ version: number; status: string }>(
        'SELECT version, status FROM clinic_schema_state WHERE id = 1',
      )
      expect(state).toEqual({ version: CLINIC_SCHEMA_VERSION, status: 'ready' })
      const applied = db.all<{ name: string }>(
        'SELECT name FROM clinic_schema_migrations ORDER BY id',
      )
      expect(applied.map((r) => r.name)).toEqual(
        CLINIC_MIGRATIONS.map((m) => m.name),
      )
    } finally {
      close()
    }
  })

  it('reexecução é idempotente (already_ready)', () => {
    const { db, clock, close } = bootClinicDb()
    try {
      const second = runClinicMigrations(db, clock)
      expect(second.status).toBe('already_ready')
      expect(second.applied).toEqual([])
    } finally {
      close()
    }
  })

  it('schema failed bloqueia operações até retoma bem-sucedida', () => {
    const clock = createControllableClock()
    const raw = openClinicMemoryDb()
    const db = fromNodeSqlite(raw)
    try {
      markClinicSchemaFailed(db, clock)
      expect(() => assertClinicSchemaReady(db)).toThrow(SchemaNotReadyError)

      const result = runClinicMigrations(db, clock)
      expect(result.status).toBe('ready')
      assertClinicSchemaReady(db)
    } finally {
      raw.close()
    }
  })

  it('duas instâncias in-memory não partilham dados com o mesmo id lógico', () => {
    const a = bootClinicDb()
    const b = bootClinicDb()
    try {
      const callerA = workerCaller('clinic-demo-a', 'user_synth_a')
      const callerB = workerCaller('clinic-demo-b', 'user_synth_b')

      ingestContactMessage(
        a.db,
        callerA,
        {
          providerEventKey: 'wa:evt:same-logical-id',
          waId: '5511999990001',
          displayName: 'Ana A',
          body: 'olá A',
        },
        a.clock,
      )
      ingestContactMessage(
        b.db,
        callerB,
        {
          providerEventKey: 'wa:evt:same-logical-id',
          waId: '5511999990001',
          displayName: 'Bruno B',
          body: 'olá B',
        },
        b.clock,
      )

      const contactsA = listContacts(a.db, 'clinic-demo-a')
      const contactsB = listContacts(b.db, 'clinic-demo-b')
      expect(contactsA).toHaveLength(1)
      expect(contactsB).toHaveLength(1)
      expect(contactsA[0]?.displayName).toBe('Ana A')
      expect(contactsB[0]?.displayName).toBe('Bruno B')
      expect(listContacts(a.db, 'clinic-demo-b')).toEqual([])
    } finally {
      a.close()
      b.close()
    }
  })
})

describe('Clinic — envelopes, tenant e outbox', () => {
  it('recusa assertion/chamador inválido e tenant forjado', () => {
    const { db, clock, close } = bootClinicDb()
    try {
      expect(() =>
        ingestContactMessage(
          db,
          {
            kind: 'worker_internal',
            tenantId: 'clinic-demo-a',
            assertion: 'tredane-queue-v1',
          },
          {
            providerEventKey: 'k1',
            waId: '5511000000001',
            body: 'x',
          },
          clock,
        ),
      ).toThrow(UnauthorizedCallerError)

      expect(() =>
        ingestContactMessage(
          db,
          workerCaller('evil-tenant'),
          {
            providerEventKey: 'k2',
            waId: '5511000000002',
            body: 'x',
          },
          clock,
        ),
      ).toThrow(TenantMismatchError)

      ingestContactMessage(
        db,
        workerCaller('clinic-demo-a'),
        {
          providerEventKey: 'k3',
          waId: '5511000000003',
          body: 'ok',
        },
        clock,
      )
      expect(getBoundTenant(db)?.tenantId).toBe('clinic-demo-a')

      expect(() =>
        ingestContactMessage(
          db,
          workerCaller('clinic-demo-b'),
          {
            providerEventKey: 'k4',
            waId: '5511000000004',
            body: 'cross',
          },
          clock,
        ),
      ).toThrow(TenantMismatchError)
    } finally {
      close()
    }
  })

  it('deduplica inbound e não cria segundo outbox', () => {
    const { db, clock, close } = bootClinicDb()
    try {
      const caller = workerCaller('clinic-demo-a')
      const first = ingestContactMessage(
        db,
        caller,
        {
          providerEventKey: 'wa:dup:1',
          waId: '5511888777666',
          body: 'primeira',
        },
        clock,
      )
      expect(first.duplicate).toBe(false)
      expect(first.outbox?.processingState).toBe('pending')

      const second = ingestContactMessage(
        db,
        caller,
        {
          providerEventKey: 'wa:dup:1',
          waId: '5511888777666',
          body: 'reentrega',
        },
        clock,
      )
      expect(second.duplicate).toBe(true)
      expect(second.outbox).toBeNull()
      expect(listContacts(db, 'clinic-demo-a')).toHaveLength(1)
      // contact.upserted + message.created + conversation.created|updated + opportunity.created (#30)
      expect(listPendingOutbox(db, 'clinic-demo-a')).toHaveLength(4)
      expect(listOperationalAudit(db, 'clinic-demo-a')).toHaveLength(1)
    } finally {
      close()
    }
  })

  it('crash entre commit e publish recupera outbox sem duplicar entidade', async () => {
    const { db, clock, close } = bootClinicDb()
    try {
      const caller = workerCaller('clinic-demo-a')
      const ingested = ingestContactMessage(
        db,
        caller,
        {
          providerEventKey: 'wa:crash:1',
          waId: '5511777666555',
          displayName: 'Carla',
          body: 'antes do publish',
        },
        clock,
      )
      expect(ingested.externalCallsInsideTransaction).toBe(0)
      expect(listPendingOutbox(db, 'clinic-demo-a')).toHaveLength(4)

      // Simula crash: não chama publish. Reinício = novo drain.
      const publishedIds: string[] = []
      const drain1 = await publishPendingEffects(
        db,
        caller,
        {
          async publish(envelope) {
            publishedIds.push(envelope.eventId)
          },
        },
        clock,
      )
      expect(drain1.published).toHaveLength(4)
      expect(publishedIds).toHaveLength(4)

      const drain2 = await publishPendingEffects(
        db,
        caller,
        {
          async publish() {
            throw new Error('não deve republicar')
          },
        },
        clock,
      )
      expect(drain2.published).toEqual([])
      expect(listContacts(db, 'clinic-demo-a')).toHaveLength(1)

      const ack = acknowledgeOutboxResult(db, {
        tenantId: 'clinic-demo-a',
        outboxEventId: ingested.outbox!.id,
        idempotencyKey: ingested.outbox!.idempotencyKey,
        outcome: 'succeeded',
        providerRef: 'synth-provider-1',
        occurredAt: clock.nowMs(),
      })
      expect(ack.processingState).toBe('acknowledged')

      // Consumer com tenant errado é recusado no envelope do DO (via queue caller).
      expect(() =>
        acknowledgeOutboxResult(db, {
          tenantId: 'clinic-demo-b',
          outboxEventId: ingested.outbox!.id,
          idempotencyKey: ingested.outbox!.idempotencyKey,
          outcome: 'succeeded',
          occurredAt: clock.nowMs(),
        }),
      ).toThrow()
    } finally {
      close()
    }
  })

  it('publish falho deixa pending para retentativa; consumer usa assertion de fila', async () => {
    const { db, clock, close } = bootClinicDb()
    try {
      const caller = workerCaller('clinic-demo-a')
      const ingested = ingestContactMessage(
        db,
        caller,
        {
          providerEventKey: 'wa:retry:1',
          waId: '5511666555444',
          body: 'retry',
        },
        clock,
      )

      const fail = await publishPendingEffects(
        db,
        caller,
        {
          async publish() {
            throw new Error('queue_unavailable')
          },
        },
        clock,
      )
      expect(fail.failed).toHaveLength(4)
      expect(fail.failed).toContain(ingested.outbox!.id)
      expect(listPendingOutbox(db, 'clinic-demo-a')).toHaveLength(4)

      const ok = await publishPendingEffects(
        db,
        queueCaller('clinic-demo-a'),
        {
          async publish() {
            /* ok */
          },
        },
        clock,
      )
      expect(ok.published).toHaveLength(4)
      expect(ok.published).toContain(ingested.outbox!.id)
    } finally {
      close()
    }
  })
})
