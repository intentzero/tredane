import { describe, expect, it, vi } from 'vitest'
import { createPanelApi, PanelApiError } from './api'

describe('isolamento por geração de tenant (#22 / AC-17)', () => {
  it('descarta resposta tardia quando a geração mudou', async () => {
    let generation = 1
    const fetchMock = vi.fn(async () => {
      generation = 2
      return new Response(
        JSON.stringify({
          tenants: [{ tenantId: 'clinic-demo-a', name: 'A', role: 'owner', status: 'active' }],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    })
    vi.stubGlobal('fetch', fetchMock)

    const api = createPanelApi(async () => 'synth:user_synth_multi')
    await expect(
      api.listTenants({
        generation: 1,
        expectGeneration: () => generation,
      }),
    ).rejects.toMatchObject({ message: 'stale_tenant_response' } satisfies Partial<PanelApiError>)

    vi.unstubAllGlobals()
  })

  it('aceita resposta da geração vigente', async () => {
    const generation = 3
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            tenants: [
              {
                tenantId: 'clinic-demo-b',
                name: 'Estúdio Horizonte (fictício)',
                role: 'attendant',
                status: 'active',
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      ),
    )

    const api = createPanelApi(async () => 'synth:user_synth_multi')
    const tenants = await api.listTenants({
      generation,
      expectGeneration: () => generation,
    })
    expect(tenants).toEqual([
      {
        tenantId: 'clinic-demo-b',
        name: 'Estúdio Horizonte (fictício)',
        role: 'attendant',
        status: 'active',
      },
    ])
    vi.unstubAllGlobals()
  })
})
