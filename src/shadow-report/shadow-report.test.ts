/**
 * TEMPORÁRIO: armazenamento, resumo e ferramenta MCP do relatório da sombra do interpretador.
 * Remover com a funcionalidade (hipotese-compreensao-llm-primeiro.md §5.3d).
 */
import { describe, expect, it, vi } from 'vitest'
import { asyncFromSync } from '../db/admin/async-store'
import { bootAdminDb } from '../db/test-db'
import { createApp } from '../worker/app'
import {
  createSyntheticAuthorityReader,
  createSyntheticSessionAuthenticator,
  synthAuthHeader,
  type AuthServices,
} from '../auth'
import type { InterpreterShadowEvent } from '../clinic/ai/interpreter-shadow'
import {
  insertInterpreterShadowEvent,
  listInterpreterShadowEvents,
  SHADOW_EVENT_TTL_MS,
  SHADOW_REPORT_ROW_LIMIT,
} from './store'
import { summariseShadowRows } from './summary'

const NOW = 1_700_000_000_000
const NONE = { service: 'none', variants: 'none', line: 'none', professional: 'none', date: 'none', period: 'none', time: 'none', option: 'none' } as const

function event(over: Partial<InterpreterShadowEvent> = {}): InterpreterShadowEvent {
  return {
    level: 'info',
    event: 'ai.interpreter_shadow',
    tenantId: 'ten_a',
    conversationId: 'cnv_1',
    messageId: 'msg_1',
    status: 'ok',
    mainModelCalled: false,
    reusedMainCall: false,
    pendingSlot: null,
    ruleCoverage: 0.3,
    ruleActs: ['marcar'],
    llmActs: ['marcar'],
    fields: { ...NONE, service: 'agree', period: 'llm_only' },
    diverged: true,
    llmOnly: ['period'],
    differ: [],
    variantCount: { rule: 0, llm: 0 },
    strictDiscarded: ['period'],
    relaxedRejected: [],
    model: 'claude-haiku-5-5',
    latencyMs: 1000,
    inputTokens: 1000,
    outputTokens: 100,
    ...over,
  }
}

describe('armazenamento da sombra (D1 central, temporário)', () => {
  it('grava, é idempotente por turno e guarda só ids e veredictos', async () => {
    const admin = bootAdminDb({ seed: false })
    try {
      const db = asyncFromSync(admin.db)
      await insertInterpreterShadowEvent(db, event(), NOW)
      await insertInterpreterShadowEvent(db, event(), NOW + 5) // mesmo turno: ignorado
      await insertInterpreterShadowEvent(db, event({ messageId: 'msg_2' }), NOW)
      const rows = await listInterpreterShadowEvents(db, { sinceMs: NOW - 1000 })
      expect(rows).toHaveLength(2)
      const cols = Object.keys(rows[0]!).join(',')
      expect(cols).not.toMatch(/body|text|texto|message_text/i)
      expect(rows[0]!.expires_at - rows[0]!.occurred_at).toBe(SHADOW_EVENT_TTL_MS)
    } finally {
      admin.close()
    }
  })

  it('apaga os expirados ao gravar e filtra por janela e tenant', async () => {
    const admin = bootAdminDb({ seed: false })
    try {
      const db = asyncFromSync(admin.db)
      await insertInterpreterShadowEvent(db, event({ messageId: 'velho' }), NOW)
      const later = NOW + SHADOW_EVENT_TTL_MS + 1000
      await insertInterpreterShadowEvent(db, event({ messageId: 'novo', tenantId: 'ten_b' }), later)
      const all = await listInterpreterShadowEvents(db, { sinceMs: 0 })
      expect(all.map((r) => r.message_id)).toEqual(['novo'])
      expect(await listInterpreterShadowEvents(db, { sinceMs: 0, tenantId: 'ten_a' })).toHaveLength(0)
      expect(await listInterpreterShadowEvents(db, { sinceMs: later + 1 })).toHaveLength(0)
    } finally {
      admin.close()
    }
  })

  it('falha de escrita nunca lança e avisa uma vez (sem silêncio)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const broken = { run: async () => { throw new Error('d1 em baixo') }, get: async () => undefined, all: async () => [] }
      await expect(insertInterpreterShadowEvent(broken as never, event(), NOW)).resolves.toBeUndefined()
      expect(warn).toHaveBeenCalledTimes(1)
      const line = String(warn.mock.calls[0]![0])
      const parsed = JSON.parse(line) as {
        event: string
        tenantId: string
        conversationId: string
        messageId: string
        error: string
      }
      expect(parsed.event).toBe('ai.interpreter_shadow_sink_failed')
      expect(parsed.tenantId).toBe('ten_a')
      expect(parsed.conversationId).toBe('cnv_1')
      expect(parsed.messageId).toBe('msg_1')
      expect(parsed.error).toMatch(/d1 em baixo/)
      expect(line).not.toMatch(/body|text|phone|Massagem/i)
    } finally {
      warn.mockRestore()
    }
  })
})

describe('summariseShadowRows', () => {
  it('conta veredictos, validação, custo (sem a chamada reutilizada) e amostra', async () => {
    const admin = bootAdminDb({ seed: false })
    try {
      const db = asyncFromSync(admin.db)
      await insertInterpreterShadowEvent(db, event(), NOW)
      await insertInterpreterShadowEvent(
        db,
        event({ messageId: 'm2', fields: { ...NONE, line: 'differ' }, llmOnly: [], differ: ['line'], strictDiscarded: [], relaxedRejected: ['date'] }),
        NOW,
      )
      await insertInterpreterShadowEvent(db, event({ messageId: 'm3', status: 'provider', fields: undefined, diverged: undefined }), NOW)
      await insertInterpreterShadowEvent(db, event({ messageId: 'm4', reusedMainCall: true, mainModelCalled: true, latencyMs: 300 }), NOW)
      const rows = await listInterpreterShadowEvents(db, { sinceMs: 0 })
      const s = summariseShadowRows(rows, { sample: 5 })
      expect(s.total).toBe(4)
      expect(s.byStatus).toEqual({ ok: 3, provider: 1 })
      expect(s.compared).toBe(3)
      expect(s.fields.period.llm_only).toBe(2)
      expect(s.fields.line.differ).toBe(1)
      expect(s.strictDiscarded).toEqual({ period: 2 })
      expect(s.relaxedRejected).toEqual({ date: 1 })
      expect(s.tokens.input).toBe(3000)
      expect(s.samples.differ).toEqual([{ tenantId: 'ten_a', conversationId: 'cnv_1', messageId: 'm2', fields: ['line'] }])
      expect(summariseShadowRows(rows).samples.differ).toEqual([])
    } finally {
      admin.close()
    }
  })
})

describe('get_interpreter_shadow_report (MCP, só superadmin)', () => {
  function appWithStore() {
    const admin = bootAdminDb({ seed: false })
    const services: AuthServices = {
      sessions: createSyntheticSessionAuthenticator({ authorizedParties: ['http://localhost:5173'] }),
      authority: createSyntheticAuthorityReader(),
      adminDb: asyncFromSync(admin.db),
    }
    const app = createApp({
      authServicesFactory: () => services,
      syncAdminDbFactory: () => admin.db,
      clockFactory: () => ({ nowMs: () => NOW + 1000 }),
    })
    const call = async (userId: string, args: Record<string, unknown>) => {
      const res = await app.request('http://localhost/api/mcp/review-central', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: synthAuthHeader(userId) },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'get_interpreter_shadow_report', arguments: args } }),
      })
      return { status: res.status, json: (await res.json()) as { result?: { content: Array<{ text: string }>; isError?: boolean } } }
    }
    return { admin, call }
  }

  it('devolve o resumo agregado ao superadmin e recusa a quem não é', async () => {
    const { admin, call } = appWithStore()
    try {
      await insertInterpreterShadowEvent(asyncFromSync(admin.db), event(), NOW)
      const denied = await call('user_synth_owner_a', {})
      expect(denied.status).toBe(403)
      const ok = await call('user_synth_superadmin', { sample: 3 })
      expect(ok.status).toBe(200)
      const body = JSON.parse(ok.json.result!.content[0]!.text) as { temporary: boolean; summary: { total: number; fields: { period: { llm_only: number } } }; window: { sinceHours: number } }
      expect(body.temporary).toBe(true)
      expect(body.window.sinceHours).toBe(24)
      expect(body.summary.total).toBe(1)
      expect(body.summary.fields.period.llm_only).toBe(1)
      expect(ok.json.result!.content[0]!.text).not.toMatch(/"body"|"text"/)
    } finally {
      admin.close()
    }
  })

  it('limita a janela a 1–168 h e respeita o filtro de tenant', async () => {
    const { admin, call } = appWithStore()
    try {
      const db = asyncFromSync(admin.db)
      await insertInterpreterShadowEvent(db, event(), NOW)
      await insertInterpreterShadowEvent(db, event({ tenantId: 'ten_b', messageId: 'x' }), NOW)
      const r = await call('user_synth_superadmin', { sinceHours: 9999, tenantId: 'ten_b' })
      const body = JSON.parse(r.json.result!.content[0]!.text) as { window: { sinceHours: number; tenantId: string }; summary: { total: number } }
      expect(body.window.sinceHours).toBe(168)
      expect(body.window.tenantId).toBe('ten_b')
      expect(body.summary.total).toBe(1)
    } finally {
      admin.close()
    }
  })

  it('marca truncated só quando há mais de 5000 linhas (pede limit+1)', async () => {
    const { admin, call } = appWithStore()
    try {
      const db = asyncFromSync(admin.db)
      for (let i = 0; i < SHADOW_REPORT_ROW_LIMIT; i++) {
        await insertInterpreterShadowEvent(db, event({ messageId: `m_${i}` }), NOW)
      }
      const exact = await call('user_synth_superadmin', {})
      const exactBody = JSON.parse(exact.json.result!.content[0]!.text) as {
        truncated: boolean
        summary: { total: number }
      }
      expect(exactBody.truncated).toBe(false)
      expect(exactBody.summary.total).toBe(SHADOW_REPORT_ROW_LIMIT)

      await insertInterpreterShadowEvent(db, event({ messageId: 'm_over' }), NOW)
      const over = await call('user_synth_superadmin', {})
      const overBody = JSON.parse(over.json.result!.content[0]!.text) as {
        truncated: boolean
        summary: { total: number }
      }
      expect(overBody.truncated).toBe(true)
      expect(overBody.summary.total).toBe(SHADOW_REPORT_ROW_LIMIT)
    } finally {
      admin.close()
    }
  })
})
