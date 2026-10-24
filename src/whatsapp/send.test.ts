/**
 * Envio manual, janela 24 h, modelos e reconciliação de status (#33).
 */
import { describe, expect, it } from 'vitest'
import { bootAdminDb } from '../db/test-db'
import { bootClinicDb } from '../clinic/test-db'
import { createControllableClock } from '../db/clock'
import {
  clinicInbox,
  ingestContactMessage,
  queueCaller,
  workerCaller,
} from '../clinic'
import { syncWhatsappChannel } from '../clinic/whatsapp/channel'
import {
  applyOutboundSendResultOp,
  reconcileOutboundStatusOp,
  sendOutboundMessageOp,
} from '../clinic/inbox/operations'
import { canAdvanceDelivery } from '../clinic/inbox/outbound'
import { seedSyntheticWhatsappTemplates } from '../clinic/inbox/templates'
import { WHATSAPP_MESSAGING_WINDOW_MS } from '../clinic/constants'
import { createSyntheticMetaAdapter, SYNTHETIC_CODES } from './meta'
import { handleInboundQueueBatch } from './queue-consumer'
import type { ClinicOutboxQueueMessage } from './queue-types'
import { createWhatsappService } from './service'
import { createMemoryWhatsappChannelSync } from './routes'
import { getCredentialCipher, resolveTenantByPhoneNumberId } from './bindings'

const T_A = 'clinic-demo-a'
const ATT = 'user_synth_attendant_a'
const OWNER = 'user_synth_owner_a'

function connectChannel(
  db: ReturnType<typeof bootClinicDb>['db'],
  clock: ReturnType<typeof bootClinicDb>['clock'],
) {
  syncWhatsappChannel(
    db,
    T_A,
    {
      status: 'connected',
      bindingId: 'bind_send',
      phoneNumberId: 'pn_send_1',
      wabaId: 'waba_send',
      displayPhone: '+15551234567',
      action: 'channel_connected',
    },
    clock,
  )
  seedSyntheticWhatsappTemplates(db, T_A, clock)
}

describe('Envio WhatsApp / janela / status (#33)', () => {
  it('duplo clientRequestId não cria nova intenção', () => {
    const { db, clock, close } = bootClinicDb()
    try {
      const caller = workerCaller(T_A, ATT)
      connectChannel(db, clock)
      const ing = ingestContactMessage(
        db,
        caller,
        { providerEventKey: 'wa:s:1', waId: '5511999000001', body: 'oi' },
        clock,
      )
      const a = sendOutboundMessageOp(
        db,
        caller,
        {
          conversationId: ing.conversation!.id,
          body: 'olá',
          clientRequestId: 'idem-1',
          authorClerkUserId: ATT,
          authorDisplayName: 'Ana',
        },
        clock,
      )
      const b = sendOutboundMessageOp(
        db,
        caller,
        {
          conversationId: ing.conversation!.id,
          body: 'olá',
          clientRequestId: 'idem-1',
          authorClerkUserId: ATT,
          authorDisplayName: 'Ana',
        },
        clock,
      )
      expect(a.value.duplicate).toBe(false)
      expect(b.value.duplicate).toBe(true)
      expect(b.value.message.id).toBe(a.value.message.id)
      expect(b.outbox).toHaveLength(0)
    } finally {
      close()
    }
  })

  it('fora da janela 24h bloqueia texto livre; bypass recusado', () => {
    const base = Date.now()
    const clock = createControllableClock(base)
    const { db, close } = bootClinicDb({ clock })
    try {
      const caller = workerCaller(T_A, ATT)
      connectChannel(db, clock)
      const ing = ingestContactMessage(
        db,
        caller,
        {
          providerEventKey: 'wa:old:1',
          waId: '5511999000002',
          body: 'mensagem antiga',
          occurredAtMs: base,
        },
        clock,
      )
      clock.advance(WHATSAPP_MESSAGING_WINDOW_MS + 1)
      expect(() =>
        sendOutboundMessageOp(
          db,
          caller,
          {
            conversationId: ing.conversation!.id,
            body: 'tentativa de bypass',
            clientRequestId: 'bypass-1',
            authorClerkUserId: ATT,
            authorDisplayName: 'Ana',
          },
          clock,
        ),
      ).toThrow(/janela de 24/)
    } finally {
      close()
    }
  })

  it('template não aprovado / param inválido recusado; aprovado com params ok', () => {
    const base = Date.now()
    const clock = createControllableClock(base)
    const { db, close } = bootClinicDb({ clock })
    try {
      const caller = workerCaller(T_A, ATT)
      connectChannel(db, clock)
      const ing = ingestContactMessage(
        db,
        caller,
        {
          providerEventKey: 'wa:tpl:1',
          waId: '5511999000003',
          body: 'x',
          occurredAtMs: base,
        },
        clock,
      )
      clock.advance(WHATSAPP_MESSAGING_WINDOW_MS + 60_000)

      expect(() =>
        sendOutboundMessageOp(
          db,
          caller,
          {
            conversationId: ing.conversation!.id,
            template: {
              name: 'modelo_inexistente',
              language: 'pt_BR',
              params: {},
            },
            clientRequestId: 'tpl-bad-1',
            authorClerkUserId: ATT,
            authorDisplayName: 'Ana',
          },
          clock,
        ),
      ).toThrow(/não encontrado/)

      expect(() =>
        sendOutboundMessageOp(
          db,
          caller,
          {
            conversationId: ing.conversation!.id,
            template: {
              name: 'tredane_retomada_contato',
              language: 'pt_BR',
              params: { nome_contato: 'Maria' },
            },
            clientRequestId: 'tpl-bad-2',
            authorClerkUserId: ATT,
            authorDisplayName: 'Ana',
          },
          clock,
        ),
      ).toThrow(/Parâmetro/)

      const ok = sendOutboundMessageOp(
        db,
        caller,
        {
          conversationId: ing.conversation!.id,
          template: {
            name: 'tredane_retomada_contato',
            language: 'pt_BR',
            params: { nome_contato: 'Maria', nome_clinica: 'Clínica Synth' },
          },
          clientRequestId: 'tpl-ok-1',
          authorClerkUserId: ATT,
          authorDisplayName: 'Ana',
        },
        clock,
      )
      expect(ok.value.outbound.kind).toBe('template')
      expect(ok.value.message.body).toContain('Maria')
    } finally {
      close()
    }
  })

  it('timeout → unknown; status fora de ordem não regride; falha permite nova tentativa humana', () => {
    const { db, clock, close } = bootClinicDb()
    try {
      const caller = workerCaller(T_A, ATT)
      connectChannel(db, clock)
      const ing = ingestContactMessage(
        db,
        caller,
        { providerEventKey: 'wa:st:1', waId: '5511999000004', body: 'oi' },
        clock,
      )

      const sent = sendOutboundMessageOp(
        db,
        caller,
        {
          conversationId: ing.conversation!.id,
          body: 'msg timeout',
          clientRequestId: 'client:timeout-case',
          authorClerkUserId: ATT,
          authorDisplayName: 'Ana',
        },
        clock,
      )
      const sendOb = sent.outbox.find((o) => o.type === 'whatsapp.send')!

      applyOutboundSendResultOp(
        db,
        queueCaller(T_A),
        {
          outboundId: sent.value.outbound.id,
          outboxEventId: sendOb.id,
          idempotencyKey: sendOb.idempotencyKey,
          outcome: 'uncertain',
          errorCode: 'meta_timeout',
        },
        clock,
      )
      expect(
        clinicInbox.findOutboundByClientRequestId(db, T_A, 'client:timeout-case')!
          .deliveryState,
      ).toBe('unknown')

      applyOutboundSendResultOp(
        db,
        queueCaller(T_A),
        {
          outboundId: sent.value.outbound.id,
          outboxEventId: sendOb.id,
          idempotencyKey: sendOb.idempotencyKey,
          outcome: 'succeeded',
          providerMessageId: 'wamid.reconcile_1',
        },
        clock,
      )
      const accepted = clinicInbox.findOutboundByClientRequestId(
        db,
        T_A,
        'client:timeout-case',
      )!
      expect(accepted.deliveryState).toBe('accepted')
      expect(accepted.providerMessageId).toBe('wamid.reconcile_1')

      reconcileOutboundStatusOp(
        db,
        queueCaller(T_A),
        {
          providerEventKey: 'st:read:1',
          statusMessageId: 'wamid.reconcile_1',
          status: 'read',
        },
        clock,
      )
      expect(
        clinicInbox.findOutboundByClientRequestId(db, T_A, 'client:timeout-case')!
          .deliveryState,
      ).toBe('read')

      const late = reconcileOutboundStatusOp(
        db,
        queueCaller(T_A),
        {
          providerEventKey: 'st:del:late',
          statusMessageId: 'wamid.reconcile_1',
          status: 'delivered',
        },
        clock,
      )
      expect(late.value.advanced).toBe(false)
      expect(
        clinicInbox.findOutboundByClientRequestId(db, T_A, 'client:timeout-case')!
          .deliveryState,
      ).toBe('read')

      const failSend = sendOutboundMessageOp(
        db,
        caller,
        {
          conversationId: ing.conversation!.id,
          body: 'vai falhar client:fail-marker',
          clientRequestId: 'client:fail-marker',
          authorClerkUserId: ATT,
          authorDisplayName: 'Ana',
        },
        clock,
      )
      const failOb = failSend.outbox.find((o) => o.type === 'whatsapp.send')!
      applyOutboundSendResultOp(
        db,
        queueCaller(T_A),
        {
          outboundId: failSend.value.outbound.id,
          outboxEventId: failOb.id,
          idempotencyKey: failOb.idempotencyKey,
          outcome: 'failed',
          errorCode: 'meta_send_rejected',
        },
        clock,
      )
      expect(
        clinicInbox.findOutboundByClientRequestId(db, T_A, 'client:fail-marker')!
          .deliveryState,
      ).toBe('failed')

      const retry = sendOutboundMessageOp(
        db,
        caller,
        {
          conversationId: ing.conversation!.id,
          body: 'nova tentativa humana',
          clientRequestId: 'client:retry-human',
          authorClerkUserId: ATT,
          authorDisplayName: 'Ana',
        },
        clock,
      )
      expect(retry.value.duplicate).toBe(false)
      expect(retry.value.message.id).not.toBe(failSend.value.message.id)
    } finally {
      close()
    }
  })

  it('ordem monotónica de delivery', () => {
    expect(canAdvanceDelivery('accepted', 'delivered')).toBe(true)
    expect(canAdvanceDelivery('delivered', 'accepted')).toBe(false)
    expect(canAdvanceDelivery('read', 'delivered')).toBe(false)
    expect(canAdvanceDelivery('failed', 'accepted')).toBe(false)
    expect(canAdvanceDelivery('unknown', 'accepted')).toBe(true)
    expect(canAdvanceDelivery('pending', 'failed')).toBe(true)
    expect(canAdvanceDelivery('accepted', 'failed')).toBe(false)
  })

  it('consumer clinic_outbox chama Meta sintético e actualiza DO', async () => {
    const admin = bootAdminDb()
    const clinics = new Map<string, ReturnType<typeof bootClinicDb>>()
    const getClinic = (tenantId: string) => {
      let boot = clinics.get(tenantId)
      if (!boot) {
        boot = bootClinicDb()
        clinics.set(tenantId, boot)
      }
      return boot
    }
    const clock = createControllableClock()
    const service = createWhatsappService({
      db: admin.db,
      clock,
      metaEnv: { META_MODE: 'synthetic' },
      channelSync: createMemoryWhatsappChannelSync((tenantId) => {
        const c = getClinic(tenantId)
        return { db: c.db, clock: c.clock }
      }),
    })
    const logs: Array<{ event: string; detail: Record<string, unknown> }> = []

    try {
      const session = service.startSignupSession({
        tenantId: T_A,
        actorClerkUserId: OWNER,
        purpose: 'connect',
      })
      await service.completeSignup({
        tenantId: T_A,
        actorClerkUserId: OWNER,
        payload: {
          state: session.state,
          code: SYNTHETIC_CODES.valid,
          phoneNumberId: 'pn_q_send',
          wabaId: 'waba_q',
          displayPhone: '+15550009999',
        },
      })
      expect(getCredentialCipher(
        admin.db,
        resolveTenantByPhoneNumberId(admin.db, 'pn_q_send')!.bindingId,
      )).toBeTruthy()

      const clinic = getClinic(T_A)
      const caller = workerCaller(T_A, ATT)
      const ing = ingestContactMessage(
        clinic.db,
        caller,
        { providerEventKey: 'wa:q:1', waId: '5511999000005', body: 'oi' },
        clinic.clock,
      )
      const sent = sendOutboundMessageOp(
        clinic.db,
        caller,
        {
          conversationId: ing.conversation!.id,
          body: 'fila ok',
          clientRequestId: 'client:queue-ok',
          authorClerkUserId: ATT,
          authorDisplayName: 'Ana',
        },
        clinic.clock,
      )
      const sendOb = sent.outbox.find((o) => o.type === 'whatsapp.send')!
      const envelope: ClinicOutboxQueueMessage = {
        source: 'clinic_outbox',
        tenantId: T_A,
        eventId: sendOb.id,
        type: 'whatsapp.send',
        idempotencyKey: sendOb.idempotencyKey,
        payload: JSON.parse(sendOb.payloadJson) as Record<string, unknown>,
      }

      const ackCalls: string[] = []
      await handleInboundQueueBatch(
        {
          messages: [
            {
              id: 'm1',
              timestamp: new Date(),
              attempts: 1,
              body: envelope,
              ack: () => {
                ackCalls.push('ack')
              },
              retry: () => {
                ackCalls.push('retry')
              },
            },
          ],
          queue: 'test',
          retryAll() {},
          ackAll() {},
        } as unknown as MessageBatch<ClinicOutboxQueueMessage>,
        {
          env: {
            DB: null as unknown as D1Database,
            CLINIC: null as unknown as import('../worker/bindings').WorkerBindings['CLINIC'],
            ATTACHMENTS: null as unknown as R2Bucket,
            INBOUND_EVENTS: null as unknown as Queue,
            META_MODE: 'synthetic',
          },
          syncAdminDb: admin.db,
          metaAdapter: createSyntheticMetaAdapter(),
          clinicStub: () => ({
            ingestMessage: async () => ({ duplicate: false }),
            applyWhatsappInterrupt: async () => ({ status: 'interrupted' }),
            recordInboundStatus: async () => ({
              duplicate: false,
              inboundId: 'x',
              advanced: false,
            }),
            applyOutboundSendResult: async (_c, input) => {
              applyOutboundSendResultOp(
                clinic.db,
                queueCaller(T_A),
                input,
                clinic.clock,
              )
              return { deliveryState: 'accepted', advanced: true }
            },
          }),
          log: (e) => logs.push({ event: e.event, detail: e.detail }),
        },
      )

      expect(ackCalls).toEqual(['ack'])
      const ob = clinicInbox.findOutboundByClientRequestId(
        clinic.db,
        T_A,
        'client:queue-ok',
      )!
      expect(ob.deliveryState).toBe('accepted')
      expect(ob.providerMessageId).toMatch(/^wamid\.synth_/)
      const logLine = JSON.stringify(logs)
      expect(logLine).not.toMatch(/5511999000005/)
      expect(logLine).not.toMatch(/fila ok/)
      expect(logLine).not.toMatch(/synth_token/)
    } finally {
      for (const c of clinics.values()) c.close()
      admin.close()
    }
  })

  it('envio não altera appointments (REQ-033)', () => {
    const { db, clock, close } = bootClinicDb()
    try {
      const before = db.all<{ name: string }>(
        `SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'appointment%'`,
      )
      const caller = workerCaller(T_A, ATT)
      connectChannel(db, clock)
      const ing = ingestContactMessage(
        db,
        caller,
        { providerEventKey: 'wa:appt:1', waId: '5511999000006', body: 'oi' },
        clock,
      )
      sendOutboundMessageOp(
        db,
        caller,
        {
          conversationId: ing.conversation!.id,
          body: 'só mensagem',
          clientRequestId: 'client:no-appt',
          authorClerkUserId: ATT,
          authorDisplayName: 'Ana',
        },
        clock,
      )
      const after = db.all<{ name: string }>(
        `SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'appointment%'`,
      )
      expect(after).toEqual(before)
    } finally {
      close()
    }
  })
})
