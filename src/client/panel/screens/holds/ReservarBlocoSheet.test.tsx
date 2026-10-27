import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AvailabilitySlot, ClinicConfigSnapshot, PanelApi } from '../../api'
import { civilMinuteToEpoch } from './holdFormat'
import { ReservarBlocoSheet } from './ReservarBlocoSheet'

const TZ = 'America/Sao_Paulo'

function config(services: number): ClinicConfigSnapshot {
  return {
    settings: { tenantId: 't1', timezone: TZ, updatedAt: 1 },
    services: Array.from({ length: services }, (_, i) => ({
      id: `svc${i}`,
      name: `Procedimento ${i + 1}`,
      active: true,
      durationMinutes: 60,
      professionalIds: [],
    })),
    resources: [
      { id: 'pro1', kind: 'professional', name: 'Dra. Ana', category: null, active: true, futureAppointmentCount: 0, createdAt: 1, updatedAt: 1 },
    ],
  } as unknown as ClinicConfigSnapshot
}

function setup(opts: { services?: number; windowOpen?: boolean } = {}) {
  const onReserved = vi.fn()
  const createHold = vi.fn().mockResolvedValue({})
  const api = {
    getClinicConfig: vi.fn().mockResolvedValue(config(opts.services ?? 1)),
    queryAvailability: vi.fn().mockImplementation(async (_t: string, q: { date: string }) => {
      const startsAt = civilMinuteToEpoch(q.date, 9 * 60, TZ)
      const slot: AvailabilitySlot = {
        startsAt,
        endsAt: startsAt + 60 * 60_000,
        occupiesUntil: startsAt + 60 * 60_000,
        professionalId: 'pro1',
        professionalName: 'Dra. Ana',
        roomResourceId: null,
        roomResourceName: null,
      }
      return { slots: [slot] }
    }),
    createHold,
  } as unknown as PanelApi
  render(
    <ReservarBlocoSheet
      open
      tenantId="t1"
      api={api}
      generation={1}
      conversationId="c1"
      contactName="Maria Souza"
      windowOpen={opts.windowOpen ?? true}
      onClose={vi.fn()}
      onReserved={onReserved}
    />,
  )
  return { onReserved, createHold }
}

beforeEach(() => {
  // jsdom não tem scrollIntoView; a folha chama no timer depois de abrir (useVisualViewportSheet).
  Element.prototype.scrollIntoView = vi.fn()
  // 10h em São Paulo: o dia começa em hoje e o período em «Manhã».
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-27T13:00:00Z'))
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('ReservarBlocoSheet', () => {
  it('com um único procedimento mostra o resumo e deixa «Alterar» abrir os campos', async () => {
    setup()
    expect(await screen.findByText('Procedimento 1 · Dra. Ana')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Alterar' }))
    expect(screen.getByText('Procedimento')).toBeTruthy()
  })

  it('com vários procedimentos não escolhe nenhum sozinho', async () => {
    setup({ services: 2 })
    expect(await screen.findByText('Escolher procedimento')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Alterar' })).toBeNull()
  })

  it('o passo de 15 min só aparece depois de tocar em «Outra»', async () => {
    setup()
    await screen.findByText('Procedimento 1 · Dra. Ana')
    expect(screen.queryByRole('button', { name: 'Mais 15 minutos' })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Outra' }))
    expect(screen.getByRole('button', { name: 'Mais 15 minutos' })).toBeTruthy()
  })

  it('aviso à paciente vem ligado e envia o texto ao reservar', async () => {
    const { onReserved, createHold } = setup()
    const notify = await screen.findByRole('checkbox', { name: 'Avisar a paciente pelo WhatsApp' })
    expect((notify as HTMLInputElement).checked).toBe(true)
    await userEvent.click(await screen.findByRole('button', { name: /09:00 até 10:00/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Reservar horário' }))
    await waitFor(() => expect(createHold).toHaveBeenCalled())
    await waitFor(() => expect(onReserved).toHaveBeenCalled())
    expect(typeof onReserved.mock.calls[0]![0]).toBe('string')
  })

  it('com o aviso desligado reserva sem mensagem', async () => {
    const { onReserved, createHold } = setup()
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Avisar a paciente pelo WhatsApp' }))
    expect(screen.getByText('A paciente não será avisada. O horário fica só na agenda.')).toBeTruthy()
    await userEvent.click(await screen.findByRole('button', { name: /09:00 até 10:00/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Reservar horário' }))
    await waitFor(() => expect(createHold).toHaveBeenCalled())
    await waitFor(() => expect(onReserved).toHaveBeenCalledWith(null))
  })

  it('fora da janela de 24 h não oferece o aviso', async () => {
    setup({ windowOpen: false })
    await screen.findByText('Procedimento 1 · Dra. Ana')
    expect(screen.queryByRole('checkbox', { name: 'Avisar a paciente pelo WhatsApp' })).toBeNull()
  })
})
