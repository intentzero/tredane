/**
 * DEC-148 / T1 — booking_session.opened / .ended: idempotência e sem texto da cliente.
 */
import { describe, expect, it } from 'vitest'
import { createControllableClock } from '../../db/clock'
import { upsertContact } from '../contacts'
import { createConversation } from '../inbox/conversations'
import { workerCaller } from '../index'
import { bootClinicDb } from '../test-db'
import {
  assertBookingSessionEndedMinimized,
  assertBookingSessionOpenedMinimized,
  BOOKING_SESSION_ABANDON_WINDOW_MS,
  deriveDropStep,
  endAbandonedSessionsPastWindow,
  endBookingSession,
  getOpenBookingSession,
  openBookingSessionIfNeeded,
  type BookingSessionEndedPayload,
  type BookingSessionOpenedPayload,
} from './booking-session'
import { clearBookingFrame, saveBookingFrame } from './schedule-session'
import { notifyHumanHandoff } from './human-handoff'
import { setClinicAiAssistEnabled } from '../config/settings'

const NOW = Date.UTC(2026, 10, 7, 15, 0)

function openedSample(
  over: Partial<BookingSessionOpenedPayload> = {},
): BookingSessionOpenedPayload {
  return {
    event: 'booking_session.opened',
    sessionId: 'bss_1',
    tenantId: 'clinic-demo-a',
    conversationId: 'cnv_1',
    occurredAt: NOW,
    openReason: 'service_named',
    serviceId: 'svc_1',
    variantSelectionMode: 'varias',
    source: 'clinic_do',
    ...over,
  }
}

function endedSample(
  over: Partial<BookingSessionEndedPayload> = {},
): BookingSessionEndedPayload {
  return {
    event: 'booking_session.ended',
    sessionId: 'bss_1',
    tenantId: 'clinic-demo-a',
    conversationId: 'cnv_1',
    occurredAt: NOW + 1000,
    outcome: 'abandon',
    dropStep: 'slot_offer',
    inboundTurns: 0,
    flowUsed: false,
    durationMs: 1000,
    source: 'clinic_do',
    ...over,
  }
}

describe('DEC-148 booking_session T1', () => {
  it('janela W de abandono Confirmada: 24 h (P4 / DEC-127)', () => {
    expect(BOOKING_SESSION_ABANDON_WINDOW_MS).toBe(24 * 60 * 60 * 1000)
  })

  it('rejeita payload opened/ended com chave de corpo de mensagem', () => {
    const dirtyOpen = { ...openedSample(), body: 'Quero depilação amanhã' } as BookingSessionOpenedPayload & {
      body: string
    }
    expect(() => assertBookingSessionOpenedMinimized(dirtyOpen)).toThrow(/texto de conversa|corpo/)
    const dirtyEnd = {
      ...endedSample(),
      mensagem: 'Deixa estar, obrigado',
    } as BookingSessionEndedPayload & { mensagem: string }
    expect(() => assertBookingSessionEndedMinimized(dirtyEnd)).toThrow(/texto de conversa|corpo/)
  })

  it('aceita payloads mínimos sem prosa', () => {
    expect(() => assertBookingSessionOpenedMinimized(openedSample())).not.toThrow()
    expect(() => assertBookingSessionEndedMinimized(endedSample())).not.toThrow()
  })

  it('deriveDropStep mapeia quadro → passo do funil', () => {
    expect(deriveDropStep(null)).toBe('hub')
    expect(
      deriveDropStep({
        phase: 'coletando',
        serviceId: null,
        line: 'feminino',
        variantIds: null,
        date: null,
        period: null,
        time: null,
        pending: { slot: 'linha', options: [], messageId: 'm' },
        lastOffer: null,
        proposal: null,
      }),
    ).toBe('audience')
    expect(
      deriveDropStep({
        phase: 'coletando',
        serviceId: 'svc',
        line: 'feminino',
        variantIds: null,
        date: null,
        period: null,
        time: null,
        pending: null,
        lastOffer: null,
        proposal: null,
      }),
    ).toBe('service')
    expect(
      deriveDropStep({
        phase: 'ofertado',
        serviceId: 'svc',
        line: 'feminino',
        variantIds: ['z1'],
        date: null,
        period: null,
        time: null,
        pending: { slot: 'horario', options: [], messageId: 'm' },
        lastOffer: { slots: [], messageId: 'm' },
        proposal: null,
      }),
    ).toBe('slot_offer')
    expect(
      deriveDropStep({
        phase: 'proposto',
        serviceId: 'svc',
        line: 'feminino',
        variantIds: ['z1'],
        date: '2026-11-08',
        period: null,
        time: '10:00',
        pending: null,
        lastOffer: null,
        proposal: { id: 'prp', version: 1 },
      }),
    ).toBe('proposal')
  })

  it('abre e fecha sessão com outbox idempotente; sem texto da cliente', () => {
    const clock = createControllableClock(NOW)
    const boot = bootClinicDb({ clock })
    const { db } = boot
    const tenantId = 'clinic-demo-a'
    workerCaller(tenantId, 'user_synth_owner_a')
    setClinicAiAssistEnabled(db, tenantId, true, clock)
    const contact = upsertContact(
      db,
      { tenantId, waId: '5511900000148', displayName: 'Ana Ficticia' },
      clock,
    )
    const cnv = createConversation(db, { tenantId, contactId: contact.id, status: 'open' }, clock)

    const secret = 'SEGREDO_NUNCA_NO_ANALYTICS_xyz'
    const a = openBookingSessionIfNeeded(
      db,
      tenantId,
      cnv.id,
      {
        phase: 'coletando',
        serviceId: 'svc_demo',
        line: null,
        variantIds: null,
        date: null,
        period: null,
        time: null,
        pending: null,
        lastOffer: null,
        proposal: null,
      },
      clock,
      { openReason: 'service_named' },
    )
    expect(a.session).not.toBeNull()
    expect(a.outbox?.type).toBe('booking_session.opened')
    const b = openBookingSessionIfNeeded(
      db,
      tenantId,
      cnv.id,
      {
        phase: 'coletando',
        serviceId: 'svc_demo',
        line: 'feminino',
        variantIds: null,
        date: null,
        period: null,
        time: null,
        pending: null,
        lastOffer: null,
        proposal: null,
      },
      clock,
    )
    expect(b.session?.sessionId).toBe(a.session!.sessionId)
    expect(b.outbox).toBeNull()

    const end1 = endBookingSession(
      db,
      tenantId,
      cnv.id,
      {
        outcome: 'abandon',
        frame: {
          phase: 'ofertado',
          serviceId: 'svc_demo',
          line: 'feminino',
          variantIds: ['z1'],
          date: null,
          period: null,
          time: null,
          pending: { slot: 'horario', options: [], messageId: 'm' },
          lastOffer: { slots: [], messageId: 'm' },
          proposal: null,
        },
      },
      clock,
    )
    expect(end1.outbox?.type).toBe('booking_session.ended')
    const endPayload = JSON.parse(end1.outbox!.payloadJson) as BookingSessionEndedPayload
    expect(endPayload.outcome).toBe('abandon')
    expect(endPayload.dropStep).toBe('slot_offer')
    expect(endPayload).not.toMatchObject({ body: expect.anything() })
    expect(JSON.stringify(endPayload)).not.toContain(secret)

    const end2 = endBookingSession(db, tenantId, cnv.id, { outcome: 'abandon' }, clock)
    expect(end2.outbox).toBeNull()
    expect(getOpenBookingSession(db, tenantId, cnv.id)).toBeNull()

    // Reemit opened com a mesma chave de idempotência devolve a mesma row.
    const openedRows = db.all<{ id: string; payload: string }>(
      `SELECT id, payload_json AS payload FROM outbox_events
       WHERE tenant_id = ? AND type = 'booking_session.opened'`,
      tenantId,
    )
    expect(openedRows).toHaveLength(1)
    expect(openedRows[0]!.payload).not.toContain(secret)
    assertBookingSessionOpenedMinimized(JSON.parse(openedRows[0]!.payload) as BookingSessionOpenedPayload)

    const endedRows = db.all<{ id: string; payload: string }>(
      `SELECT id, payload_json AS payload FROM outbox_events
       WHERE tenant_id = ? AND type = 'booking_session.ended'`,
      tenantId,
    )
    expect(endedRows).toHaveLength(1)
    assertBookingSessionEndedMinimized(JSON.parse(endedRows[0]!.payload) as BookingSessionEndedPayload)

    boot.close()
  })

  it('saveBookingFrame abre; clearBookingFrame (recomeçar) fecha abandon', () => {
    const clock = createControllableClock(NOW)
    const boot = bootClinicDb({ clock })
    const { db } = boot
    const tenantId = 'clinic-demo-a'
    workerCaller(tenantId, 'user_synth_owner_a')
    const contact = upsertContact(
      db,
      { tenantId, waId: '5511900000149', displayName: 'Bia Ficticia' },
      clock,
    )
    const cnv = createConversation(db, { tenantId, contactId: contact.id, status: 'open' }, clock)

    saveBookingFrame(
      db,
      tenantId,
      cnv.id,
      { serviceId: 'svc_x', phase: 'coletando', catalogVersion: '1' },
      clock,
    )
    const open = getOpenBookingSession(db, tenantId, cnv.id)
    expect(open).not.toBeNull()
    expect(open!.openReason).toBe('service_named')

    clearBookingFrame(db, tenantId, cnv.id, clock)
    expect(getOpenBookingSession(db, tenantId, cnv.id)).toBeNull()
    const ended = db.get<{ payload: string }>(
      `SELECT payload_json AS payload FROM outbox_events
       WHERE tenant_id = ? AND type = 'booking_session.ended' ORDER BY occurred_at DESC LIMIT 1`,
      tenantId,
    )
    expect(ended).toBeTruthy()
    const p = JSON.parse(ended!.payload) as BookingSessionEndedPayload
    expect(p.outcome).toBe('abandon')
    expect(p.dropStep).toBe('service')
    boot.close()
  })

  it('handoff fecha com outcome handoff', () => {
    const clock = createControllableClock(NOW)
    const boot = bootClinicDb({ clock })
    const { db } = boot
    const tenantId = 'clinic-demo-a'
    workerCaller(tenantId, 'user_synth_owner_a')
    setClinicAiAssistEnabled(db, tenantId, true, clock)
    const contact = upsertContact(
      db,
      { tenantId, waId: '5511900000150', displayName: 'Carla Ficticia' },
      clock,
    )
    const cnv = createConversation(db, { tenantId, contactId: contact.id, status: 'open' }, clock)
    saveBookingFrame(
      db,
      tenantId,
      cnv.id,
      {
        serviceId: 'svc_y',
        phase: 'ofertado',
        line: 'feminino',
        lastOffer: { slots: [{ startsAt: NOW + 3600_000, professionalId: 'pro' }], messageId: 'm1' },
        catalogVersion: '1',
      },
      clock,
    )
    expect(getOpenBookingSession(db, tenantId, cnv.id)).not.toBeNull()

    notifyHumanHandoff(
      db,
      tenantId,
      {
        conversationId: cnv.id,
        reason: 'customer_requested',
        clientRequestId: 'cr_handoff_148',
        silent: true,
      },
      clock,
    )
    expect(getOpenBookingSession(db, tenantId, cnv.id)).toBeNull()
    const ended = db.get<{ payload: string }>(
      `SELECT payload_json AS payload FROM outbox_events
       WHERE tenant_id = ? AND type = 'booking_session.ended' ORDER BY occurred_at DESC LIMIT 1`,
      tenantId,
    )
    const p = JSON.parse(ended!.payload) as BookingSessionEndedPayload
    expect(p.outcome).toBe('handoff')
    expect(p.dropStep).toBe('slot_offer')
    boot.close()
  })

  it('endAbandonedSessionsPastWindow fecha com abandon após W', () => {
    const clock = createControllableClock(NOW)
    const boot = bootClinicDb({ clock })
    const { db } = boot
    const tenantId = 'clinic-demo-a'
    workerCaller(tenantId, 'user_synth_owner_a')
    const contact = upsertContact(
      db,
      { tenantId, waId: '5511900000151', displayName: 'Dora Ficticia' },
      clock,
    )
    const cnv = createConversation(db, { tenantId, contactId: contact.id, status: 'open' }, clock)
    openBookingSessionIfNeeded(
      db,
      tenantId,
      cnv.id,
      {
        phase: 'coletando',
        serviceId: 'svc_z',
        line: null,
        variantIds: null,
        date: null,
        period: null,
        time: null,
        pending: null,
        lastOffer: null,
        proposal: null,
      },
      clock,
    )
    clock.advance(BOOKING_SESSION_ABANDON_WINDOW_MS + 1)
    const rows = endAbandonedSessionsPastWindow(db, tenantId, clock)
    expect(rows).toHaveLength(1)
    expect(getOpenBookingSession(db, tenantId, cnv.id)).toBeNull()
    boot.close()
  })

  it('remarcando não abre sessão de marcação v1', () => {
    const clock = createControllableClock(NOW)
    const boot = bootClinicDb({ clock })
    const { db } = boot
    const tenantId = 'clinic-demo-a'
    workerCaller(tenantId, 'user_synth_owner_a')
    const contact = upsertContact(
      db,
      { tenantId, waId: '5511900000152', displayName: 'Eva Ficticia' },
      clock,
    )
    const cnv = createConversation(db, { tenantId, contactId: contact.id, status: 'open' }, clock)
    saveBookingFrame(
      db,
      tenantId,
      cnv.id,
      {
        serviceId: 'svc_r',
        phase: 'remarcando',
        rescheduleAppointmentId: 'apt_1',
        catalogVersion: '1',
      },
      clock,
    )
    expect(getOpenBookingSession(db, tenantId, cnv.id)).toBeNull()
    boot.close()
  })
})
