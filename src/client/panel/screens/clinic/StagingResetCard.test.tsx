import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PanelApi } from '../../api'
import { describeResetResult, StagingResetCard } from './StagingResetCard'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('StagingResetCard — mensagens', () => {
  it('traduz respostas do servidor', () => {
    expect(describeResetResult(200, { ok: true, totalDeleted: 12 })).toContain('12 registros')
    expect(describeResetResult(404, { error: 'not_found' })).toContain('só staging')
    expect(describeResetResult(403, {})).toContain('dono')
    expect(describeResetResult(400, {})).toContain('Confirme')
  })
})

describe('StagingResetCard — UI', () => {
  function mockApi(
    reset: PanelApi['resetClinicOperationalData'] = vi.fn(async () => ({
      status: 200,
      body: { ok: true, totalDeleted: 12 },
    })),
  ): PanelApi {
    return { resetClinicOperationalData: reset } as unknown as PanelApi
  }

  it('só chama a API após Confirmar no modal', async () => {
    const user = userEvent.setup()
    const reset = vi.fn(async () => ({
      status: 200,
      body: { ok: true, totalDeleted: 12 },
    }))
    render(
      <StagingResetCard tenantId="clinic-demo-a" api={mockApi(reset)} generation={1} />,
    )
    await user.click(screen.getByRole('button', { name: /Apagar dados operacionais/i }))
    expect(screen.getByRole('alertdialog')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: /^Confirmar$/i }))
    expect(reset).toHaveBeenCalledWith(
      'clinic-demo-a',
      expect.objectContaining({ generation: 1 }),
    )
  })
})