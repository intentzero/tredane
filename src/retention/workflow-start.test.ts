import { describe, expect, it, vi } from 'vitest'
import {
  startTenantPurgeWorkflow,
  type TenantPurgeWorkflowBinding,
} from './workflow-start'
import { tenantPurgeWorkflowInstanceId } from './workflow-params'

describe('startTenantPurgeWorkflow', () => {
  const params = {
    tenantId: 'clinic-demo-a',
    commandId: 'tdel_abc123',
    actorClerkUserId: 'user_synth_superadmin',
  }

  it('no-op sem binding (CI/synthetic)', async () => {
    const result = await startTenantPurgeWorkflow(undefined, params)
    expect(result).toEqual({ started: false, reason: 'binding_unavailable' })
  })

  it('cria instância com id estável', async () => {
    const create = vi.fn(async ({ id }: { id?: string }) => ({ id: id! }))
    const binding: TenantPurgeWorkflowBinding = {
      create,
      get: vi.fn(),
    }
    const result = await startTenantPurgeWorkflow(binding, params)
    expect(result).toEqual({
      started: true,
      instanceId: tenantPurgeWorkflowInstanceId(params.commandId),
      reused: false,
    })
    expect(create).toHaveBeenCalledWith({
      id: tenantPurgeWorkflowInstanceId(params.commandId),
      params,
    })
  })

  it('reutiliza instância existente (anti-replay)', async () => {
    const instanceId = tenantPurgeWorkflowInstanceId(params.commandId)
    const binding: TenantPurgeWorkflowBinding = {
      create: vi.fn(async () => {
        throw new Error('instance already exists')
      }),
      get: vi.fn(async () => ({
        id: instanceId,
        status: async () => ({ status: 'running' }),
      })),
    }
    const result = await startTenantPurgeWorkflow(binding, params)
    expect(result).toEqual({
      started: true,
      instanceId,
      reused: true,
    })
  })
})
