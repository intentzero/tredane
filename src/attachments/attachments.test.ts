/**
 * Anexos privados R2 + autorização (#34 / AC-01, REQ-001/071).
 */
import { describe, expect, it } from 'vitest'
import { createApp } from '../worker/app'
import type { WorkerBindings } from '../worker/bindings'
import { bootAdminDb } from '../db/test-db'
import { asyncFromSync } from '../db/admin/async-store'
import {
  createSyntheticAuthorityReader,
  createSyntheticSessionAuthenticator,
  synthAuthHeader,
  type AuthServices,
} from '../auth'
import { bootClinicDb } from '../clinic/test-db'
import {
  clinicAttachments,
  clinicInbox,
  ingestContactMessage,
  workerCaller,
} from '../clinic'
import { createMemoryInboxRegistry } from '../inbox/gateway'
import { putAttachmentObject, getAttachmentObject } from './r2'
import { createMemoryR2Bucket } from './memory-r2'
import {
  mintAttachmentDownloadToken,
  resolveAttachmentTokenSecret,
  verifyAttachmentDownloadToken,
} from './tokens'
import {
  assertNoExternalDownloadUrl,
  validateAttachmentBytes,
} from './validate'
import { SYNTHETIC_MEDIA_FIXTURES } from '../whatsapp/media'
import { RETENTION, PILOT_MAX_BYTES } from './policy'
import { attachmentR2Key } from './keys'
import { handleInboundQueueBatch } from '../whatsapp/queue-consumer'
import { createSyntheticMetaMediaAdapter } from '../whatsapp/media'
import { activateBinding } from '../whatsapp/bindings'
import { sealAccessToken } from '../whatsapp/crypto'
import { createControllableClock } from '../db/clock'
import { queueCaller } from '../clinic'
import type { WhatsappWebhookQueueMessage } from '../whatsapp/queue-types'

function ensureClinic(
  clinics: Map<string, ReturnType<typeof bootClinicDb>>,
  tenantId: string,
) {
  let boot = clinics.get(tenantId)
  if (!boot) {
    boot = bootClinicDb()
    clinics.set(tenantId, boot)
  }
  return boot
}

function testAttachmentApp(bucket: R2Bucket) {
  const admin = bootAdminDb()
  const clinics = new Map<string, ReturnType<typeof bootClinicDb>>()
  const registry = createMemoryInboxRegistry((tenantId) => {
    const boot = ensureClinic(clinics, tenantId)
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
    inboxGatewayFactory: (_env, tenantId) => registry(tenantId),
    attachments: {
      clinicStubFactory: (_env, tenantId) => {
        const boot = ensureClinic(clinics, tenantId)
        const { db, clock } = boot
        return {
          getAttachment: (caller, id) =>
            Promise.resolve(
              clinicAttachments.getAttachmentOp(db, caller, id, clock),
            ),
          createPendingAttachment: (caller, input) =>
            Promise.resolve(
              clinicAttachments.createPendingAttachmentOp(db, caller, input, clock),
            ),
          markAttachmentReady: (caller, input) =>
            Promise.resolve(
              clinicAttachments.markAttachmentReadyOp(db, caller, input, clock),
            ),
          markAttachmentFailed: (caller, input) =>
            Promise.resolve(
              clinicAttachments.markAttachmentFailedOp(db, caller, input, clock),
            ),
          listConversationAttachments: (caller, conversationId) => {
            const meta = clinicAttachments.getAttachment // touch
            void meta
            return Promise.resolve(
              clinicAttachments.listAttachmentsForConversation(
                db,
                tenantId,
                conversationId,
              ),
            )
          },
          listOrphanAttachments: (caller) => {
            void caller
            return Promise.resolve(
              clinicAttachments.listOrphanCandidates(db, tenantId, clock.nowMs()),
            )
          },
          softDeleteAttachment: (caller, id) =>
            Promise.resolve(
              clinicAttachments.softDeleteAttachmentOp(db, caller, id, clock),
            ),
        }
      },
    },
  })

  // Injeta ATTACHMENTS no env do pedido via wrapper.
  const originalFetch = app.fetch.bind(app)
  app.fetch = ((request: Request, env?: WorkerBindings, ctx?: ExecutionContext) => {
    const merged = {
      ...(env ?? {}),
      ATTACHMENTS: bucket,
      ENVIRONMENT: 'development',
    } as WorkerBindings
    return originalFetch(request, merged, ctx)
  }) as typeof app.fetch

  return {
    app,
    admin,
    clinics,
    bucket,
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

describe('Anexos — política e validação (#34)', () => {
  it('recusa tipo bloqueado, tamanho acima do limite e URL externa', () => {
    const html = validateAttachmentBytes({
      contentType: 'text/html',
      bytes: new TextEncoder().encode('<html></html>'),
    })
    expect(html.ok).toBe(false)
    if (!html.ok) expect(html.code).toBe('type_blocked')

    const oversize = new Uint8Array(PILOT_MAX_BYTES.image + 1)
    oversize[0] = 0xff
    oversize[1] = 0xd8
    const big = validateAttachmentBytes({
      contentType: 'image/jpeg',
      bytes: oversize,
    })
    expect(big.ok).toBe(false)
    if (!big.ok) expect(big.code).toBe('size_exceeded')

    expect(assertNoExternalDownloadUrl('https://evil.example/x.bin')?.code).toBe(
      'external_url_forbidden',
    )
    expect(assertNoExternalDownloadUrl(null)).toBeNull()

    const ok = validateAttachmentBytes({
      contentType: 'image/jpeg',
      bytes: SYNTHETIC_MEDIA_FIXTURES.jpeg,
      filename: 'foto.jpg',
    })
    expect(ok.ok).toBe(true)
  })

  it('token efémero falha entre tenants e após expiração', async () => {
    const secret = resolveAttachmentTokenSecret({ ENVIRONMENT: 'test' })
    const minted = await mintAttachmentDownloadToken({
      secret,
      tenantId: 'clinic-demo-a',
      attachmentId: 'att_1',
      subjectClerkUserId: 'user_synth_attendant_a',
      nowMs: 1_000_000,
      ttlMs: 60_000,
    })
    const cross = await verifyAttachmentDownloadToken({
      secret,
      token: minted.token,
      expectedTenantId: 'clinic-demo-b',
      expectedAttachmentId: 'att_1',
      nowMs: 1_010_000,
    })
    expect(cross.ok).toBe(false)
    if (!cross.ok) expect(cross.code).toBe('tenant_mismatch')

    const expired = await verifyAttachmentDownloadToken({
      secret,
      token: minted.token,
      expectedTenantId: 'clinic-demo-a',
      expectedAttachmentId: 'att_1',
      nowMs: 1_000_000 + 60_001,
    })
    expect(expired.ok).toBe(false)
    if (!expired.ok) expect(expired.code).toBe('expired')
  })

  it('confirma que anexos nunca entram no contexto IA (política)', () => {
    expect(RETENTION.attachmentsNeverInAiContext).toBe(true)
    expect(RETENTION.detailedRetentionPolicy).toBe('em_aberto')
  })
})

describe('Anexos — isolamento R2 e HTTP (#34)', () => {
  it('ID/chave de A não permite leitura por B; upload falho não inventa ready', async () => {
    const bucket = createMemoryR2Bucket()
    const t = testAttachmentApp(bucket)
    try {
      const bootA = ensureClinic(t.clinics, 'clinic-demo-a')
      const callerA = workerCaller('clinic-demo-a', 'user_synth_attendant_a')
      const ingested = ingestContactMessage(
        bootA.db,
        callerA,
        {
          providerEventKey: 'wa:msg:att1',
          waId: '5511999000001',
          body: 'com anexo',
        },
        bootA.clock,
      )
      const pending = clinicAttachments.createPendingAttachmentOp(
        bootA.db,
        callerA,
        {
          contentType: 'image/jpeg',
          source: 'synthetic',
          conversationId: ingested.conversation!.id,
          messageId: ingested.message!.id,
        },
        bootA.clock,
      )
      await putAttachmentObject({
        bucket,
        tenantId: 'clinic-demo-a',
        attachmentId: pending.id,
        bytes: SYNTHETIC_MEDIA_FIXTURES.jpeg,
        contentType: 'image/jpeg',
      })
      clinicAttachments.markAttachmentReadyOp(
        bootA.db,
        callerA,
        {
          attachmentId: pending.id,
          byteSize: SYNTHETIC_MEDIA_FIXTURES.jpeg.byteLength,
          contentType: 'image/jpeg',
          filename: 'a.jpg',
        },
        bootA.clock,
      )

      // A lê
      const okA = await t.app.request(
        `http://localhost/api/tenants/clinic-demo-a/attachments/${pending.id}/content`,
        t.auth('user_synth_attendant_a'),
      )
      expect(okA.status).toBe(200)
      expect(okA.headers.get('Content-Disposition')).toContain('attachment')
      expect(okA.headers.get('X-Content-Type-Options')).toBe('nosniff')

      // B com o mesmo ID — membership B, tenant path B → negado (404/403, sem bytes)
      const denyB = await t.app.request(
        `http://localhost/api/tenants/clinic-demo-b/attachments/${pending.id}/content`,
        t.auth('user_synth_attendant_b'),
      )
      expect([403, 404]).toContain(denyB.status)
      expect(await denyB.clone().text()).not.toMatch(/JFIF|^\xff\xd8/)

      // B autenticado a tentar path de A → 403/401 membership
      const cross = await t.app.request(
        `http://localhost/api/tenants/clinic-demo-a/attachments/${pending.id}/content`,
        t.auth('user_synth_attendant_b'),
      )
      expect([401, 403]).toContain(cross.status)

      // Chave R2 de A não é legível sob tenant B
      const wrong = await getAttachmentObject(bucket, 'clinic-demo-b', pending.id)
      expect(wrong).toBeNull()
      const right = await getAttachmentObject(bucket, 'clinic-demo-a', pending.id)
      expect(right).not.toBeNull()
      expect(attachmentR2Key('clinic-demo-a', pending.id)).toContain(
        'tenants/clinic-demo-a/attachments/',
      )

      // Upload com tipo bloqueado
      const bad = await t.app.request(
        `http://localhost/api/tenants/clinic-demo-a/inbox/conversations/${ingested.conversation!.id}/attachments`,
        t.auth('user_synth_attendant_a', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contentType: 'text/html',
            base64: btoa('<html>x</html>'),
            sourceUrl: 'https://evil.example/x',
          }),
        }),
      )
      expect(bad.status).toBe(400)
      const badBody = (await bad.json()) as { error: string }
      expect(['external_url_forbidden', 'type_blocked']).toContain(badBody.error)

      // Upload válido
      const jpegB64 = btoa(String.fromCharCode(...SYNTHETIC_MEDIA_FIXTURES.jpeg))
      const up = await t.app.request(
        `http://localhost/api/tenants/clinic-demo-a/inbox/conversations/${ingested.conversation!.id}/attachments`,
        t.auth('user_synth_attendant_a', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contentType: 'image/jpeg',
            filename: 'up.jpg',
            base64: jpegB64,
          }),
        }),
      )
      expect(up.status).toBe(201)
      const upBody = (await up.json()) as {
        attachment: { status: string; includedInAiContext: boolean; r2Key?: string }
      }
      expect(upBody.attachment.status).toBe('ready')
      expect(upBody.attachment.includedInAiContext).toBe(false)
      expect(upBody.attachment.r2Key).toBeUndefined()

      // Metadados na conversa + DEC-011
      const detail = clinicInbox.getConversationDetailOp(
        bootA.db,
        callerA,
        { conversationId: ingested.conversation!.id },
        bootA.clock,
      )
      const withAtt = detail.messages.find((m) => m.id === ingested.message!.id)
      expect(withAtt?.attachments?.[0]?.includedInAiContext).toBe(false)
    } finally {
      t.close()
    }
  })

  it('revogação bloqueia novas autorizações de download', async () => {
    const bucket = createMemoryR2Bucket()
    const t = testAttachmentApp(bucket)
    try {
      const bootA = ensureClinic(t.clinics, 'clinic-demo-a')
      const callerA = workerCaller('clinic-demo-a', 'user_synth_attendant_a')
      const ingested = ingestContactMessage(
        bootA.db,
        callerA,
        {
          providerEventKey: 'wa:msg:rev1',
          waId: '5511999000002',
          body: 'rev',
        },
        bootA.clock,
      )
      const pending = clinicAttachments.createPendingAttachmentOp(
        bootA.db,
        callerA,
        {
          contentType: 'image/jpeg',
          source: 'synthetic',
          conversationId: ingested.conversation!.id,
          messageId: ingested.message!.id,
        },
        bootA.clock,
      )
      await putAttachmentObject({
        bucket,
        tenantId: 'clinic-demo-a',
        attachmentId: pending.id,
        bytes: SYNTHETIC_MEDIA_FIXTURES.jpeg,
        contentType: 'image/jpeg',
      })
      clinicAttachments.markAttachmentReadyOp(
        bootA.db,
        callerA,
        {
          attachmentId: pending.id,
          byteSize: SYNTHETIC_MEDIA_FIXTURES.jpeg.byteLength,
          contentType: 'image/jpeg',
        },
        bootA.clock,
      )

      const tokenRes = await t.app.request(
        `http://localhost/api/tenants/clinic-demo-a/attachments/${pending.id}/download-token`,
        t.auth('user_synth_attendant_a', { method: 'POST' }),
      )
      expect(tokenRes.status).toBe(200)

      // Revoga membership attendant A
      t.admin.db.run(
        `UPDATE tenant_memberships SET status = 'revoked', revoked_at = ?
         WHERE tenant_id = ? AND clerk_user_id = ?`,
        Date.now(),
        'clinic-demo-a',
        'user_synth_attendant_a',
      )

      const after = await t.app.request(
        `http://localhost/api/tenants/clinic-demo-a/attachments/${pending.id}/download-token`,
        t.auth('user_synth_attendant_a', { method: 'POST' }),
      )
      expect([401, 403]).toContain(after.status)

      const content = await t.app.request(
        `http://localhost/api/tenants/clinic-demo-a/attachments/${pending.id}/content`,
        t.auth('user_synth_attendant_a'),
      )
      expect([401, 403]).toContain(content.status)
    } finally {
      t.close()
    }
  })
})

describe('Anexos — ingestão mídia Meta sintética (#34)', () => {
  it('consome kind=media, grava R2 e liga à mensagem; tipo bloqueado → failed', async () => {
    const bucket = createMemoryR2Bucket()
    const admin = bootAdminDb()
    const clinic = bootClinicDb()
    const clock = createControllableClock(1_700_000_000_000)
    try {
      // Binding + credencial sintética
      const sealed = await sealAccessToken(
        'synth_token_pn',
        {},
        'synthetic',
      )
      const activated = activateBinding(admin.db, clock, {
        tenantId: 'clinic-demo-a',
        actorClerkUserId: 'user_synth_owner_a',
        phoneNumberId: 'pn_media_a',
        wabaId: 'waba_media_a',
        displayPhone: '+15551234567',
        displayName: null,
        accessTokenCipher: sealed,
        tokenType: 'bearer',
        expiresAt: null,
        purpose: 'connect',
      })
      expect(activated.ok).toBe(true)

      const stub = {
        createPendingAttachment: (
          c: ReturnType<typeof queueCaller>,
          input: Parameters<typeof clinicAttachments.createPendingAttachmentOp>[2],
        ) =>
          clinicAttachments.createPendingAttachmentOp(clinic.db, c, input, clock),
        markAttachmentReady: (
          c: ReturnType<typeof queueCaller>,
          input: Parameters<typeof clinicAttachments.markAttachmentReadyOp>[2],
        ) => clinicAttachments.markAttachmentReadyOp(clinic.db, c, input, clock),
        markAttachmentFailed: (
          c: ReturnType<typeof queueCaller>,
          input: Parameters<typeof clinicAttachments.markAttachmentFailedOp>[2],
        ) => clinicAttachments.markAttachmentFailedOp(clinic.db, c, input, clock),
        linkAttachmentToMessage: (
          c: ReturnType<typeof queueCaller>,
          input: Parameters<typeof clinicAttachments.linkAttachmentToMessageOp>[2],
        ) =>
          clinicAttachments.linkAttachmentToMessageOp(clinic.db, c, input, clock),
        ingestMessage: (
          c: ReturnType<typeof queueCaller>,
          input: Parameters<typeof ingestContactMessage>[2],
        ) => {
          const r = ingestContactMessage(clinic.db, c, input, clock)
          return {
            duplicate: r.duplicate,
            messageId: r.message?.id ?? null,
            conversationId: r.conversation?.id ?? null,
            contactId: r.contact!.id,
            inboundId: r.inbound.id,
            outboxId: r.outbox?.id ?? null,
            eventSeq: null,
            drained: [],
            fanout: null,
          }
        },
        applyWhatsappInterrupt: async () => ({ ok: true }),
        recordInboundStatus: async () => ({
          duplicate: false,
          inboundId: 'x',
          advanced: false,
        }),
      }

      const mediaMsg: WhatsappWebhookQueueMessage = {
        source: 'whatsapp_webhook',
        receiptId: 'rcpt_media_1',
        providerEventKey: 'wa:msg:wamid.MEDIA_OK',
        tenantId: 'clinic-demo-a',
        bindingId: 'bind_x',
        phoneNumberId: 'pn_media_a',
        kind: 'media',
        waId: '5511888000001',
        displayName: 'Cliente',
        body: '[Imagem]',
        messageType: 'image',
        mediaId: 'media_jpeg_ok',
        mediaMimeType: 'image/jpeg',
        providerTimestamp: clock.nowMs(),
      }

      await handleInboundQueueBatch(
        {
          queue: 'tredane-inbound-dev',
          messages: [
            {
              id: 'q1',
              timestamp: new Date(),
              body: mediaMsg,
              attempts: 1,
              ack: () => undefined,
              retry: () => undefined,
            },
          ],
        } as unknown as MessageBatch<WhatsappWebhookQueueMessage>,
        {
          env: {
            ATTACHMENTS: bucket,
            META_MODE: 'synthetic',
          } as never,
          clock,
          syncAdminDb: admin.db,
          clinicStub: () => stub as never,
          mediaAdapter: createSyntheticMetaMediaAdapter(),
        },
      )

      const readyRow = clinic.db.get<{
        id: string
        status: string
        conversation_id: string | null
      }>(
        `SELECT id, status, conversation_id FROM attachments
         WHERE tenant_id = ? AND provider_media_id = ?`,
        'clinic-demo-a',
        'media_jpeg_ok',
      )
      expect(readyRow?.status).toBe('ready')
      expect(readyRow?.conversation_id).toBeTruthy()
      const obj = await getAttachmentObject(bucket, 'clinic-demo-a', readyRow!.id)
      expect(obj).not.toBeNull()

      // Tipo bloqueado via fixture html
      const blockedMsg: WhatsappWebhookQueueMessage = {
        ...mediaMsg,
        receiptId: 'rcpt_media_2',
        providerEventKey: 'wa:msg:wamid.MEDIA_HTML',
        mediaId: 'media_html_blocked',
      }
      await handleInboundQueueBatch(
        {
          queue: 'tredane-inbound-dev',
          messages: [
            {
              id: 'q2',
              timestamp: new Date(),
              body: blockedMsg,
              attempts: 1,
              ack: () => undefined,
              retry: () => undefined,
            },
          ],
        } as unknown as MessageBatch<WhatsappWebhookQueueMessage>,
        {
          env: { ATTACHMENTS: bucket, META_MODE: 'synthetic' } as never,
          clock,
          syncAdminDb: admin.db,
          clinicStub: () => stub as never,
          mediaAdapter: createSyntheticMetaMediaAdapter(),
        },
      )
      const failed = clinic.db.get<{ status: string; failure_code: string }>(
        `SELECT status, failure_code FROM attachments
         WHERE tenant_id = ? AND provider_media_id = ?`,
        'clinic-demo-a',
        'media_html_blocked',
      )
      expect(failed?.status).toBe('failed')
      expect(failed?.failure_code).toMatch(/type_/)
    } finally {
      clinic.close()
      admin.close()
    }
  })
})
