/**
 * DEC-159 — MCP review-central: superadmin, cross-tenant, sem tenantId obrigatório.
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
import { upsertReviewSampleSync } from '../../review-samples'
import { REVIEW_CENTRAL_MCP_TOOLS } from './tools'

const FIXED_NOW = 1_700_000_200_000

function testMcpApp() {
  const admin = bootAdminDb({ seed: false })
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
    clockFactory: () => ({ nowMs: () => FIXED_NOW }),
  })
  return {
    app,
    admin,
    close: () => admin.close(),
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
      const res = await app.request('http://localhost/api/mcp/review-central', init)
      return { status: res.status, json: (await res.json()) as Record<string, unknown> }
    },
  }
}

function seedSamples(admin: ReturnType<typeof bootAdminDb>, now: number) {
  upsertReviewSampleSync(
    admin.db,
    {
      tenantId: 'ten_a',
      tenantName: 'Clínica A',
      conversationId: 'cnv_a',
      contactId: 'ct_a',
      contactWaId: '5511999990001',
      contactDisplayName: 'Ana',
      flagSource: 'auto',
      flagReason: 'nao_encontrei',
      flaggedAt: now - 1000,
      lastMessageAt: now - 500,
      lastMessagePreview: 'cotovelo',
      messages: [
        {
          messageId: 'm1',
          direction: 'inbound',
          body: 'quero cotovelo',
          createdAt: now - 800,
          deliveryState: null,
          authorClerkUserId: null,
          authorDisplayName: null,
        },
      ],
    },
    now,
  )
  upsertReviewSampleSync(
    admin.db,
    {
      tenantId: 'ten_b',
      tenantName: 'Clínica B',
      conversationId: 'cnv_b',
      contactId: 'ct_b',
      contactWaId: '5511999990002',
      contactDisplayName: 'Bruno',
      flagSource: 'client',
      flagReason: 'client_request',
      flaggedAt: now,
      lastMessageAt: now,
      lastMessagePreview: 'avaliar',
      messages: [
        {
          messageId: 'm2',
          direction: 'inbound',
          body: 'avaliar',
          createdAt: now,
          deliveryState: null,
          authorClerkUserId: null,
          authorDisplayName: null,
        },
      ],
    },
    now,
  )
}

describe('HTTP — MCP review-central (DEC-159)', () => {
  it('GET 405; initialize aberto; tools sem auth → 401; owner clínica → 403', async () => {
    const { app, mcp, close } = testMcpApp()
    try {
      const get = await app.request('http://localhost/api/mcp/review-central')
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
      const initResult = (init.json as { result?: { serverInfo?: { name?: string } } })
        .result
      expect(initResult?.serverInfo?.name).toBe('tredane-review-central')

      const list = await mcp(null, {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/list',
      })
      expect(list.status).toBe(401)

      const ownerDenied = await mcp('user_synth_owner_a', {
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/list',
      })
      expect(ownerDenied.status).toBe(403)
    } finally {
      close()
    }
  })

  it('superadmin lista samples de vários tenants sem tenantId; get + diagnosis', async () => {
    const { mcp, admin, close } = testMcpApp()
    try {
      seedSamples(admin, FIXED_NOW)

      const listed = await mcp('user_synth_superadmin', {
        jsonrpc: '2.0',
        id: 10,
        method: 'tools/call',
        params: { name: 'list_review_samples', arguments: {} },
      })
      expect(listed.status).toBe(200)
      const listPayload = listed.json as {
        result?: {
          structuredContent?: {
            samples?: Array<{ tenantId: string; id: string }>
          }
          content?: Array<{ text?: string }>
        }
      }
      const structured = listPayload.result?.structuredContent
      const samples =
        structured?.samples ??
        (JSON.parse(listPayload.result?.content?.[0]?.text ?? '{}') as {
          samples?: Array<{ tenantId: string; id: string }>
        }).samples
      expect(samples?.map((s) => s.tenantId).sort()).toEqual(['ten_a', 'ten_b'])

      const sampleId = samples![0]!.id
      const got = await mcp('user_synth_superadmin', {
        jsonrpc: '2.0',
        id: 11,
        method: 'tools/call',
        params: {
          name: 'get_review_sample',
          arguments: { sampleId },
        },
      })
      expect(got.status).toBe(200)
      const gotText = (got.json as { result?: { content?: Array<{ text?: string }> } })
        .result?.content?.[0]?.text
      expect(gotText).toContain('tenantId')

      const diag = await mcp('user_synth_superadmin', {
        jsonrpc: '2.0',
        id: 12,
        method: 'tools/call',
        params: {
          name: 'propose_review_diagnosis',
          arguments: { sampleId },
        },
      })
      expect(diag.status).toBe(200)
      const diagText = (
        diag.json as { result?: { content?: Array<{ text?: string }> } }
      ).result?.content?.[0]?.text
      expect(diagText).toContain('diagnosisGuidance')

      const toolNames = REVIEW_CENTRAL_MCP_TOOLS.map((t) => t.name)
      expect(toolNames).toEqual([
        'list_review_samples',
        'get_review_sample',
        'propose_review_diagnosis',
      ])
    } finally {
      close()
    }
  })
})
