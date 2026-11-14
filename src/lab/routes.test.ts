import { describe, expect, it, vi } from 'vitest'
import type { WorkerBindings } from '../worker/bindings'
import { createLabMcpRoutes } from './routes'

const TOKEN = 'y'.repeat(32)

function envWith(stub: Record<string, unknown>, over: Partial<WorkerBindings> = {}): WorkerBindings {
  return {
    ENVIRONMENT: 'staging',
    LAB_ENABLED: 'true',
    LAB_TOKEN: TOKEN,
    CLINIC: { idFromName: (n: string) => n, get: () => stub },
    ...over,
  } as unknown as WorkerBindings
}

async function post(env: WorkerBindings, body: unknown, token: string | null = TOKEN) {
  const app = createLabMcpRoutes()
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

describe('MCP de laboratório (DEC-182)', () => {
  it('fechado fora de staging, sem flag ou sem secret: 404', async () => {
    for (const over of [{ ENVIRONMENT: 'production' }, { LAB_ENABLED: 'false' }, { LAB_TOKEN: undefined }]) {
      const res = await post(envWith({}, over), call('lab_status'))
      expect(res.status).toBe(404)
    }
  })

  it('sem Bearer correto: 401 e o DO nunca é chamado', async () => {
    const labTurn = vi.fn()
    const env = envWith({ labTurn })
    expect((await post(env, call('lab_say', { text: 'oi' }), null)).status).toBe(401)
    expect((await post(env, call('lab_say', { text: 'oi' }), 'z'.repeat(32))).status).toBe(401)
    expect(labTurn).not.toHaveBeenCalled()
  })

  it('lista as ferramentas e só estas', async () => {
    const res = await post(envWith({}), { jsonrpc: '2.0', id: 1, method: 'tools/list' })
    const body = (await res.json()) as { result: { tools: Array<{ name: string }> } }
    expect(body.result.tools.map((t) => t.name)).toEqual(['lab_status', 'lab_say', 'lab_tap', 'lab_state'])
  })

  it('lab_say fala sempre com o tenant demo, com o número fictício por defeito', async () => {
    const labTurn = vi.fn().mockResolvedValue({ messages: [], conversationId: 'c1' })
    const get = vi.fn().mockReturnValue({ labTurn })
    const env = { ...envWith({}), CLINIC: { idFromName: (n: string) => n, get } } as unknown as WorkerBindings
    const res = await post(env, call('lab_say', { text: 'Quero massagem amanhã' }))
    expect(res.status).toBe(200)
    expect(get).toHaveBeenCalledWith('tenant_dec0de000000000000000001')
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
})
