import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PanelApi } from '../../api'
import {
  describeClearAppointmentsResult,
  StagingClearAppointmentsCard,
} from './StagingClearAppointmentsCard'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('StagingClearAppointmentsCard — mensagens', () => {
  it('traduz respostas do servidor', () => {
    expect(
      describeClearAppointmentsResult(200, {
        ok: true,
        totalDeleted: 5,
        deletedCounts: { appointments: 2 },
      }),
    ).toContain('2 compromisso')
    expect(describeClearAppointmentsResult(404, { error: 'not_found' })).toContain('só staging')
    expect(describeClearAppointmentsResult(403, {})).toContain('dono')
    expect(describeClearAppointmentsResult(400, {})).toContain('nome')
  })
})

describe('StagingClearAppointmentsCard — UI', () => {
  function mockApi(
    clear: PanelApi['clearClinicAppointments'] = vi.fn(async () => ({
      status: 200,
      body: { ok: true, totalDeleted: 3, deletedCounts: { appointments: 3 } },
    })),
  ): PanelApi {
    return { clearClinicAppointments: clear } as unknown as PanelApi
  }

  it('exige o nome exato e chama a API', async () => {
    const user = userEvent.setup()
    const clear = vi.fn(async () => ({
      status: 200,
      body: { ok: true, totalDeleted: 3, deletedCounts: { appointments: 3 } },
    }))
    render(
      <StagingClearAppointmentsCard
        tenantId="clinic-demo-a"
        clinicName="Clínica Demo"
        api={mockApi(clear)}
        generation={1}
      />,
    )
    const btn = screen.getByRole('button', { name: /Apagar todos os compromissos/i })
    expect(btn.hasAttribute('disabled') || btn.getAttribute('data-disabled') === 'true').toBe(true)
    await user.type(screen.getByLabelText(/Nome da clínica para limpar agenda/i), 'Clínica Demo')
    expect(btn.hasAttribute('disabled') || btn.getAttribute('data-disabled') === 'true').toBe(false)
    await user.click(btn)
    expect(clear).toHaveBeenCalledWith(
      'clinic-demo-a',
      'Clínica Demo',
      expect.objectContaining({ generation: 1 }),
    )
    expect((await screen.findByRole('status')).textContent ?? '').toMatch(/3 compromisso/)
  })
})
