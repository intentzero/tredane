import { describe, expect, it } from 'vitest'
import { createApp } from '../worker/app'
import { bootAdminDb } from '../db/test-db'
import { createControllableClock } from '../db/clock'
import { asyncFromSync } from '../db/admin/async-store'
import {
  createSyntheticAuthorityReader,
  createSyntheticSessionAuthenticator,
  synthAuthHeader,
  type AuthServices,
} from '../auth'
import { bootClinicDb } from '../clinic/test-db'
import { createMemoryClinicConfigRegistry } from '../clinic-config'
import { createMemorySchedulingRegistry } from './gateway'
import { zonedCivilToUtc } from '../clinic/scheduling'
import { ingestContactMessage, workerCaller } from '../clinic'

const MONDAY = '2024-01-08'
const TZ = 'America/Sao_Paulo'

function testSchedulingApp() {
  const admin = bootAdminDb()
  // Relógio antes do dia consultado — slots passados são filtrados.
  const clock = createControllableClock(Date.UTC(2024, 0, 1))
  const clinics = new Map<string, ReturnType<typeof bootClinicDb>>()
  const getBoot = (tenantId: string) => {
    let boot = clinics.get(tenantId)
    if (!boot) {
      boot = bootClinicDb({ clock })
      clinics.set(tenantId, boot)
    }
    return boot
  }
  const configRegistry = createMemoryClinicConfigRegistry((tenantId) => {
    const boot = getBoot(tenantId)
    return { db: boot.db, clock: boot.clock }
  })
  const schedulingRegistry = createMemorySchedulingRegistry((tenantId) => {
    const boot = getBoot(tenantId)
    return { db: boot.db, clock: boot.clock }
  })
  const services: AuthServices = {
    sessions: createSyntheticSessionAuthenticator({
      authorizedParties: ['http://localhost:5173'],
    }),
    authority: createSyntheticAuthorityReader(),
    adminDb: asyncFromSync(admin.db),
  }
  const app = createApp({
    authServicesFactory: () => services,
    syncAdminDbFactory: () => admin.db,
    clinicConfigGatewayFactory: (_env, tenantId) => configRegistry(tenantId),
    schedulingGatewayFactory: (_env, tenantId) => schedulingRegistry(tenantId),
  })
  return {
    app,
    getBoot,
    close: () => {
      for (const c of clinics.values()) c.close()
      admin.close()
    },
    auth: (userId: string, init: RequestInit = {}) => {
      const headers = new Headers(init.headers)
      headers.set('Authorization', synthAuthHeader(userId))
      return { ...init, headers }
    },
  }
}

async function seedReadyClinic(
  app: ReturnType<typeof createApp>,
  auth: ReturnType<typeof testSchedulingApp>['auth'],
) {
  const pro = await app.request(
    'http://localhost/api/tenants/clinic-demo-a/config/resources',
    auth('user_synth_owner_a', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'professional', name: 'Dra. Paula Reis' }),
    }),
  )
  const proBody = (await pro.json()) as { id: string }
  const room = await app.request(
    'http://localhost/api/tenants/clinic-demo-a/config/resources',
    auth('user_synth_owner_a', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        kind: 'room',
        name: 'Sala 2',
        category: 'Sala com laser',
      }),
    }),
  )
  const roomBody = (await room.json()) as { id: string }
  const svc = await app.request(
    'http://localhost/api/tenants/clinic-demo-a/config/services',
    auth('user_synth_owner_a', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Depilação a laser',
        durationMinutes: 60,
        bufferMinutes: 15,
        professionalIds: [proBody.id],
        roomRequirement: { mode: 'category', category: 'Sala com laser' },
      }),
    }),
  )
  const svcBody = (await svc.json()) as { id: string }
  await app.request(
    `http://localhost/api/tenants/clinic-demo-a/config/resources/${proBody.id}/weekly`,
    auth('user_synth_owner_a', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        windows: [{ dayOfWeek: 1, startMinute: 9 * 60, endMinute: 12 * 60 }],
      }),
    }),
  )
  await app.request(
    `http://localhost/api/tenants/clinic-demo-a/config/resources/${roomBody.id}/weekly`,
    auth('user_synth_owner_a', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        windows: [{ dayOfWeek: 1, startMinute: 9 * 60, endMinute: 18 * 60 }],
      }),
    }),
  )
  return { proId: proBody.id, roomId: roomBody.id, serviceId: svcBody.id }
}

describe('HTTP — disponibilidade (#35)', () => {
  it('attendant e owner consultam; check não cria reserva; cross-tenant 404', async () => {
    const { app, close, auth } = testSchedulingApp()
    try {
      const seeded = await seedReadyClinic(app, auth)

      const att = await app.request(
        `http://localhost/api/tenants/clinic-demo-a/availability?serviceId=${encodeURIComponent(seeded.serviceId)}&date=${MONDAY}`,
        auth('user_synth_attendant_a'),
      )
      expect(att.status).toBe(200)
      const body = (await att.json()) as {
        createdReservation: boolean
        slots: Array<{ startsAt: number; roomResourceName: string | null }>
        schedulingAllowed: boolean
      }
      expect(body.createdReservation).toBe(false)
      expect(body.schedulingAllowed).toBe(true)
      expect(body.slots.length).toBeGreaterThan(0)
      expect(body.slots[0]?.startsAt).toBe(zonedCivilToUtc(TZ, 2024, 1, 8, 9, 0))

      const start = body.slots[0]!.startsAt
      const check = await app.request(
        'http://localhost/api/tenants/clinic-demo-a/availability/check',
        auth('user_synth_attendant_a', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            serviceId: seeded.serviceId,
            professionalId: seeded.proId,
            roomResourceId: seeded.roomId,
            startsAt: start,
          }),
        }),
      )
      expect(check.status).toBe(200)
      const checkBody = (await check.json()) as {
        available: boolean
        createdReservation: boolean
        reasons: string[]
      }
      expect(checkBody.available).toBe(true)
      expect(checkBody.createdReservation).toBe(false)

      const foreign = await app.request(
        `http://localhost/api/tenants/clinic-demo-a/availability?serviceId=${encodeURIComponent('svc_from_b')}&date=${MONDAY}`,
        auth('user_synth_owner_a'),
      )
      expect(foreign.status).toBe(404)

      const otherClinic = await app.request(
        `http://localhost/api/tenants/clinic-demo-b/availability?serviceId=${encodeURIComponent(seeded.serviceId)}&date=${MONDAY}`,
        auth('user_synth_owner_a'),
      )
      // owner A não é membro de B
      expect([403, 404]).toContain(otherClinic.status)
    } finally {
      close()
    }
  })
})

describe('HTTP — agendamento atómico (#36)', () => {
  it('confirma, lista agenda, cancela com motivo; conflito 409; sem motivo 400', async () => {
    const { app, close, auth } = testSchedulingApp()
    try {
      const seeded = await seedReadyClinic(app, auth)
      const startsAt = zonedCivilToUtc(TZ, 2024, 1, 8, 9, 0)

      const created = await app.request(
        'http://localhost/api/tenants/clinic-demo-a/appointments',
        auth('user_synth_attendant_a', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            clientRequestId: 'http-confirm-1',
            serviceId: seeded.serviceId,
            professionalId: seeded.proId,
            roomResourceId: seeded.roomId,
            startsAt,
            contactLabel: 'Ana',
          }),
        }),
      )
      expect(created.status).toBe(201)
      const apt = (await created.json()) as {
        id: string
        createdReservation: boolean
        version: number
      }
      expect(apt.createdReservation).toBe(true)

      const replay = await app.request(
        'http://localhost/api/tenants/clinic-demo-a/appointments',
        auth('user_synth_attendant_a', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            clientRequestId: 'http-confirm-1',
            serviceId: seeded.serviceId,
            professionalId: seeded.proId,
            roomResourceId: seeded.roomId,
            startsAt,
          }),
        }),
      )
      expect(replay.status).toBe(200)
      const replayBody = (await replay.json()) as { idempotentReplay: boolean; id: string }
      expect(replayBody.idempotentReplay).toBe(true)
      expect(replayBody.id).toBe(apt.id)

      const conflict = await app.request(
        'http://localhost/api/tenants/clinic-demo-a/appointments',
        auth('user_synth_owner_a', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            clientRequestId: 'http-confirm-2',
            serviceId: seeded.serviceId,
            professionalId: seeded.proId,
            roomResourceId: seeded.roomId,
            startsAt,
          }),
        }),
      )
      expect(conflict.status).toBe(409)

      const agenda = await app.request(
        `http://localhost/api/tenants/clinic-demo-a/agenda?date=${MONDAY}&view=day`,
        auth('user_synth_attendant_a'),
      )
      expect(agenda.status).toBe(200)
      const agendaBody = (await agenda.json()) as {
        appointments: Array<{ id: string }>
      }
      expect(agendaBody.appointments.some((a) => a.id === apt.id)).toBe(true)

      const noReason = await app.request(
        `http://localhost/api/tenants/clinic-demo-a/appointments/${apt.id}/cancel`,
        auth('user_synth_attendant_a', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ clientRequestId: 'http-cancel-bad' }),
        }),
      )
      expect(noReason.status).toBe(400)

      const cancelled = await app.request(
        `http://localhost/api/tenants/clinic-demo-a/appointments/${apt.id}/cancel`,
        auth('user_synth_attendant_a', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            clientRequestId: 'http-cancel-1',
            reason: 'clinica_cancelou',
            expectedVersion: apt.version,
          }),
        }),
      )
      expect(cancelled.status).toBe(200)
      const cancelledBody = (await cancelled.json()) as { status: string }
      expect(cancelledBody.status).toBe('cancelled')
    } finally {
      close()
    }
  })
})

describe('HTTP — reserva por bloco', () => {
  it('preview, reservar, alertas, definir hora; attendant pode; cross-tenant negado', async () => {
    const { app, close, auth, getBoot } = testSchedulingApp()
    try {
      const seeded = await seedReadyClinic(app, auth)
      const boot = getBoot('clinic-demo-a')
      const conv = ingestContactMessage(
        boot.db,
        workerCaller('clinic-demo-a'),
        { providerEventKey: 'wa:hold:http', waId: '5511988880000', displayName: 'Marina', body: 'Oi' },
        boot.clock,
      ).conversation!
      const ws = zonedCivilToUtc(TZ, 2024, 1, 8, 9, 0)
      const we = zonedCivilToUtc(TZ, 2024, 1, 8, 12, 0)
      const json = (body: unknown) => ({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const base = 'http://localhost/api/tenants/clinic-demo-a'

      const preview = await app.request(
        `${base}/holds/preview`,
        auth('user_synth_attendant_a', json({ professionalId: seeded.proId, windowStartsAt: ws, windowEndsAt: we, durationMinutes: 60 })),
      )
      expect(preview.status).toBe(200)
      expect(await preview.json()).toMatchObject({ freeMinutes: 180, fits: true })

      const created = await app.request(
        `${base}/holds`,
        auth('user_synth_attendant_a', json({
          clientRequestId: 'hold-http-1',
          conversationId: conv.id,
          serviceId: seeded.serviceId,
          professionalId: seeded.proId,
          windowStartsAt: ws,
          windowEndsAt: we,
          durationMinutes: 60,
        })),
      )
      expect(created.status).toBe(201)
      const { hold } = (await created.json()) as { hold: { id: string; status: string } }
      expect(hold.status).toBe('active')

      const noFit = await app.request(
        `${base}/holds/preview`,
        auth('user_synth_attendant_a', json({ professionalId: seeded.proId, windowStartsAt: ws, windowEndsAt: we, durationMinutes: 180 })),
      )
      expect(await noFit.json()).toMatchObject({ fits: false })

      const list = await app.request(`${base}/holds?conversationId=${conv.id}`, auth('user_synth_owner_a'))
      expect(((await list.json()) as { holds: unknown[] }).holds).toHaveLength(1)

      const agenda = await app.request(`${base}/agenda?date=${MONDAY}&view=day`, auth('user_synth_owner_a'))
      expect(((await agenda.json()) as { holds: unknown[] }).holds).toHaveLength(1)

      ;(boot.clock as ReturnType<typeof createControllableClock>).set(ws - 3600_000)
      const alerts = await app.request(`${base}/holds/alerts`, auth('user_synth_attendant_a'))
      const alertsBody = (await alerts.json()) as { alerts: Array<{ kind: string }> }
      expect(alertsBody.alerts.map((a) => a.kind)).toEqual(['starts_soon'])

      const cross = await app.request(
        'http://localhost/api/tenants/clinic-demo-b/holds/alerts',
        auth('user_synth_attendant_a'),
      )
      expect([403, 404]).toContain(cross.status)

      const resolved = await app.request(
        `${base}/holds/${hold.id}/resolve`,
        auth('user_synth_attendant_a', json({
          clientRequestId: 'resolve-http-1',
          startsAt: zonedCivilToUtc(TZ, 2024, 1, 8, 10, 0),
          roomResourceId: seeded.roomId,
        })),
      )
      expect(resolved.status).toBe(200)
      const rb = (await resolved.json()) as { hold: { status: string }; appointment: { status: string } }
      expect(rb.hold.status).toBe('resolved')
      expect(rb.appointment.status).toBe('confirmed')

      const again = await app.request(
        `${base}/holds/${hold.id}/cancel`,
        auth('user_synth_attendant_a', json({})),
      )
      expect(again.status).toBe(409)
    } finally {
      close()
    }
  })
})
