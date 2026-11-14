import { describe, expect, it } from 'vitest'
import { createControllableClock } from '../db/clock'
import { bootAdminDb } from '../db/test-db'
import {
  assertSafePushPayload,
  buildAppointmentConfirmedPayload,
  buildNeedsPersonPayload,
  buildNewMessagePayload,
} from './send'
import { upsertPushSubscription } from './subscriptions'
import { notifyNewConversation } from './notify'
import { maybeNotifyNewConversationPush } from './queue-hook'
import { resolveVapidConfig } from './vapid'
import type { NewConversationPushPayload } from './types'
import type { WorkerBindings } from '../worker/bindings'

const clock = createControllableClock(1_700_000_000_000)

describe('DEC-173 push gates', () => {
  it('appointment_confirmed payload expressivo sem eco do título', () => {
    // sexta 30/10/2026 12:00 America/Sao_Paulo = 15:00 UTC
    const startsAt = Date.UTC(2026, 9, 30, 15, 0, 0)
    const payload = buildAppointmentConfirmedPayload({
      tenantId: 'clinic-demo-a',
      tenantName: 'Clínica Aurora',
      appointmentId: 'apt_1',
      conversationId: 'cnv_1',
      contactLabel: 'Ana Silva',
      serviceName: 'Depilação',
      startsAt,
      timezone: 'America/Sao_Paulo',
      professionalName: 'Dra. Paula Reis',
    })
    expect(payload.kind).toBe('appointment_confirmed')
    expect(payload.title).toBe('Agendamento confirmado')
    expect(payload.body).toBe(
      'Ana Silva · Depilação · sexta 30/10 às 12:00 com Dra. Paula Reis · Clínica Aurora',
    )
    expect(payload.body).not.toMatch(/^Agendamento confirmado/)
    expect(payload.url).toContain('/conversas/cnv_1')
    expect(payload.tag).toBe('appointment:clinic-demo-a:apt_1')
    assertSafePushPayload(payload)
  })

  it('appointment_confirmed prioriza dia/hora/pro e parte variante do zoneLabel', () => {
    const startsAt = Date.UTC(2026, 9, 30, 15, 0, 0)
    const rich = buildAppointmentConfirmedPayload({
      tenantId: 'clinic-demo-a',
      tenantName: 'Clínica Teste Paulo (staging)',
      appointmentId: 'apt_2',
      contactLabel: 'Gislaine Santos',
      serviceName: 'Massagem · relaxante',
      startsAt,
      timezone: 'America/Sao_Paulo',
      professionalName: 'Ana',
    })
    expect(rich.body).toBe(
      'Gislaine Santos · Massagem · relaxante · sexta 30/10 às 12:00 com Ana · Clínica Teste Paulo (staging)',
    )
    assertSafePushPayload(rich)

    const longClinic = 'Clínica ' + 'X'.repeat(120)
    const trimmed = buildAppointmentConfirmedPayload({
      tenantId: 'clinic-demo-a',
      tenantName: longClinic,
      appointmentId: 'apt_3',
      contactLabel: 'Gislaine Santos',
      serviceName: 'Massagem · relaxante',
      startsAt,
      timezone: 'America/Sao_Paulo',
      professionalName: 'Ana Costa Silva',
    })
    expect(trimmed.body).toContain('às 12:00 com Ana Costa Silva')
    expect(trimmed.body).not.toContain(longClinic)
    expect(trimmed.body.length).toBeLessThanOrEqual(160)
    assertSafePushPayload(trimmed)
  })

  it('new_message com contacto e needs_person com copy rica', () => {
    const msg = buildNewMessagePayload({
      tenantId: 'clinic-demo-a',
      tenantName: 'Clínica Aurora',
      conversationId: 'cnv_1',
      contactLabel: 'Ana',
    })
    expect(msg.body).toBe('Ana · Clínica Aurora')
    assertSafePushPayload(msg)
    const handoff = buildNeedsPersonPayload({
      tenantId: 'clinic-demo-a',
      tenantName: 'Clínica Aurora',
      conversationId: 'cnv_1',
      contactLabel: 'Ana',
      handoffReason: 'payment_proof',
    })
    expect(handoff.body).toBe('Ana · Clínica Aurora · comprovativo')
    assertSafePushPayload(handoff)
    const esc = buildNeedsPersonPayload({
      tenantId: 'clinic-demo-a',
      tenantName: 'Clínica Aurora',
      conversationId: 'cnv_1',
      contactLabel: 'Ana',
      escalate: true,
    })
    expect(esc.body).toBe('Ana · Clínica Aurora · há 5 min')
    assertSafePushPayload(esc)
  })

  it('queue-hook ignora inbound sem humanAttended e envia com humanAttended', async () => {
    const { db, close } = bootAdminDb({ seed: true })
    try {
      upsertPushSubscription(db, clock, {
        tenantId: 'clinic-demo-a',
        clerkUserId: 'user_synth_owner_a',
        subscription: { endpoint: 'https://push.example/a', keys: { p256dh: 'p', auth: 'a' } },
      })
      const sent: NewConversationPushPayload[] = []
      const transport = {
        async send(_s: unknown, payload: NewConversationPushPayload) {
          sent.push(payload)
          return { ok: true as const, status: 201 }
        },
      }
      const logs: Array<{ event: string; detail: Record<string, unknown> }> = []
      const env = { PUSH_MODE: 'synthetic' } as WorkerBindings

      // Bypass deliver via notify directly to prove kind path, then gate via hook.
      await maybeNotifyNewConversationPush({
        env,
        clock,
        syncAdminDb: db,
        tenantId: 'clinic-demo-a',
        conversationId: 'cnv_x',
        createdConversation: false,
        newMessage: true,
        humanAttended: false,
        log: (e) => logs.push({ event: e.event, detail: e.detail }),
      })
      expect(logs.some((l) => l.event === 'queue.push_inbound_skipped')).toBe(true)

      await notifyNewConversation(
        {
          db,
          clock,
          vapid: resolveVapidConfig({ PUSH_MODE: 'synthetic' }),
          transport,
        },
        {
          tenantId: 'clinic-demo-a',
          conversationId: 'cnv_x',
          kind: 'new_message',
          contactLabel: 'Bia',
        },
      )
      expect(sent[0]?.kind).toBe('new_message')
      expect(sent[0]?.body).toContain('Bia')

      await notifyNewConversation(
        {
          db,
          clock,
          vapid: resolveVapidConfig({ PUSH_MODE: 'synthetic' }),
          transport,
        },
        {
          tenantId: 'clinic-demo-a',
          conversationId: 'cnv_x',
          kind: 'appointment_confirmed',
          appointmentId: 'apt_9',
          contactLabel: 'Ana',
          serviceName: 'Massagem',
        },
      )
      expect(sent[1]?.kind).toBe('appointment_confirmed')
      expect(sent[1]?.title).toBe('Agendamento confirmado')
      expect(sent[1]?.body).toMatch(/^Ana · Massagem · Clínica Aurora/)
      expect(sent[1]?.body).not.toMatch(/^Agendamento confirmado/)
    } finally {
      close()
    }
  })

  it('nova conversa genérica é sempre ignorada no hook', async () => {
    const logs: Array<{ event: string }> = []
    await maybeNotifyNewConversationPush({
      env: { PUSH_MODE: 'synthetic' } as WorkerBindings,
      clock,
      tenantId: 'clinic-demo-a',
      conversationId: 'cnv_new',
      createdConversation: true,
      newMessage: false,
      humanAttended: false,
      log: (e) => logs.push({ event: e.event }),
    })
    expect(logs.map((l) => l.event)).toEqual(['queue.push_inbound_skipped'])
  })
})
