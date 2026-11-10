/**
 * DEC-158 — MCP review: auth, isolamento tenant, tools read-only.
 */
import { describe, expect, it } from 'vitest'
import { createApp } from '../../worker/app'
import { bootAdminDb } from '../../db/test-db'
import { asyncFromSync } from '../../db/admin/async-store'
import {
  createSyntheticAuthorityReader,
  createSyntheticSessionAuthenticator,
  synthAuthHeader,
  type AuthServices,
} from '../../auth'
import { bootClinicDb } from '../../clinic/test-db'
import { clinicWhatsapp, workerCaller } from '../../clinic'
import { createMemoryInboxRegistry } from '../../inbox/gateway'
import { DIAGNOSIS_GUIDANCE, REVIEW_MCP_TOOLS } from './tools'

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

function testMcpApp() {
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
  })
  return {
    app,
    clinics,
    registry,
    close: () => {
      for (const c of clinics.values()) c.close()
      admin.close()
    },
    mcp: async (
      userId: string | null,
      body: unknown,
    ): Promise<{ status: number; json: Record<string, unknown> }> => {
      const init: RequestInit = {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }
      if (userId) {
        const headers = new Headers(init.headers)
        headers.set('Authorization', synthAuthHeader(userId))
        init.headers = headers
      }
      const res = await app.request('http://localhost/api/mcp/review', init)
      return { status: res.status, json: (await res.json()) as Record<string, unknown> }
    },
  }
}

async function seedFlaggedConversation(
  clinics: Map<string, ReturnType<typeof bootClinicDb>>,
  tenantId: string,
  userId: string,
) {
  const { db, clock } = ensureClinic(clinics, tenantId)
  clinicWhatsapp.syncWhatsappChannel(
    db,
    tenantId,
    {
      status: 'connected',
      bindingId: `bind_mcp_${tenantId}`,
      phoneNumberId: `pn_mcp_${tenantId}`,
      wabaId: `waba_mcp_${tenantId}`,
      displayPhone: '+5511900000001',
      action: 'channel_connected',
    },
    clock,
  )
  const gw = createMemoryInboxRegistry(() => ({ db, clock }))(tenantId)
  await gw.seedDemo(workerCaller(tenantId, userId), { force: true })
  const listed = await gw.listConversations(workerCaller(tenantId, userId), {
    filter: 'all',
    viewerClerkUserId: userId,
  })
  const cnv = listed.items[0]
  if (!cnv) throw new Error('seed sem conversa')
  await gw.flagForReview(workerCaller(tenantId, userId), cnv.id)
  return cnv.id
}

describe('HTTP — MCP review (DEC-158)', () => {
  it('GET 405; initialize aberto; tools/list e tools/call sem Bearer → 401', async () => {
    const { app, mcp, close } = testMcpApp()
    try {
      const get = await app.request('http://localhost/api/mcp/review')
      expect(get.status).toBe(405)

      const init = await mcp(null, {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-03-26',
          capabilities: {},
          clientInfo: { name: 'test', version: '0' },
        },
      })
      expect(init.status).toBe(200)
      expect(init.json.result).toMatchObject({
        serverInfo: { name: 'tredane-review-conversations' },
      })

      const unauthList = await mcp(null, {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/list',
      })
      expect(unauthList.status).toBe(401)

      const unauthCall = await mcp(null, {
        jsonrpc: '2.0',
        id: 2.5,
        method: 'tools/call',
        params: {
          name: 'list_review_conversations',
          arguments: { tenantId: 'clinic-demo-a' },
        },
      })
      expect(unauthCall.status).toBe(401)
      expect((unauthCall.json.error as { data?: { error?: string } } | undefined)?.data?.error).toBe(
        'unauthenticated',
      )

      const list = await mcp('user_synth_attendant_a', {
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/list',
      })
      expect(list.status).toBe(200)
      const tools = (list.json.result as { tools: Array<{ name: string }> }).tools
      expect(tools.map((t) => t.name).sort()).toEqual(
        [...REVIEW_MCP_TOOLS.map((t) => t.name)].sort(),
      )
      expect(tools.every((t) => !/flag|clear|write|send/i.test(t.name))).toBe(true)
    } finally {
      close()
    }
  })

  it('lista e detalhe só no tenant com membership; diagnóstico agent-side; não flagged → not found', async () => {
    const { mcp, clinics, registry, close } = testMcpApp()
    try {
      const conversationId = await seedFlaggedConversation(
        clinics,
        'clinic-demo-a',
        'user_synth_attendant_a',
      )

      const list = await mcp('user_synth_attendant_a', {
        jsonrpc: '2.0',
        id: 10,
        method: 'tools/call',
        params: {
          name: 'list_review_conversations',
          arguments: { tenantId: 'clinic-demo-a' },
        },
      })
      expect(list.status).toBe(200)
      const listResult = list.json.result as {
        isError?: boolean
        structuredContent?: {
          conversations: Array<{ id: string; forReview?: boolean }>
        }
      }
      expect(listResult.isError).toBeFalsy()
      expect(listResult.structuredContent?.conversations.some((c) => c.id === conversationId)).toBe(
        true,
      )

      const cross = await mcp('user_synth_owner_b', {
        jsonrpc: '2.0',
        id: 11,
        method: 'tools/call',
        params: {
          name: 'list_review_conversations',
          arguments: { tenantId: 'clinic-demo-a' },
        },
      })
      expect(cross.status).toBe(200)
      const crossResult = cross.json.result as {
        isError?: boolean
        structuredContent?: { error?: string }
      }
      expect(crossResult.isError).toBe(true)
      expect(crossResult.structuredContent?.error).toBe('tenant_access_denied')

      const detail = await mcp('user_synth_attendant_a', {
        jsonrpc: '2.0',
        id: 12,
        method: 'tools/call',
        params: {
          name: 'get_review_conversation',
          arguments: { tenantId: 'clinic-demo-a', conversationId },
        },
      })
      expect(detail.status).toBe(200)
      const detailResult = detail.json.result as {
        isError?: boolean
        structuredContent?: { id: string; messages: unknown[] }
      }
      expect(detailResult.isError).toBeFalsy()
      expect(detailResult.structuredContent?.id).toBe(conversationId)
      expect(Array.isArray(detailResult.structuredContent?.messages)).toBe(true)

      const diag = await mcp('user_synth_attendant_a', {
        jsonrpc: '2.0',
        id: 13,
        method: 'tools/call',
        params: {
          name: 'propose_review_diagnosis',
          arguments: { tenantId: 'clinic-demo-a', conversationId },
        },
      })
      expect(diag.status).toBe(200)
      const diagResult = diag.json.result as {
        isError?: boolean
        structuredContent?: {
          diagnosisGuidance: string
          note: string
          conversation: { id: string; messages?: unknown }
          messages: unknown[]
        }
      }
      expect(diagResult.isError).toBeFalsy()
      expect(diagResult.structuredContent?.diagnosisGuidance).toBe(DIAGNOSIS_GUIDANCE)
      expect(diagResult.structuredContent?.note).toBe('agent_side_diagnosis_only')
      expect(diagResult.structuredContent?.conversation.id).toBe(conversationId)
      expect(diagResult.structuredContent?.conversation.messages).toBeUndefined()
      expect(Array.isArray(diagResult.structuredContent?.messages)).toBe(true)

      // Sem tenantId → erro de params (não dump).
      const missingTenant = await mcp('user_synth_attendant_a', {
        jsonrpc: '2.0',
        id: 14,
        method: 'tools/call',
        params: { name: 'list_review_conversations', arguments: {} },
      })
      expect(missingTenant.status).toBe(200)
      expect((missingTenant.json.result as { isError?: boolean }).isError).toBe(true)

      // Limpar flag → detail not found (paridade API #670).
      await registry('clinic-demo-a').clearReviewFlag(
        workerCaller('clinic-demo-a', 'user_synth_attendant_a'),
        conversationId,
      )
      const cleared = await mcp('user_synth_attendant_a', {
        jsonrpc: '2.0',
        id: 15,
        method: 'tools/call',
        params: {
          name: 'get_review_conversation',
          arguments: { tenantId: 'clinic-demo-a', conversationId },
        },
      })
      expect(cleared.status).toBe(200)
      const clearedResult = cleared.json.result as {
        isError?: boolean
        structuredContent?: { error?: string; status?: number }
      }
      expect(clearedResult.isError).toBe(true)
      expect(clearedResult.structuredContent?.error).toBe('review_conversation_not_found')
      expect(clearedResult.structuredContent?.status).toBe(404)
    } finally {
      close()
    }
  })
})
