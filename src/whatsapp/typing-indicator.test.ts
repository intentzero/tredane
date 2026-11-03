/**
 * DEC-136 — typing indicator nativo da Cloud API (read + typing_indicator).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createControllableClock } from '../db/clock'
import { bootAdminDb } from '../db/test-db'
import { bootClinicDb } from '../clinic/test-db'
import {
  enqueueTypingIndicator,
  wamidFromExternalMessageId,
  WHATSAPP_TYPING_INDICATOR_TYPE,
} from '../clinic/ai/typing-indicator'
import { upsertContact } from '../clinic/contacts'
import { createConversation } from '../clinic/inbox/conversations'
import { insertMessage } from '../clinic/inbox/messages'
import { setClinicAiAssistEnabled } from '../clinic/config/settings'
import { workerCaller } from '../clinic'
import {
  setWeeklyWindowsOp,
  upsertResourceOp,
  upsertServiceOp,
} from '../clinic/config'
import { enqueueAutoDraft, runDueAutoDrafts } from '../clinic/ai'
import { createLiveMetaAdapter, SYNTHETIC_CODES } from './meta'
import { processClinicOutboxMessage } from './outbound-send'
import { createWhatsappService } from './service'
import { createMemoryWhatsappChannelSync } from './routes'
import type { ClinicOutboxQueueMessage } from './queue-types'

const ENV = { META_MODE: 'live', META_APP_ID: 'app', META_APP_SECRET: 'secret' }
const T_A = 'clinic-demo-a'
const OWNER = 'user_synth_owner_a'
const NOW = Date.UTC(2026, 10, 5, 13, 0)

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('wamidFromExternalMessageId', () => {
  it('extrai wamid do prefixo wa:msg:', () => {
    expect(wamidFromExternalMessageId('wa:msg:wamid.ABC')).toBe('wamid.ABC')
    expect(wamidFromExternalMessageId('wamid.raw')).toBe('wamid.raw')
    expect(wamidFromExternalMessageId(null)).toBe('')
  })
})

describe('live markMessageRead + typing_indicator (DEC-136)', () => {
  it('envia payload com typing_indicator type text e o wamid inbound', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ success: true }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const meta = createLiveMetaAdapter(ENV)
    const r = await meta.markMessageRead!({
      phoneNumberId: 'pn_1',
      accessToken: 'tok',
      messageId: 'wamid.INBOUND_1',
      typingIndicator: true,
    })
    expect(r).toEqual({ ok: true })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(JSON.parse(String(init.body))).toEqual({
      messaging_product: 'whatsapp',
      status: 'read',
      message_id: 'wamid.INBOUND_1',
      typing_indicator: { type: 'text' },
    })
  })

  it('recibo sem typing não inclui typing_indicator', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ success: true }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const meta = createLiveMetaAdapter(ENV)
    await meta.markMessageRead!({
      phoneNumberId: 'pn_1',
      accessToken: 'tok',
      messageId: 'wamid.INBOUND_2',
    })
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(JSON.parse(String(init.body))).toEqual({
      messaging_product: 'whatsapp',
      status: 'read',
      message_id: 'wamid.INBOUND_2',
    })
  })
})

describe('processClinicOutboxMessage whatsapp.typing_indicator', () => {
  it('pede markMessageRead com typingIndicator e o wamid; falha ack e não propaga', async () => {
    const admin = bootAdminDb()
    const clinic = bootClinicDb()
    const clock = createControllableClock()
    const service = createWhatsappService({
      db: admin.db,
      clock,
      metaEnv: { META_MODE: 'synthetic' },
      channelSync: createMemoryWhatsappChannelSync(() => ({
        db: clinic.db,
        clock: clinic.clock,
      })),
    })
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
          phoneNumberId: 'pn_typing',
          wabaId: 'waba_typing',
          displayPhone: '+15550001111',
        },
      })

      const calls: Array<{ messageId: string; typingIndicator?: boolean }> = []
      const out = await processClinicOutboxMessage(
        {
          source: 'clinic_outbox',
          tenantId: T_A,
          eventId: 'evt_typing_1',
          type: WHATSAPP_TYPING_INDICATOR_TYPE,
          idempotencyKey: 'whatsapp.typing_indicator:wamid.TYPING_OK',
          payload: { providerMessageId: 'wamid.TYPING_OK', conversationId: 'cnv_x' },
        } satisfies ClinicOutboxQueueMessage,
        {
          env: {} as never,
          syncAdminDb: admin.db,
          metaAdapter: {
            mode: 'live',
            markMessageRead: async (input: {
              messageId: string
              typingIndicator?: boolean
            }) => {
              calls.push({
                messageId: input.messageId,
                typingIndicator: input.typingIndicator,
              })
              return { ok: true }
            },
          } as never,
        },
      )
      expect(out).toBe('ack')
      expect(calls).toEqual([{ messageId: 'wamid.TYPING_OK', typingIndicator: true }])

      // Fail-soft: Meta rejeita → ainda ack (não bloqueia resposta).
      const failed = await processClinicOutboxMessage(
        {
          source: 'clinic_outbox',
          tenantId: T_A,
          eventId: 'evt_typing_2',
          type: WHATSAPP_TYPING_INDICATOR_TYPE,
          idempotencyKey: 'whatsapp.typing_indicator:wamid.TYPING_FAIL',
          payload: { providerMessageId: 'wamid.TYPING_FAIL' },
        } satisfies ClinicOutboxQueueMessage,
        {
          env: {} as never,
          syncAdminDb: admin.db,
          metaAdapter: {
            mode: 'live',
            markMessageRead: async () => ({ ok: false, errorCode: 'meta_http_400' }),
          } as never,
        },
      )
      expect(failed).toBe('ack')

      const threw = await processClinicOutboxMessage(
        {
          source: 'clinic_outbox',
          tenantId: T_A,
          eventId: 'evt_typing_3',
          type: WHATSAPP_TYPING_INDICATOR_TYPE,
          idempotencyKey: 'whatsapp.typing_indicator:wamid.TYPING_THROW',
          payload: { providerMessageId: 'wamid.TYPING_THROW' },
        } satisfies ClinicOutboxQueueMessage,
        {
          env: {} as never,
          syncAdminDb: admin.db,
          metaAdapter: {
            mode: 'live',
            markMessageRead: async () => {
              throw new Error('network_down')
            },
          } as never,
        },
      )
      expect(threw).toBe('ack')
    } finally {
      clinic.close()
      admin.close()
    }
  })
})

describe('autodraft onTyping (DEC-136)', () => {
  it('sinaliza typing com o wamid inbound antes da resposta; falha no onTyping não aborta', async () => {
    const clock = createControllableClock(NOW)
    const boot = bootClinicDb({ clock })
    const { db } = boot
    const caller = workerCaller(T_A, OWNER)
    setClinicAiAssistEnabled(db, T_A, true, clock)
    const gi = upsertResourceOp(db, caller, { kind: 'professional', name: 'Gi' }, clock)
    upsertServiceOp(
      db,
      caller,
      {
        name: 'Massagem',
        durationMinutes: 50,
        bufferMinutes: 0,
        priceCents: 15000,
        professionalIds: [gi.id],
        roomRequirement: { mode: 'none' },
      },
      clock,
    )
    setWeeklyWindowsOp(
      db,
      caller,
      {
        resourceId: gi.id,
        windows: [1, 2, 3, 4, 5].map((d) => ({ dayOfWeek: d, startMinute: 540, endMinute: 1080 })),
      },
      clock,
    )
    const contact = upsertContact(
      db,
      { tenantId: T_A, waId: '5511900000136', displayName: 'Ana Ficticia' },
      clock,
    )
    const cnv = createConversation(db, { tenantId: T_A, contactId: contact.id, status: 'open' }, clock)
    const msg = insertMessage(
      db,
      {
        tenantId: T_A,
        conversationId: cnv.id,
        direction: 'inbound',
        body: 'quero massagem amanhã de manhã',
        externalMessageId: 'wa:msg:wamid.TYPING_AUTO',
        deliveryState: 'received',
        createdAt: clock.nowMs(),
      },
      clock,
    )
    const enqueued = enqueueTypingIndicator(
      db,
      T_A,
      { conversationId: cnv.id, messageId: msg.id },
      clock,
    )
    expect(enqueued?.type).toBe(WHATSAPP_TYPING_INDICATOR_TYPE)
    expect(JSON.parse(enqueued!.payloadJson)).toMatchObject({
      providerMessageId: 'wamid.TYPING_AUTO',
      messageId: msg.id,
    })

    enqueueAutoDraft(db, T_A, { conversationId: cnv.id, messageId: msg.id }, clock)
    clock.advance(7_000)

    const typingCalls: string[] = []
    const outcomes = await runDueAutoDrafts(
      db,
      caller,
      clock,
      {
        mode: 'synthetic',
        adapter: {
          providerId: 'test',
          mode: 'synthetic',
          async generate() {
            return {
              ok: false,
              code: 'timeout',
              message: 'timeout',
              retryable: true,
              latencyMs: 1,
              provider: 'test',
              model: 'test',
            }
          },
          lastInspection: () => null,
        },
      },
      {
        onTyping: async (ob) => {
          typingCalls.push(JSON.parse(ob.payloadJson).providerMessageId as string)
          throw new Error('flush_failed_on_purpose')
        },
      },
    )
    expect(typingCalls).toEqual(['wamid.TYPING_AUTO'])
    // Resposta (fallback DEC-107 ou catálogo) não foi abortada pelo erro do typing.
    expect(outcomes.length).toBeGreaterThanOrEqual(1)
    expect(outcomes[0]!.status).not.toBe('failed')
    boot.close()
  })
})
