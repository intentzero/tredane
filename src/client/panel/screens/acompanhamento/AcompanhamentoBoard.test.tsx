// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PanelApi } from '../../api'
import { AcompanhamentoBoard } from './AcompanhamentoBoard'

afterEach(cleanup)

describe('AcompanhamentoBoard (celular) — etapas finais', () => {
  it('pede as oportunidades encerradas só nas abas Concluído e Perdido', async () => {
    const list = vi.fn(async () => ({ opportunities: [], counts: [] }))
    const api = { listPipelineOpportunities: list } as unknown as PanelApi
    render(<AcompanhamentoBoard tenantId="t" api={api} generation={1} />)
    await waitFor(() => expect(list).toHaveBeenCalled())
    expect(list).toHaveBeenLastCalledWith(
      't',
      expect.objectContaining({ stage: 'em_atendimento', includeClosed: false }),
      expect.anything(),
    )
    const user = userEvent.setup()
    await user.click(await screen.findByRole('tab', { name: /Conclu/ }))
    await waitFor(() =>
      expect(list).toHaveBeenLastCalledWith(
        't',
        expect.objectContaining({ stage: 'concluido', includeClosed: true }),
        expect.anything(),
      ),
    )
  })
})
