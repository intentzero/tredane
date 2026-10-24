import { describe, expect, it } from 'vitest'
import { createControllableClock } from '../db/clock'
import { bootAdminDb } from '../db/test-db'
import { bootClinicDb } from '../clinic/test-db'
import { workerCaller } from '../clinic'
import { ingestContactMessage } from '../clinic/operations'
import {
  appendRealtimeEvent,
  closeUserSockets,
  createFailingInvalidator,
  createMapAccessAuthority,
  deliverEventToSockets,
  denyUserAccess,
  ensureRealtimeFence,
  getAccessDenial,
  getLastEventSeq,
  listRealtimeEventsAfter,
  localFenceBlocks,
  mergeEventsById,
  reduceConnectionUiState,
  revokeMembershipAndPropagate,
  setTenantSuspendedFence,
  type DeliverySocket,
  type SocketAttachment,
} from './index'

function fakeSocket(attachment: SocketAttachment): DeliverySocket & {
  sent: string[]
  closed: Array<{ code?: number; reason?: string }>
} {
  const sent: string[] = []
  const closed: Array<{ code?: number; reason?: string }> = []
  return {
    sent,
    closed,
    send(data) {
      sent.push(data)
    },
    close(code, reason) {
      closed.push({ code, reason })
    },
    deserializeAttachment() {
      return attachment
    },
  }
}

describe('Realtime — protocolo e reconciliação (#23)', () => {
  it('máquina de estados: offline → reconnecting → live; access_revoked sticky', () => {
    let state = reduceConnectionUiState('live', { kind: 'disconnected' })
    expect(state).toBe('offline')
    state = reduceConnectionUiState(state, { kind: 'reconnecting' })
    expect(state).toBe('reconnecting')
    state = reduceConnectionUiState(state, { kind: 'reconciled' })
    expect(state).toBe('live')
    state = reduceConnectionUiState(state, { kind: 'access_revoked' })
    expect(state).toBe('access_revoked')
    state = reduceConnectionUiState(state, { kind: 'connected' })
    expect(state).toBe('access_revoked')
  })

  it('eventos versionados e merge sem duplicar eventId', () => {
    const { db, clock, close } = bootClinicDb()
    try {
      ensureRealtimeFence(db, clock)
      const a = appendRealtimeEvent(
        db,
        {
          tenantId: 'clinic-demo-a',
          type: 'contact.upserted',
          entityType: 'contact',
          entityId: 'c1',
          eventId: 'evt_1',
          payload: { n: 1 },
        },
        clock,
      )
      const b = appendRealtimeEvent(
        db,
        {
          tenantId: 'clinic-demo-a',
          type: 'contact.upserted',
          entityType: 'contact',
          entityId: 'c1',
          eventId: 'evt_1',
          payload: { n: 1 },
        },
        clock,
      )
      expect(a.seq).toBe(1)
      expect(b.seq).toBe(1)
      const c = appendRealtimeEvent(
        db,
        {
          tenantId: 'clinic-demo-a',
          type: 'contact.upserted',
          entityType: 'contact',
          entityId: 'c2',
          eventId: 'evt_2',
          payload: { n: 2 },
        },
        clock,
      )
      expect(c.seq).toBe(2)
      expect(getLastEventSeq(db)).toBe(2)

      const after0 = listRealtimeEventsAfter(db, 'clinic-demo-a', 0)
      const merged = mergeEventsById(after0.slice(0, 1), after0)
      expect(merged.map((e) => e.eventId)).toEqual(['evt_1', 'evt_2'])
    } finally {
      close()
    }
  })
})

describe('Realtime — fence e fan-out fail-closed (#23)', () => {
  it('duas sessões A recebem; B não; revogação corta A sem afetar B', async () => {
    const clinic = bootClinicDb()
    const clock = clinic.clock
    try {
      ensureRealtimeFence(clinic.db, clock)
      const caller = workerCaller('clinic-demo-a')
      ingestContactMessage(
        clinic.db,
        caller,
        {
          providerEventKey: 'wa:rt:1',
          waId: '5511999000100',
          body: 'olá',
        },
        clock,
      )
      const evt = appendRealtimeEvent(
        clinic.db,
        {
          tenantId: 'clinic-demo-a',
          type: 'contact.upserted',
          entityType: 'contact',
          entityId: 'c',
          eventId: 'evt_fan',
          payload: { preview: 'olá' },
        },
        clock,
      )

      const socketA1 = fakeSocket({
        connectionId: 'ws_a1',
        clerkUserId: 'user_synth_attendant_a',
        sessionId: 'sess_a1',
        role: 'attendant',
        tenantId: 'clinic-demo-a',
        authEpoch: 0,
        connectedAt: 1,
      })
      const socketA2 = fakeSocket({
        connectionId: 'ws_a2',
        clerkUserId: 'user_synth_owner_a',
        sessionId: 'sess_a2',
        role: 'owner',
        tenantId: 'clinic-demo-a',
        authEpoch: 0,
        connectedAt: 1,
      })
      const socketB = fakeSocket({
        connectionId: 'ws_b',
        clerkUserId: 'user_synth_multi',
        sessionId: 'sess_b',
        role: 'attendant',
        tenantId: 'clinic-demo-b',
        authEpoch: 0,
        connectedAt: 1,
      })

      const grants = new Map<string, 'owner' | 'attendant' | 'deny' | 'unavailable'>([
        ['clinic-demo-a:user_synth_attendant_a', 'attendant'],
        ['clinic-demo-a:user_synth_owner_a', 'owner'],
        ['clinic-demo-b:user_synth_multi', 'attendant'],
      ])
      const authority = createMapAccessAuthority(grants)

      const first = await deliverEventToSockets(
        clinic.db,
        [socketA1, socketA2, socketB],
        evt,
        authority,
        clock,
      )
      expect(first.delivered.sort()).toEqual(['ws_a1', 'ws_a2'])
      expect(socketB.sent).toEqual([])

      denyUserAccess(clinic.db, clock, {
        clerkUserId: 'user_synth_attendant_a',
        reason: 'membership_revoked',
        source: 'membership_revoke',
      })
      grants.set('clinic-demo-a:user_synth_attendant_a', 'deny')

      const evt2 = appendRealtimeEvent(
        clinic.db,
        {
          tenantId: 'clinic-demo-a',
          type: 'contact.upserted',
          entityType: 'contact',
          entityId: 'c',
          eventId: 'evt_fan_2',
          payload: { preview: 'depois' },
        },
        clock,
      )
      const second = await deliverEventToSockets(
        clinic.db,
        [socketA1, socketA2, socketB],
        evt2,
        authority,
        clock,
      )
      expect(second.revoked).toContain('ws_a1')
      expect(second.delivered).toEqual(['ws_a2'])
      expect(socketA1.closed.length).toBeGreaterThan(0)
      expect(JSON.parse(socketA1.sent.at(-1)!).type).toBe('access_revoked')
      expect(socketB.sent).toEqual([])
    } finally {
      clinic.close()
    }
  })

  it('authority unavailable → fail closed (não entrega payload clínico)', async () => {
    const { db, clock, close } = bootClinicDb()
    try {
      ensureRealtimeFence(db, clock)
      const evt = appendRealtimeEvent(
        db,
        {
          tenantId: 'clinic-demo-a',
          type: 'contact.upserted',
          entityType: 'contact',
          entityId: 'c',
          eventId: 'evt_unavail',
          payload: { secret: true },
        },
        clock,
      )
      const ws = fakeSocket({
        connectionId: 'ws_x',
        clerkUserId: 'user_synth_attendant_a',
        sessionId: 's',
        role: 'attendant',
        tenantId: 'clinic-demo-a',
        authEpoch: 0,
        connectedAt: 1,
      })
      const authority = createMapAccessAuthority(
        new Map([['clinic-demo-a:user_synth_attendant_a', 'unavailable']]),
      )
      const result = await deliverEventToSockets(db, [ws], evt, authority, clock)
      expect(result.skippedUnavailable).toEqual(['ws_x'])
      expect(result.delivered).toEqual([])
      expect(ws.sent).toEqual([])
    } finally {
      close()
    }
  })

  it('cache positivo antigo: attachment não concede após deny no D1', async () => {
    const { db, clock, close } = bootClinicDb()
    try {
      ensureRealtimeFence(db, clock)
      const evt = appendRealtimeEvent(
        db,
        {
          tenantId: 'clinic-demo-a',
          type: 'x',
          entityType: 'contact',
          entityId: 'c',
          eventId: 'evt_stale',
          payload: { x: 1 },
        },
        clock,
      )
      // Attachment ainda “parece” válido (authEpoch 0, role attendant).
      const ws = fakeSocket({
        connectionId: 'ws_stale',
        clerkUserId: 'user_synth_attendant_a',
        sessionId: 'old',
        role: 'attendant',
        tenantId: 'clinic-demo-a',
        authEpoch: 0,
        connectedAt: 1,
      })
      const authority = createMapAccessAuthority(
        new Map([['clinic-demo-a:user_synth_attendant_a', 'deny']]),
      )
      const result = await deliverEventToSockets(db, [ws], evt, authority, clock)
      expect(result.revoked).toEqual(['ws_stale'])
      expect(getAccessDenial(db, 'user_synth_attendant_a')).toBeTruthy()
      expect(JSON.parse(ws.sent[0]!).type).toBe('access_revoked')
    } finally {
      close()
    }
  })

  it('tenant suspenso fecha todos os sockets da clínica', () => {
    const { db, clock, close } = bootClinicDb()
    try {
      ensureRealtimeFence(db, clock)
      setTenantSuspendedFence(db, clock, true)
      expect(localFenceBlocks(db, 'anyone').blocked).toBe(true)

      const ws = fakeSocket({
        connectionId: 'ws_t',
        clerkUserId: 'user_synth_owner_a',
        sessionId: 's',
        role: 'owner',
        tenantId: 'clinic-demo-a',
        authEpoch: 0,
        connectedAt: 1,
      })
      const closed = closeUserSockets(
        [ws],
        'clinic-demo-a',
        'user_synth_owner_a',
        'tenant_not_active',
      )
      expect(closed).toEqual(['ws_t'])
    } finally {
      close()
    }
  })
})

describe('Realtime — revogação D1 com falha de notificação DO (#23)', () => {
  it('D1 confirma revoke mesmo se DO falhar; B preservado', async () => {
    const admin = bootAdminDb()
    const clock = createControllableClock(1_000_000)
    try {
      const result = await revokeMembershipAndPropagate(
        admin.db,
        clock,
        createFailingInvalidator('simulated_do_down'),
        {
          tenantId: 'clinic-demo-a',
          clerkUserId: 'user_synth_attendant_a',
          actorClerkUserId: 'user_synth_owner_a',
        },
      )
      expect(result.membership.status).toBe('revoked')
      expect(result.doNotified).toBe(false)
      expect(result.doError).toBe('simulated_do_down')

      const multiA = admin.db.get<{ status: string }>(
        `SELECT status FROM tenant_memberships
         WHERE tenant_id = ? AND clerk_user_id = ?`,
        'clinic-demo-a',
        'user_synth_multi',
      )
      const multiB = admin.db.get<{ status: string }>(
        `SELECT status FROM tenant_memberships
         WHERE tenant_id = ? AND clerk_user_id = ?`,
        'clinic-demo-b',
        'user_synth_multi',
      )
      expect(multiA?.status).toBe('active')
      expect(multiB?.status).toBe('active')
    } finally {
      admin.close()
    }
  })
})
