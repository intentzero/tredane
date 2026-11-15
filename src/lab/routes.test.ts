import { describe, expect, it, vi } from 'vitest'
import { clinicDurableObjectName } from '../clinic/demo/do-name'
import type { WorkerBindings } from '../worker/bindings'
import { createLabMcpRoutes } from './routes'

const PRINCIPAL = { clerkUserId: 'user_super', scope: ['lab:converse'] }

function envWith(stub: Record<string, unknown>, over: Partial<WorkerBindings> = {}): WorkerBindings {
  return {
    ENVIRONMENT: 'staging',
    LAB_ENABLED: 'true',
    OAUTH_KV: {},
    CLINIC: { idFromName: (n: string) => n, get: () => stub },
    ...over,
  } as unknown as WorkerBindings
}

async function post(env: WorkerBindings, body: unknown, token: string | null = 'good') {
  const app = createLabMcpRoutes({
    validate: async (_env, req) => (req.headers.get('Authorization') === 'Bearer good' ? PRINCIPAL : null),
  })
  return app.request(
    '/api/mcp/lab',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
    },
    env,
  )
}

const call = (name: string, args: unknown = {}) => ({
  jsonrpc: '2.0',
  id: 1,
  method: 'tools/call',
  params: { name, arguments: args },
})

describe('MCP de laboratório (DEC-186)', () => {
  it('fechado fora de staging, sem flag ou sem OAuth MCP: 404', async () => {
    for (const over of [{ ENVIRONMENT: 'production' }, { LAB_ENABLED: 'false' }, { OAUTH_KV: undefined }]) {
      const res = await post(envWith({}, over), call('lab_status'))
      expect(res.status).toBe(404)
    }
  })

  it('initialize e ping abertos sem token (paridade com Review MCP / Cursor OAuth)', async () => {
    const env = envWith({})
    const init = await post(
      env,
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-03-26',
          capabilities: {},
          clientInfo: { name: 'test', version: '0' },
        },
      },
      null,
    )
    expect(init.status).toBe(200)
    const initBody = (await init.json()) as { result?: { serverInfo?: { name?: string } } }
    expect(initBody.result?.serverInfo?.name).toBe('tredane-lab')
    expect((await post(env, { jsonrpc: '2.0', id: 2, method: 'ping' }, null)).status).toBe(200)
  })

  it('tools/list e tools/call sem token: 401 com o desafio do recurso; o DO nunca é chamado', async () => {
    const labTurn = vi.fn()
    const env = envWith({ labTurn })
    const list = await post(env, { jsonrpc: '2.0', id: 1, method: 'tools/list' }, null)
    expect(list.status).toBe(401)
    const wa = list.headers.get('WWW-Authenticate') ?? ''
    expect(wa).toContain('/.well-known/oauth-protected-resource/api/mcp/lab')
    expect(wa).toContain('scope="lab:converse"')
    expect((await post(env, call('lab_say', { text: 'oi' }), null)).status).toBe(401)
    const bad = await post(env, call('lab_say', { text: 'oi' }), 'outro')
    expect(bad.status).toBe(401)
    expect(bad.headers.get('WWW-Authenticate')).toContain('/.well-known/oauth-protected-resource/api/mcp/lab')
    expect(labTurn).not.toHaveBeenCalled()
  })

  it('lista as ferramentas e só estas', async () => {
    const res = await post(envWith({}), { jsonrpc: '2.0', id: 1, method: 'tools/list' })
    const body = (await res.json()) as { result: { tools: Array<{ name: string }> } }
    expect(body.result.tools.map((t) => t.name)).toEqual([
      'lab_status',
      'lab_say',
      'lab_tap',
      'lab_state',
      'lab_config_get',
      'lab_config_service',
      'lab_config_service_active',
      'lab_config_zones',
      'lab_config_resource',
      'lab_config_resource_active',
      'lab_config_windows',
      'lab_config_block',
      'lab_config_ai_assist',
    ])
  })

  it('lab_say fala sempre com o tenant demo, com o número fictício por defeito', async () => {
    const labTurn = vi.fn().mockResolvedValue({ messages: [], conversationId: 'c1' })
    const get = vi.fn().mockReturnValue({ labTurn })
    const env = { ...envWith({}), CLINIC: { idFromName: (n: string) => n, get } } as unknown as WorkerBindings
    const res = await post(env, call('lab_say', { text: 'Quero massagem amanhã' }))
    expect(res.status).toBe(200)
    // idFromName recebe a geração DO da demo (`:do-vN`); o tenantId lógico continua sem sufixo.
    expect(get).toHaveBeenCalledWith(clinicDurableObjectName('tenant_dec0de000000000000000001'))
    const [caller, input] = labTurn.mock.calls[0]!
    expect(caller.tenantId).toBe('tenant_dec0de000000000000000001')
    expect(input).toMatchObject({ waId: '550000000001', text: 'Quero massagem amanhã' })
  })

  it('recusa número real e entradas inválidas sem chamar o DO', async () => {
    const labTurn = vi.fn()
    const env = envWith({ labTurn })
    const real = (await (await post(env, call('lab_say', { text: 'oi', waId: '5511999990000' }))).json()) as {
      result: { isError?: boolean }
    }
    expect(real.result.isError).toBe(true)
    const empty = (await (await post(env, call('lab_say', { text: '   ' }))).json()) as { result: { isError?: boolean } }
    expect(empty.result.isError).toBe(true)
    expect(labTurn).not.toHaveBeenCalled()
  })

  it('lab_tap passa botão e título; o erro de orçamento chega ao agente', async () => {
    const labTurn = vi.fn().mockRejectedValue(Object.assign(new Error('Teto diário atingido'), { code: 'lab_budget_exhausted' }))
    const res = await post(envWith({ labTurn }), call('lab_tap', { buttonId: 'ch1~x', title: 'Costas', kind: 'list' }))
    const body = (await res.json()) as { result: { isError?: boolean; content: Array<{ text: string }> } }
    expect(labTurn.mock.calls[0]![1]).toMatchObject({ tap: { buttonId: 'ch1~x', title: 'Costas', kind: 'list' } })
    expect(body.result.isError).toBe(true)
    expect(body.result.content[0]!.text).toContain('Teto')
  })

  it('configuração: cada ferramenta vira uma operação da lista fechada, com o ator lab:<superadmin>', async () => {
    const labConfig = vi.fn().mockResolvedValue({ ok: true })
    const env = envWith({ labConfig })
    await post(env, call('lab_config_get'))
    await post(env, call('lab_config_service', { name: 'Massagem', durationMinutes: 60, bufferMinutes: 0, professionalIds: ['p1'] }))
    await post(env, call('lab_config_zones', {
      serviceId: 's1',
      zones: [{ name: 'Intima', audience: 'feminino', durationMinutes: 20, priceCents: 15000 }],
    }))
    await post(env, call('lab_config_resource', { kind: 'room', name: 'Sala 1' }))
    await post(env, call('lab_config_windows', { resourceId: 'r1', windows: [] }))
    await post(env, call('lab_config_block', { resourceId: 'r1', startsAt: 1, endsAt: 2, reason: 'x' }))
    await post(env, call('lab_config_service_active', { serviceId: 's1', active: false }))
    await post(env, call('lab_config_resource_active', { resourceId: 'r1', active: true }))
    await post(env, call('lab_config_ai_assist', { enabled: true }))
    expect(labConfig.mock.calls.map((c) => c[1])).toEqual([
      'get',
      'service',
      'zones',
      'resource',
      'windows',
      'block',
      'service_active',
      'resource_active',
      'ai_assist',
    ])
    expect(labConfig.mock.calls[0]![0].actorId).toBe('lab:user_super')
    expect(labConfig.mock.calls[1]![2]).toMatchObject({ name: 'Massagem', professionalIds: ['p1'] })
    expect(labConfig.mock.calls[2]![2]).toMatchObject({
      serviceId: 's1',
      zones: [{ name: 'Intima', audience: 'feminino' }],
    })
    expect(labConfig.mock.calls[8]![2]).toEqual({ enabled: true })
  })

  it('não há ferramenta para apagar', async () => {
    const labConfig = vi.fn()
    const res = await post(envWith({ labConfig }), call('lab_config_delete_service', { serviceId: 's1' }))
    const body = (await res.json()) as { result: { isError?: boolean } }
    expect(body.result.isError).toBe(true)
    expect(labConfig).not.toHaveBeenCalled()
  })

  it('metadados do recurso: audiência e escopo do laboratório (path insertion + append)', async () => {
    const app = createLabMcpRoutes()
    const env = envWith({})
    for (const path of [
      'https://staging.example.com/.well-known/oauth-protected-resource/api/mcp/lab',
      'https://staging.example.com/api/mcp/lab/.well-known/oauth-protected-resource',
    ]) {
      const res = await app.request(path, {}, env)
      const body = (await res.json()) as { resource: string; scopes_supported: string[] }
      expect(body.resource).toBe('https://staging.example.com/api/mcp/lab')
      expect(body.scopes_supported).toEqual(['lab:converse'])
    }
    const off = await app.request(
      '/.well-known/oauth-protected-resource/api/mcp/lab',
      {},
      envWith({}, { ENVIRONMENT: 'production' }),
    )
    expect(off.status).toBe(404)
  })
})
