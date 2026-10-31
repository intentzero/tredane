import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AvailabilitySlot, PanelApi } from '../../api'
import { buildProposalText, dateForDayLabel, FreeSlotsStrip } from './FreeSlotsStrip'

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
      getPix: vi.fn().mockRejectedValue(new Error('sem pix')),
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

  it('cobra o sinal só depois de confirmar, com uma chave de idempotência', async () => {
    const createPixCharge = vi.fn().mockResolvedValue({ whatsappSendError: null })
    const api = {
      getClinicConfig: vi.fn().mockResolvedValue({
        services: [
          {
            id: 's1',
            name: 'Depilação a laser',
            active: true,
            requiresSignal: true,
            signalKind: 'fixed',
            signalFixedCents: 5000,
            priceCents: 18000,
            zones: [],
          },
        ],
        settings: { timezone: TZ },
      }),
      queryAvailability: vi.fn().mockResolvedValue({ slots: [slot(t1530)] }),
      getPix: vi.fn().mockResolvedValue({ account: { canCreateCharge: true } }),
      createPixCharge,
    } as unknown as PanelApi
    render(
      <FreeSlotsStrip
        tenantId="t"
        api={api}
        generation={1}
        conversationId="c1"
        contactId="k1"
        onPropose={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /Horários livres/ }))
    fireEvent.click(await screen.findByRole('button', { name: /Bruna/ }))
    fireEvent.click(await screen.findByRole('button', { name: /Cobrar sinal/ }))
    expect(createPixCharge).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: /Enviar sinal de/ }))
    await waitFor(() => expect(createPixCharge).toHaveBeenCalledTimes(1))
    const body = createPixCharge.mock.calls[0]![1]
    expect(body).toMatchObject({ conversationId: 'c1', serviceId: 's1', startsAt: t1530 })
    expect(typeof body.clientRequestId).toBe('string')
  })

  it('fixada na coluna: já aberta, sem Fechar, e continua aberta depois de propor', async () => {
    const api = {
      getClinicConfig: vi.fn().mockResolvedValue({
        services: [{ id: 's1', name: 'Depilação a laser', active: true }],
        settings: { timezone: TZ },
      }),
      queryAvailability: vi.fn().mockResolvedValue({ slots: [slot(t1530)] }),
      getPix: vi.fn().mockRejectedValue(new Error('sem pix')),
    } as unknown as PanelApi
    const onPropose = vi.fn()
    render(<FreeSlotsStrip pinned tenantId="t" api={api} generation={1} onPropose={onPropose} />)
    expect(screen.queryByRole('button', { name: 'Fechar' })).toBeNull()
    fireEvent.click(await screen.findByRole('button', { name: /Bruna/ }))
    fireEvent.click(screen.getByRole('button', { name: /Colocar no campo/ }))
    await waitFor(() => expect(onPropose).toHaveBeenCalledTimes(1))
    expect(screen.getByRole('region', { name: 'Horários livres' })).toBeTruthy()
  })

  it('abre no procedimento e no período que a conversa já definiu', async () => {
    const queryAvailability = vi.fn().mockResolvedValue({
      slots: [slot(Date.UTC(2026, 10, 6, 13, 0)), slot(t1530)],
    })
    const api = {
      getClinicConfig: vi.fn().mockResolvedValue({
        services: [
          { id: 's1', name: 'Limpeza de pele', active: true },
          { id: 's2', name: 'Depilação a laser', active: true },
        ],
        settings: { timezone: TZ },
      }),
      queryAvailability,
      getPix: vi.fn().mockRejectedValue(new Error('sem pix')),
    } as unknown as PanelApi
    render(
      <FreeSlotsStrip
        pinned
        tenantId="t"
        api={api}
        generation={1}
        onPropose={vi.fn()}
        hint={{ serviceId: 's2', dayLabel: null, period: 'tarde' }}
      />,
    )
    await waitFor(() => expect(queryAvailability).toHaveBeenCalled())
    expect(queryAvailability.mock.calls[0]![1]).toMatchObject({ serviceId: 's2' })
    // 10h (manhã) sai; 15h30 (tarde) fica.
    expect(await screen.findAllByRole('button', { name: /Bruna/ })).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: /Pedido: tarde/ }))
    expect(await screen.findAllByRole('button', { name: /Bruna/ })).toHaveLength(2)
  })
})

describe('dateForDayLabel', () => {
  // quinta, 5 de novembro de 2026, 12h em São Paulo
  const now = Date.UTC(2026, 10, 5, 15, 0)
  it('traduz hoje, amanhã e dia da semana', () => {
    expect(dateForDayLabel('hoje', TZ, now)).toBe('2026-11-05')
    expect(dateForDayLabel('amanhã', TZ, now)).toBe('2026-11-06')
    expect(dateForDayLabel('sexta', TZ, now)).toBe('2026-11-06')
    expect(dateForDayLabel('sábado', TZ, now)).toBe('2026-11-07')
    expect(dateForDayLabel(null, TZ, now)).toBeNull()
  })
})
