import { describe, expect, it } from 'vitest'
import { bootAdminDb } from '../db/test-db'
import { bootClinicDb } from '../clinic/test-db'
import { createControllableClock } from '../db/clock'
import { createWhatsappService } from './service'
import { SYNTHETIC_CODES } from './meta'
import { createMemoryWhatsappChannelSync } from './routes'
import {
  computeHubSignature256,
  SYNTHETIC_APP_SECRET,
  SYNTHETIC_VERIFY_TOKEN,
  verifySubscriptionChallenge,
} from './webhook-verify'
import { parseWhatsappWebhookPayload } from './webhook-parse'
import { ingestWhatsappWebhook, storeFromAdminDb } from './webhook-ingest'
import { findWebhookReceiptByKey } from './webhook-receipts'
import { handleInboundQueueBatch } from './queue-consumer'
import type { WhatsappWebhookQueueMessage } from './queue-types'
import { queueCaller, findInboundByKey, clinicInbox } from '../clinic'
import { listContacts } from '../clinic/contacts'

const OWNER_A = 'user_synth_owner_a'
const OWNER_B = 'user_synth_owner_b'
const T_A = 'clinic-demo-a'
const T_B = 'clinic-demo-b'

function metaTextPayload(opts: {
  phoneNumberId: string
  messageId: string
  from: string
  body: string
  name?: string
  timestamp?: string
}) {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'waba_test',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: {
                display_phone_number: '15550001111',
                phone_number_id: opts.phoneNumberId,
              },
              contacts: [
                {
                  profile: { name: opts.name ?? 'Paciente Synth' },
                  wa_id: opts.from,
                },
              ],
              messages: [
                {
                  from: opts.from,
                  id: opts.messageId,
                  timestamp: opts.timestamp ?? '1700000000',
                  type: 'text',
                  text: { body: opts.body },
                },
              ],
            },
          },
        ],
      },
    ],
  }
}

function harness() {
  const admin = bootAdminDb()
  const clinics = new Map<string, ReturnType<typeof bootClinicDb>>()
  const getClinic = (tenantId: string) => {
    let boot = clinics.get(tenantId)
    if (!boot) {
      boot = bootClinicDb()
      clinics.set(tenantId, boot)
    }
    return { db: boot.db, clock: boot.clock }
  }
  const channelSync = createMemoryWhatsappChannelSync(getClinic)
  const clock = createControllableClock(1_700_000_000_000)
  const service = createWhatsappService({
    db: admin.db,
    clock,
    channelSync,
    metaEnv: { META_MODE: 'synthetic' },
  })
  const queue: WhatsappWebhookQueueMessage[] = []
  const logs: Array<{ event: string; detail: Record<string, unknown> }> = []

  return {
    admin,
    service,
    getClinic,
    clock,
    queue,
    logs,
    store: storeFromAdminDb(admin.db, clock),
    async connect(tenantId: string, owner: string, phoneNumberId: string) {
      const session = service.startSignupSession({
        tenantId,
        actorClerkUserId: owner,
        purpose: 'connect',
      })
      await service.completeSignup({
        tenantId,
        actorClerkUserId: owner,
        payload: {
          state: session.state,
          code: SYNTHETIC_CODES.valid,
          phoneNumberId,
          wabaId: `waba_${phoneNumberId}`,
          displayPhone: '+5511999000000',
        },
      })
    },
    close: () => {
      for (const c of clinics.values()) c.close()
      admin.close()
    },
  }
}

describe('Webhook Meta — verify e parse (#32)', () => {
  it('challenge GET aceita verify_token sintético', () => {
    const ok = verifySubscriptionChallenge(
      {
        mode: 'subscribe',
        token: SYNTHETIC_VERIFY_TOKEN,
        challenge: 'challenge-xyz',
      },
      { META_MODE: 'synthetic' },
    )
    expect(ok).toEqual({ ok: true, challenge: 'challenge-xyz' })

    const bad = verifySubscriptionChallenge(
      {
        mode: 'subscribe',
        token: 'wrong',
        challenge: 'challenge-xyz',
      },
      { META_MODE: 'synthetic' },
    )
    expect(bad.ok).toBe(false)
  })

  it('parse extrai texto, media piloto, unsupported e status sem clinicId externo', () => {
    const text = parseWhatsappWebhookPayload(
      metaTextPayload({
        phoneNumberId: 'pnid_1',
        messageId: 'wamid.TEXT1',
        from: '5511888777666',
        body: 'Olá clínica',
      }),
    )
    expect(text.items).toHaveLength(1)
    expect(text.items[0]).toMatchObject({
      kind: 'message',
      providerEventKey: 'wa:msg:wamid.TEXT1',
      phoneNumberId: 'pnid_1',
      waId: '5511888777666',
    })

    const image = parseWhatsappWebhookPayload({
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'e1',
          changes: [
            {
              field: 'messages',
              value: {
                metadata: { phone_number_id: 'pnid_1' },
                messages: [
                  {
                    from: '5511000000001',
                    id: 'wamid.IMG1',
                    timestamp: '1700000001',
                    type: 'image',
                    image: { id: 'media_1', mime_type: 'image/jpeg', caption: 'Foto' },
                  },
                ],
              },
            },
          ],
        },
      ],
    })
    expect(image.items[0]?.kind).toBe('media')
    expect(image.items[0]).toMatchObject({
      kind: 'media',
      body: 'Foto',
      media: { mediaId: 'media_1', mediaType: 'image' },
    })

    const sticker = parseWhatsappWebhookPayload({
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'e1b',
          changes: [
            {
              field: 'messages',
              value: {
                metadata: { phone_number_id: 'pnid_1' },
                messages: [
                  {
                    from: '5511000000001',
                    id: 'wamid.STK1',
                    timestamp: '1700000002',
                    type: 'sticker',
                    sticker: { id: 'stk_1' },
                  },
                ],
              },
            },
          ],
        },
      ],
    })
    expect(sticker.items[0]?.kind).toBe('unsupported')
    expect(
      sticker.items[0] && 'body' in sticker.items[0] && sticker.items[0].body,
    ).toContain('não suportado')

    const status = parseWhatsappWebhookPayload({
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'e2',
          changes: [
            {
              field: 'messages',
              value: {
                metadata: { phone_number_id: 'pnid_1' },
                statuses: [
                  {
                    id: 'wamid.OUT1',
                    status: 'delivered',
                    timestamp: '1700000002',
                    recipient_id: '5511000000001',
                  },
                ],
              },
            },
          ],
        },
      ],
    })
    expect(status.items[0]?.kind).toBe('status')
  })
})

describe('Webhook Meta — ingest, dedup, isolamento (#32)', () => {
  it('assinatura inválida não enfileira; número desconhecido não entra em clínica', async () => {
    const h = harness()
    try {
      await h.connect(T_A, OWNER_A, 'pnid_a_wh')
      const raw = JSON.stringify(
        metaTextPayload({
          phoneNumberId: 'pnid_unknown',
          messageId: 'wamid.UNK1',
          from: '5511000000099',
          body: 'segredo',
        }),
      )
      const bad = await ingestWhatsappWebhook(
        {
          store: h.store,
          clock: h.clock,
          queue: { send: async (m) => { h.queue.push(m) } },
          env: { META_MODE: 'synthetic' },
          log: (e) => h.logs.push({ event: e.event, detail: e.detail }),
        },
        { rawBody: raw, signatureHeader: 'sha256=deadbeef' },
      )
      expect(bad.ok).toBe(false)
      if (!bad.ok) expect(bad.error).toBe('invalid_signature')
      expect(h.queue).toHaveLength(0)

      const sig = await computeHubSignature256(raw, SYNTHETIC_APP_SECRET)
      const unresolved = await ingestWhatsappWebhook(
        {
          store: h.store,
          clock: h.clock,
          queue: { send: async (m) => { h.queue.push(m) } },
          env: { META_MODE: 'synthetic' },
          log: (e) => h.logs.push({ event: e.event, detail: e.detail }),
        },
        { rawBody: raw, signatureHeader: sig },
      )
      expect(unresolved.ok).toBe(true)
      if (unresolved.ok) {
        expect(unresolved.enqueued).toBe(0)
        expect(unresolved.discarded).toBeGreaterThan(0)
      }
      expect(h.queue).toHaveLength(0)
      expect(listContacts(h.getClinic(T_A).db, T_A)).toHaveLength(0)
      expect(listContacts(h.getClinic(T_B).db, T_B)).toHaveLength(0)
    } finally {
      h.close()
    }
  })

  it('reentrega / concorrência gera uma mensagem lógica; B não vê dados de A', async () => {
    const h = harness()
    try {
      await h.connect(T_A, OWNER_A, 'pnid_a_dedup')
      await h.connect(T_B, OWNER_B, 'pnid_b_dedup')

      const payload = metaTextPayload({
        phoneNumberId: 'pnid_a_dedup',
        messageId: 'wamid.DEDUP1',
        from: '5511987654321',
        body: 'Primeira mensagem',
        timestamp: '1700000100',
      })
      const raw = JSON.stringify(payload)
      const sig = await computeHubSignature256(raw, SYNTHETIC_APP_SECRET)

      const ingestOnce = () =>
        ingestWhatsappWebhook(
          {
            store: h.store,
            clock: h.clock,
            queue: { send: async (m) => { h.queue.push(m) } },
            env: { META_MODE: 'synthetic' },
            log: (e) => h.logs.push({ event: e.event, detail: e.detail }),
          },
          { rawBody: raw, signatureHeader: sig },
        )

      const [r1, r2] = await Promise.all([ingestOnce(), ingestOnce()])
      expect(r1.ok && r2.ok).toBe(true)
      // Uma enfileira; a outra é duplicata (corrida UNIQUE).
      const totalEnqueued =
        (r1.ok ? r1.enqueued : 0) + (r2.ok ? r2.enqueued : 0)
      expect(totalEnqueued).toBe(1)
      expect(h.queue).toHaveLength(1)

      const clinicA = h.getClinic(T_A)
      const clinicB = h.getClinic(T_B)
      const stub = {
        ingestMessage: async (
          caller: ReturnType<typeof queueCaller>,
          input: {
            providerEventKey: string
            waId: string
            displayName?: string
            body: string
            occurredAtMs?: number
          },
        ) => {
          const { ingestContactMessage } = await import('../clinic/operations')
          const r = ingestContactMessage(clinicA.db, caller, input, clinicA.clock)
          return {
            duplicate: r.duplicate,
            contactId: r.contact.id,
            conversationId: r.conversation?.id ?? null,
            messageId: r.message?.id ?? null,
            inboundId: r.inbound.id,
            outboxId: r.outbox?.id ?? null,
            eventSeq: null,
            drained: [] as string[],
            fanout: null,
          }
        },
        applyWhatsappInterrupt: async () => ({ status: 'interrupted' }),
        recordInboundStatus: async () => ({ duplicate: false, inboundId: 'inb_status' }),
      }

      await handleInboundQueueBatch(
        {
          queue: 'tredane-inbound-dev',
          messages: [
            {
              id: 'q1',
              timestamp: new Date(),
              body: h.queue[0]!,
              attempts: 1,
              ack: () => undefined,
              retry: () => undefined,
            },
            {
              id: 'q2',
              timestamp: new Date(),
              body: h.queue[0]!,
              attempts: 1,
              ack: () => undefined,
              retry: () => undefined,
            },
          ],
        } as unknown as MessageBatch<WhatsappWebhookQueueMessage>,
        {
          env: {} as never,
          clock: h.clock,
          syncAdminDb: h.admin.db,
          clinicStub: () => stub as never,
          log: (e) => h.logs.push({ event: e.event, detail: e.detail }),
        },
      )

      const listed = clinicInbox.listConversationsOp(
        clinicA.db,
        queueCaller(T_A),
        { filter: 'all', limit: 20 },
        clinicA.clock,
      )
      expect(listed.items).toHaveLength(1)
      const detail = clinicInbox.getConversationDetailOp(
        clinicA.db,
        queueCaller(T_A),
        { conversationId: listed.items[0]!.id },
        clinicA.clock,
      )
      expect(detail.messages.filter((m) => m.direction === 'inbound')).toHaveLength(1)

      const inbound = findInboundByKey(clinicA.db, T_A, 'wa:msg:wamid.DEDUP1')
      expect(inbound).toBeTruthy()

      expect(listContacts(clinicB.db, T_B)).toHaveLength(0)
      expect(
        clinicInbox.listConversationsOp(
          clinicB.db,
          queueCaller(T_B),
          { filter: 'all', limit: 20 },
          clinicB.clock,
        ).items,
      ).toHaveLength(0)

      const receipt = findWebhookReceiptByKey(h.admin.db, 'wa:msg:wamid.DEDUP1')
      expect(receipt?.tenantId).toBe(T_A)
      expect(receipt?.processingState).toBe('processed')

      // Logs sem corpo nem waId do contacto
      const dumped = JSON.stringify(h.logs)
      expect(dumped).not.toContain('Primeira mensagem')
      expect(dumped).not.toContain('5511987654321')
      expect(dumped).not.toContain('synth_token_')
    } finally {
      h.close()
    }
  })

  it('status não cria contacto; unsupported (sticker) regista mensagem explícita; poison marca failed', async () => {
    const h = harness()
    try {
      await h.connect(T_A, OWNER_A, 'pnid_a_status')
      const clinicA = h.getClinic(T_A)

      const statusRaw = JSON.stringify({
        object: 'whatsapp_business_account',
        entry: [
          {
            id: 'e',
            changes: [
              {
                field: 'messages',
                value: {
                  metadata: { phone_number_id: 'pnid_a_status' },
                  statuses: [
                    {
                      id: 'wamid.OUT_STATUS',
                      status: 'read',
                      timestamp: '1700000200',
                      recipient_id: '5511000000002',
                    },
                  ],
                },
              },
            ],
          },
        ],
      })
      const statusSig = await computeHubSignature256(statusRaw, SYNTHETIC_APP_SECRET)
      const statusIngest = await ingestWhatsappWebhook(
        {
          store: h.store,
          clock: h.clock,
          queue: { send: async (m) => { h.queue.push(m) } },
          env: { META_MODE: 'synthetic' },
        },
        { rawBody: statusRaw, signatureHeader: statusSig },
      )
      expect(statusIngest.ok).toBe(true)

      const statusMsg = h.queue.find((m) => m.kind === 'status')!
      let statusAck = false
      await handleInboundQueueBatch(
        {
          queue: 'tredane-inbound-dev',
          messages: [
            {
              id: 'qs',
              timestamp: new Date(),
              body: statusMsg,
              attempts: 1,
              ack: () => {
                statusAck = true
              },
              retry: () => undefined,
            },
          ],
        } as unknown as MessageBatch<WhatsappWebhookQueueMessage>,
        {
          env: {} as never,
          clock: h.clock,
          syncAdminDb: h.admin.db,
          clinicStub: () => ({
            ingestMessage: async () => {
              throw new Error('should_not_ingest_on_status')
            },
            applyWhatsappInterrupt: async () => ({ status: 'interrupted' }),
            recordInboundStatus: async (caller, input) => {
              const { recordInboundEvent } = await import('../clinic/inbound')
              const r = recordInboundEvent(
                clinicA.db,
                {
                  tenantId: caller.tenantId,
                  providerEventKey: input.providerEventKey,
                  payload: { kind: 'status', status: input.status },
                },
                clinicA.clock,
              )
              return { duplicate: r.duplicate, inboundId: r.row.id }
            },
          }),
        },
      )
      expect(statusAck).toBe(true)
      expect(listContacts(clinicA.db, T_A)).toHaveLength(0)

      h.queue.length = 0
      const unsupRaw = JSON.stringify({
        object: 'whatsapp_business_account',
        entry: [
          {
            id: 'e',
            changes: [
              {
                field: 'messages',
                value: {
                  metadata: { phone_number_id: 'pnid_a_status' },
                  contacts: [{ wa_id: '5511000000003', profile: { name: 'Sticker' } }],
                  messages: [
                    {
                      from: '5511000000003',
                      id: 'wamid.STK_UNSUP',
                      timestamp: '1700000300',
                      type: 'sticker',
                      sticker: { id: 'm1' },
                    },
                  ],
                },
              },
            ],
          },
        ],
      })
      const unsupSig = await computeHubSignature256(unsupRaw, SYNTHETIC_APP_SECRET)
      await ingestWhatsappWebhook(
        {
          store: h.store,
          clock: h.clock,
          queue: { send: async (m) => { h.queue.push(m) } },
          env: { META_MODE: 'synthetic' },
        },
        { rawBody: unsupRaw, signatureHeader: unsupSig },
      )
      const unsup = h.queue.find((m) => m.kind === 'unsupported')!
      await handleInboundQueueBatch(
        {
          queue: 'tredane-inbound-dev',
          messages: [
            {
              id: 'qu',
              timestamp: new Date(),
              body: unsup,
              attempts: 1,
              ack: () => undefined,
              retry: () => undefined,
            },
          ],
        } as unknown as MessageBatch<WhatsappWebhookQueueMessage>,
        {
          env: {} as never,
          clock: h.clock,
          syncAdminDb: h.admin.db,
          clinicStub: () =>
            ({
              ingestMessage: async (
                caller: ReturnType<typeof queueCaller>,
                input: {
                  providerEventKey: string
                  waId: string
                  displayName?: string
                  body: string
                  occurredAtMs?: number
                },
              ) => {
                const { ingestContactMessage } = await import('../clinic/operations')
                const r = ingestContactMessage(clinicA.db, caller, input, clinicA.clock)
                return {
                  duplicate: r.duplicate,
                  contactId: r.contact.id,
                  conversationId: r.conversation?.id ?? null,
                  messageId: r.message?.id ?? null,
                  inboundId: r.inbound.id,
                  outboxId: r.outbox?.id ?? null,
                  eventSeq: null,
                  drained: [],
                  fanout: null,
                }
              },
              applyWhatsappInterrupt: async () => ({ status: 'interrupted' }),
              recordInboundStatus: async () => ({ duplicate: false, inboundId: 'x' }),
            }) as never,
        },
      )
      const listed = clinicInbox.listConversationsOp(
        clinicA.db,
        queueCaller(T_A),
        { filter: 'all', limit: 10 },
        clinicA.clock,
      )
      expect(listed.items).toHaveLength(1)
      const detail = clinicInbox.getConversationDetailOp(
        clinicA.db,
        queueCaller(T_A),
        { conversationId: listed.items[0]!.id },
        clinicA.clock,
      )
      expect(detail.messages[0]?.body).toContain('não suportado')

      let retried = false
      await handleInboundQueueBatch(
        {
          queue: 'tredane-inbound-dev',
          messages: [
            {
              id: 'qp',
              timestamp: new Date(),
              body: {
                source: 'whatsapp_webhook',
                receiptId: findWebhookReceiptByKey(h.admin.db, 'wa:msg:wamid.STK_UNSUP')!.id,
                providerEventKey: 'wa:poison:1',
                tenantId: T_A,
                bindingId: 'bind_x',
                phoneNumberId: 'pnid_a_status',
                kind: 'message',
                __poison: true,
              },
              attempts: 3,
              ack: () => undefined,
              retry: () => {
                retried = true
              },
            },
          ],
        } as unknown as MessageBatch<WhatsappWebhookQueueMessage>,
        {
          env: {} as never,
          clock: h.clock,
          syncAdminDb: h.admin.db,
        },
      )
      expect(retried).toBe(true)
    } finally {
      h.close()
    }
  })
})
