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
    expect(describeClearAppointmentsResult(400, {})).toContain('Confirme')
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

  it('abre o modal, exige Confirmar e chama a API', async () => {
    const user = userEvent.setup()
    const clear = vi.fn(async () => ({
      status: 200,
      body: { ok: true, totalDeleted: 3, deletedCounts: { appointments: 3 } },
    }))
    render(
      <StagingClearAppointmentsCard
        tenantId="clinic-demo-a"
        api={mockApi(clear)}
        generation={1}
      />,
    )
    const openBtn = screen.getByRole('button', { name: /Apagar todos os compromissos/i })
    await user.click(openBtn)
    expect(screen.getByRole('alertdialog', { name: 'Limpar agenda?' })).toBeTruthy()
    expect(screen.getByText(/Agendado que tinha marcação volta a Em atendimento/i)).toBeTruthy()
    expect(screen.queryByLabelText(/nome da clínica/i)).toBeNull()
    const confirmBtn = screen.getByRole('button', { name: /^Confirmar$/i })
    await user.click(confirmBtn)
    expect(clear).toHaveBeenCalledWith(
      'clinic-demo-a',
      expect.objectContaining({ generation: 1 }),
    )
    expect((await screen.findByRole('status')).textContent ?? '').toMatch(/3 compromisso/)
  })
})