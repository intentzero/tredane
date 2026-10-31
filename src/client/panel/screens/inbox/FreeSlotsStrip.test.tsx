import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AvailabilitySlot, PanelApi } from '../../api'
import { buildProposalText, FreeSlotsStrip } from './FreeSlotsStrip'

const TZ = 'America/Sao_Paulo'
// 2026-11-06 15:30 e 16:30 em São Paulo (UTC-3).
const t1530 = Date.UTC(2026, 10, 6, 18, 30)
const t1630 = Date.UTC(2026, 10, 6, 19, 30)

function slot(startsAt: number, extra: Partial<AvailabilitySlot> = {}): AvailabilitySlot {
  return {
    startsAt,
    endsAt: startsAt + 40 * 60_000,
    occupiesUntil: startsAt + 40 * 60_000,
    professionalId: 'p1',
    professionalName: 'Bruna',
    roomResourceId: null,
    roomResourceName: null,
    ...extra,
  }
}

describe('buildProposalText', () => {
  it('uma opção pergunta se serve', () => {
    expect(buildProposalText([{ date: '2026-11-06', slot: slot(t1530) }], TZ)).toBe(
      'Tenho sexta, 6 de novembro, às 15h30. Serve para você?',
    )
  })
  it('várias opções do mesmo dia juntam as horas', () => {
    const text = buildProposalText(
      [
        { date: '2026-11-06', slot: slot(t1530) },
        { date: '2026-11-06', slot: slot(t1630) },
      ],
      TZ,
    )
    expect(text).toBe('Tenho sexta, 6 de novembro, às 15h30 ou 16h30. Qual prefere?')
  })
})

describe('FreeSlotsStrip', () => {
  afterEach(cleanup)

  it('monta o rascunho sem enviar e ignora horário com aviso do bloco Tempo', async () => {
    const api = {
      getClinicConfig: vi.fn().mockResolvedValue({
        services: [{ id: 's1', name: 'Depilação a laser', active: true }],
        settings: { timezone: TZ },
      }),
      queryAvailability: vi.fn().mockResolvedValue({
        slots: [slot(t1530), slot(t1630, { tempoWarnings: ['Sem previsão'] })],
      }),
    } as unknown as PanelApi
    const onPropose = vi.fn()
    render(<FreeSlotsStrip tenantId="t" api={api} generation={1} onPropose={onPropose} />)

    expect(api.getClinicConfig).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: /Horários livres/ }))
    const first = await screen.findByRole('button', { name: /Bruna/ })
    expect(screen.getByRole('button', { name: /Use Agendar/ })).toHaveProperty('disabled', true)
    fireEvent.click(first)
    fireEvent.click(screen.getByRole('button', { name: /Colocar no campo/ }))
    await waitFor(() => expect(onPropose).toHaveBeenCalledTimes(1))
    expect(onPropose.mock.calls[0]![0]).toMatch(/às \d{2}h\d{2}\. Serve para você\?$/)
  })
})
