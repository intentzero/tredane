/**
 * Rotas de anexos privados R2 (#34 / REQ-001/071).
 * Download só com membership vigente ou token efémero; bucket nunca público.
 */
import { Hono } from 'hono'
import { requireClinicPermission } from '../auth/authorize'
import {
  authErrorResponse,
  requireAuth,
  requireTenantAccess,
  type AuthEnv,
} from '../auth/middleware'
import { isAuthError } from '../auth/errors'
import {
  ClinicError,
  NotFoundError,
  ValidationError,
  workerCaller,
} from '../clinic'
import type { AttachmentRow } from '../clinic/attachments'
import type { WorkerBindings } from '../worker/bindings'
import {
  deleteAttachmentObject,
  downloadResponseHeaders,
  getAttachmentObject,
  putAttachmentObject,
} from './r2'
import { serializeAttachment } from './serialize'
import {
  mintAttachmentDownloadToken,
  resolveAttachmentTokenSecret,
  AttachmentTokenSecretMissingError,
  verifyAttachmentDownloadToken,
} from './tokens'
import { assertNoExternalDownloadUrl, sha256Hex, validateAttachmentBytes } from './validate'
import { RETENTION } from './policy'

type AttachEnv = {
  Bindings: WorkerBindings
  Variables: AuthEnv['Variables']
}

export type AttachmentRouteOptions = {
  /** Testes: stub do DO. */
  clinicStubFactory?: (
    env: WorkerBindings,
    tenantId: string,
  ) => {
    getAttachment: (
      caller: ReturnType<typeof workerCaller>,
      attachmentId: string,
    ) => Promise<AttachmentRow>
    createPendingAttachment: (
      caller: ReturnType<typeof workerCaller>,
      input: {
        contentType: string
        filename?: string | null
        source: 'human_upload' | 'synthetic'
        conversationId?: string | null
        messageId?: string | null
      },
    ) => Promise<AttachmentRow>
    markAttachmentReady: (
      caller: ReturnType<typeof workerCaller>,
      input: {
        attachmentId: string
        byteSize: number
        contentType: string
        sha256?: string | null
        filename?: string | null
      },
    ) => Promise<AttachmentRow>
    markAttachmentFailed: (
      caller: ReturnType<typeof workerCaller>,
      input: {
        attachmentId: string
        failureCode: string
        status?: 'failed' | 'unavailable'
      },
    ) => Promise<AttachmentRow>
    listConversationAttachments: (
      caller: ReturnType<typeof workerCaller>,
      conversationId: string,
    ) => Promise<AttachmentRow[]>
    listOrphanAttachments: (
      caller: ReturnType<typeof workerCaller>,
    ) => Promise<AttachmentRow[]>
    softDeleteAttachment: (
      caller: ReturnType<typeof workerCaller>,
      attachmentId: string,
    ) => Promise<AttachmentRow>
  }
}

function attachError(
  c: { json: (body: unknown, status?: number) => Response },
  err: unknown,
): Response {
  if (isAuthError(err)) return authErrorResponse(c, err)
  if (err instanceof AttachmentTokenSecretMissingError) {
    return c.json({ error: 'attachment_tokens_unconfigured' }, 503)
  }
  if (err instanceof ValidationError) {
    return c.json(
      { error: err.code, message: err.message, details: err.details ?? null },
      400,
    )
  }
  if (err instanceof NotFoundError) {
    return c.json({ error: err.code, message: err.message }, 404)
  }
  if (err instanceof ClinicError) {
    const status =
      err.code === 'tenant_mismatch' || err.code === 'unauthorized_caller'
        ? 403
        : 400
    return c.json({ error: err.code, message: err.message }, status)
  }
  return c.json(
    { error: err instanceof Error ? err.message : 'attachment_error' },
    400,
  )
}

function defaultStub(env: WorkerBindings, tenantId: string) {
  const stub = env.CLINIC.get(env.CLINIC.idFromName(tenantId))
  return {
    getAttachment: (caller: ReturnType<typeof workerCaller>, id: string) =>
      stub.getAttachment(caller, id),
    createPendingAttachment: (
      caller: ReturnType<typeof workerCaller>,
      input: Parameters<typeof stub.createPendingAttachment>[1],
    ) => stub.createPendingAttachment(caller, input),
    markAttachmentReady: (
      caller: ReturnType<typeof workerCaller>,
      input: Parameters<typeof stub.markAttachmentReady>[1],
    ) => stub.markAttachmentReady(caller, input),
    markAttachmentFailed: (
      caller: ReturnType<typeof workerCaller>,
      input: Parameters<typeof stub.markAttachmentFailed>[1],
    ) => stub.markAttachmentFailed(caller, input),
    listConversationAttachments: (
      caller: ReturnType<typeof workerCaller>,
      conversationId: string,
    ) => stub.listConversationAttachments(caller, conversationId),
    listOrphanAttachments: (caller: ReturnType<typeof workerCaller>) =>
      stub.listOrphanAttachments(caller),
    softDeleteAttachment: (caller: ReturnType<typeof workerCaller>, id: string) =>
      stub.softDeleteAttachment(caller, id),
  }
}

async function streamAttachment(
  env: WorkerBindings,
  tenantId: string,
  row: AttachmentRow,
): Promise<Response> {
  if (row.status !== 'ready') {
    return Response.json(
      {
        error: 'attachment_not_ready',
        status: row.status,
        failureCode: row.failureCode,
      },
      { status: row.status === 'pending' ? 202 : 404 },
    )
  }
  const obj = await getAttachmentObject(env.ATTACHMENTS, tenantId, row.id)
  if (!obj) {
    return Response.json(
      { error: 'attachment_unavailable', message: 'Blob ausente no armazenamento privado' },
      { status: 404 },
    )
  }
  return new Response(obj.body, {
    status: 200,
    headers: downloadResponseHeaders({
      contentType: row.contentType,
      filename: row.filename,
      byteSize: row.byteSize || obj.size,
    }),
  })
}

export function createAttachmentRoutes(opts: AttachmentRouteOptions = {}) {
  const app = new Hono<AttachEnv>()
  const tenant = [requireAuth(), requireTenantAccess({ param: 'tenantId' })] as const

  function clinic(env: WorkerBindings, tenantId: string) {
    return opts.clinicStubFactory?.(env, tenantId) ?? defaultStub(env, tenantId)
  }

  /** Metadados (sem bytes). */
  app.get(
    '/api/tenants/:tenantId/attachments/:attachmentId',
    ...tenant,
    async (c) => {
      try {
        const ctx = c.get('tenantContext')!
        requireClinicPermission(ctx, 'clinic.inbox.read')
        const tenantId = c.req.param('tenantId')
        const attachmentId = c.req.param('attachmentId')
        const principal = c.get('principal')!
        const caller = workerCaller(tenantId, principal.clerkUserId)
        const row = await clinic(c.env, tenantId).getAttachment(caller, attachmentId)
        if (row.tenantId !== tenantId) {
          return c.json({ error: 'not_found' }, 404)
        }
        c.header('Cache-Control', 'private, no-store')
        return c.json({ attachment: serializeAttachment(row) })
      } catch (err) {
        return attachError(c, err)
      }
    },
  )

  /**
   * Download autenticado (membership vigente).
   * Revogação → requireTenantAccess falha antes de ler R2.
   */
  app.get(
    '/api/tenants/:tenantId/attachments/:attachmentId/content',
    ...tenant,
    async (c) => {
      try {
        const ctx = c.get('tenantContext')!
        requireClinicPermission(ctx, 'clinic.inbox.read')
        const tenantId = c.req.param('tenantId')
        const attachmentId = c.req.param('attachmentId')
        const principal = c.get('principal')!
        const caller = workerCaller(tenantId, principal.clerkUserId)
        const row = await clinic(c.env, tenantId).getAttachment(caller, attachmentId)
        if (row.tenantId !== tenantId) {
          return c.json({ error: 'not_found' }, 404)
        }
        return streamAttachment(c.env, tenantId, row)
      } catch (err) {
        return attachError(c, err)
      }
    },
  )

  /** Emite URL/token efémero (Proposto: 15 min) — renovável com auth vigente. */
  app.post(
    '/api/tenants/:tenantId/attachments/:attachmentId/download-token',
    ...tenant,
    async (c) => {
      try {
        const ctx = c.get('tenantContext')!
        requireClinicPermission(ctx, 'clinic.inbox.read')
        const tenantId = c.req.param('tenantId')
        const attachmentId = c.req.param('attachmentId')
        const principal = c.get('principal')!
        const caller = workerCaller(tenantId, principal.clerkUserId)
        const row = await clinic(c.env, tenantId).getAttachment(caller, attachmentId)
        if (row.tenantId !== tenantId || row.status !== 'ready') {
          return c.json({ error: 'attachment_not_ready' }, 404)
        }
        const secret = resolveAttachmentTokenSecret(c.env)
        const minted = await mintAttachmentDownloadToken({
          secret,
          tenantId,
          attachmentId,
          subjectClerkUserId: principal.clerkUserId,
        })
        c.header('Cache-Control', 'private, no-store')
        return c.json({
          token: minted.token,
          expiresAt: minted.expiresAt,
          ttlMs: RETENTION.ephemeralDownloadTtlMs,
          path: `/api/tenants/${tenantId}/attachments/${attachmentId}/content-token`,
        })
      } catch (err) {
        return attachError(c, err)
      }
    },
  )

  /**
   * Download com token efémero (sem sessão Clerk no header).
   * Ainda exige tenantId + attachmentId coerentes com o token.
   * Revogação: tokens antigos expiram; novos tokens exigem membership no mint.
   */
  app.get(
    '/api/tenants/:tenantId/attachments/:attachmentId/content-token',
    async (c) => {
      try {
        const tenantId = c.req.param('tenantId')
        const attachmentId = c.req.param('attachmentId')
        const token =
          c.req.query('token') ??
          c.req.header('x-attachment-token') ??
          ''
        if (!token) {
          return c.json({ error: 'token_required' }, 401)
        }
        const secret = resolveAttachmentTokenSecret(c.env)
        const verified = await verifyAttachmentDownloadToken({
          secret,
          token,
          expectedTenantId: tenantId,
          expectedAttachmentId: attachmentId,
        })
        if (!verified.ok) {
          return c.json({ error: verified.code }, 401)
        }
        // Metadados via DO com caller do subject do token (sem trust no cliente).
        const caller = workerCaller(tenantId, verified.claims.sub)
        const row = await clinic(c.env, tenantId).getAttachment(caller, attachmentId)
        if (row.tenantId !== tenantId) {
          return c.json({ error: 'not_found' }, 404)
        }
        return streamAttachment(c.env, tenantId, row)
      } catch (err) {
        return attachError(c, err)
      }
    },
  )

  /**
   * Upload humano (API). UI de envio: Em aberto (DEC-011).
   * Valida tipo/tamanho; falha de R2 → status failed, sem mensagem «enviada».
   * Recusa `sourceUrl` externo.
   */
  app.post(
    '/api/tenants/:tenantId/inbox/conversations/:conversationId/attachments',
    ...tenant,
    async (c) => {
      try {
        const ctx = c.get('tenantContext')!
        requireClinicPermission(ctx, 'clinic.inbox.reply')
        const tenantId = c.req.param('tenantId')
        const conversationId = c.req.param('conversationId')
        const principal = c.get('principal')!
        const caller = workerCaller(tenantId, principal.clerkUserId)

        const contentTypeHeader =
          c.req.header('content-type')?.split(';')[0]?.trim() ?? ''
        let bytes: Uint8Array
        let contentType = contentTypeHeader
        let filename: string | null = null

        if (contentTypeHeader.includes('multipart/form-data')) {
          const form = await c.req.formData()
          const external = form.get('sourceUrl')
          const forbidden = assertNoExternalDownloadUrl(
            typeof external === 'string' ? external : null,
          )
          if (forbidden) {
            return c.json({ error: forbidden.code, message: forbidden.message }, 400)
          }
          const file = form.get('file')
          if (!(file instanceof File)) {
            return c.json({ error: 'file_required' }, 400)
          }
          bytes = new Uint8Array(await file.arrayBuffer())
          contentType = file.type || contentTypeHeader
          filename = file.name || null
        } else {
          const body = (await c.req.json().catch(() => null)) as {
            contentType?: string
            filename?: string
            base64?: string
            sourceUrl?: string
          } | null
          const forbidden = assertNoExternalDownloadUrl(body?.sourceUrl)
          if (forbidden) {
            return c.json({ error: forbidden.code, message: forbidden.message }, 400)
          }
          if (!body?.base64 || !body.contentType) {
            return c.json({ error: 'base64_and_content_type_required' }, 400)
          }
          contentType = body.contentType
          filename = body.filename ?? null
          const bin = atob(body.base64)
          bytes = new Uint8Array(bin.length)
          for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
        }

        const validation = validateAttachmentBytes({ contentType, bytes, filename })
        if (!validation.ok) {
          return c.json(
            { error: validation.code, message: validation.message },
            400,
          )
        }

        const stub = clinic(c.env, tenantId)
        const pending = await stub.createPendingAttachment(caller, {
          contentType: validation.contentType,
          filename,
          source: 'human_upload',
          conversationId,
        })

        try {
          const hash = await sha256Hex(bytes)
          await putAttachmentObject({
            bucket: c.env.ATTACHMENTS,
            tenantId,
            attachmentId: pending.id,
            bytes,
            contentType: validation.contentType,
            sha256Hex: hash,
          })
          const ready = await stub.markAttachmentReady(caller, {
            attachmentId: pending.id,
            byteSize: validation.byteSize,
            contentType: validation.contentType,
            sha256: hash,
            filename,
          })
          c.header('Cache-Control', 'private, no-store')
          return c.json({ attachment: serializeAttachment(ready) }, 201)
        } catch (err) {
          const code = err instanceof Error ? err.message.slice(0, 80) : 'r2_put_failed'
          const failed = await stub.markAttachmentFailed(caller, {
            attachmentId: pending.id,
            failureCode: code,
            status: 'failed',
          })
          // Não cria mensagem outbound — upload falhou.
          return c.json(
            {
              error: 'upload_failed',
              attachment: serializeAttachment(failed),
            },
            502,
          )
        }
      } catch (err) {
        return attachError(c, err)
      }
    },
  )

  /** Lista anexos de uma conversa. */
  app.get(
    '/api/tenants/:tenantId/inbox/conversations/:conversationId/attachments',
    ...tenant,
    async (c) => {
      try {
        const ctx = c.get('tenantContext')!
        requireClinicPermission(ctx, 'clinic.inbox.read')
        const tenantId = c.req.param('tenantId')
        const conversationId = c.req.param('conversationId')
        const principal = c.get('principal')!
        const caller = workerCaller(tenantId, principal.clerkUserId)
        const rows = await clinic(c.env, tenantId).listConversationAttachments(
          caller,
          conversationId,
        )
        return c.json({
          attachments: rows
            .filter((r) => r.tenantId === tenantId)
            .map(serializeAttachment),
        })
      } catch (err) {
        return attachError(c, err)
      }
    },
  )

  /**
   * Limpeza de órfãos (pending expirado / failed): soft-delete metadados + delete R2.
   * Referências permanecem rastreáveis via soft-delete até exclusão de contacto/tenant.
   */
  app.post(
    '/api/tenants/:tenantId/attachments/cleanup-orphans',
    ...tenant,
    async (c) => {
      try {
        const ctx = c.get('tenantContext')!
        requireClinicPermission(ctx, 'clinic.config.write')
        const tenantId = c.req.param('tenantId')
        const principal = c.get('principal')!
        const caller = workerCaller(tenantId, principal.clerkUserId)
        const stub = clinic(c.env, tenantId)
        const orphans = await stub.listOrphanAttachments(caller)
        const cleaned: string[] = []
        for (const row of orphans) {
          if (row.tenantId !== tenantId) continue
          try {
            await deleteAttachmentObject(c.env.ATTACHMENTS, tenantId, row.id)
          } catch {
            /* best-effort */
          }
          await stub.softDeleteAttachment(caller, row.id)
          cleaned.push(row.id)
        }
        return c.json({
          cleaned,
          orphanPendingMaxAgeMs: RETENTION.orphanPendingMaxAgeMs,
          retentionNote: RETENTION.detailedRetentionPolicy,
        })
      } catch (err) {
        return attachError(c, err)
      }
    },
  )

  return app
}
