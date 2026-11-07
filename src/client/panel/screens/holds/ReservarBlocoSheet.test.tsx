import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AvailabilitySlot, ClinicConfigSnapshot, PanelApi } from '../../api'
import { civilMinuteToEpoch } from './holdFormat'
import { ReservarBlocoSheet } from './ReservarBlocoSheet'

const TZ = 'America/Sao_Paulo'

function config(
  services: number,
  extras: {
    durationMinutes?: number
    withVariantService?: boolean
  } = {},
): ClinicConfigSnapshot {
  const durationMinutes = extras.durationMinutes ?? 60
  const list = Array.from({ length: services }, (_, i) => ({
    id: `svc${i}`,
    name: `Procedimento ${i + 1}`,
    active: true,
    durationMinutes,
    professionalIds: [] as string[],
  }))
  if (extras.withVariantService) {
    list.push({
      id: 'svc_zoned',
      name: 'Depilação',
      active: true,
      durationMinutes: 30,
      professionalIds: [],
      zones: [{ id: 'z1', name: 'Axila', audience: 'ambos', sortOrder: 0, active: true, durationMinutes: 10, priceCents: 5000 }],
    } as (typeof list)[number] & { zones: unknown[] })
  }
  return {
    settings: { tenantId: 't1', timezone: TZ, updatedAt: 1 },
    services: list,
    resources: [
      { id: 'pro1', kind: 'professional', name: 'Dra. Ana', category: null, active: true, futureAppointmentCount: 0, createdAt: 1, updatedAt: 1 },
    ],
  } as unknown as ClinicConfigSnapshot
}

function setup(
  opts: {
    services?: number
    windowOpen?: boolean
    durationMinutes?: number
    withVariantService?: boolean
    initialServiceId?: string
    initialProfessionalId?: string
    initialDate?: string
  } = {},
) {
  const onReserved = vi.fn()
  const createHold = vi.fn().mockResolvedValue({})
  const snap = config(opts.services ?? 1, {
    durationMinutes: opts.durationMinutes,
    withVariantService: opts.withVariantService,
  })
  const api = {
    getClinicConfig: vi.fn().mockResolvedValue(snap),
    queryAvailability: vi.fn().mockImplementation(async (_t: string, q: { date: string; durationMinutes?: number }) => {
      const mins = q.durationMinutes ?? 60
      const startsAt = civilMinuteToEpoch(q.date, 9 * 60, TZ)
      const slot: AvailabilitySlot = {
        startsAt,
        endsAt: startsAt + mins * 60_000,
        occupiesUntil: startsAt + mins * 60_000,
        professionalId: 'pro1',
        professionalName: 'Dra. Ana',
        roomResourceId: null,
        roomResourceName: null,
      }
      return { slots: [slot] }
    }),
    createHold,
  } as unknown as PanelApi
  const view = render(
    <ReservarBlocoSheet
      open
      tenantId="t1"
      api={api}
      generation={1}
      conversationId="c1"
      contactName="Maria Souza"
      windowOpen={opts.windowOpen ?? true}
      initialServiceId={opts.initialServiceId}
      initialProfessionalId={opts.initialProfessionalId}
      initialDate={opts.initialDate}
      onClose={vi.fn()}
      onReserved={onReserved}
    />,
  )
  return { onReserved, createHold, api, snap, rerender: view.rerender }
}

beforeEach(() => {
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
    expect(screen.getByText('Serviço')).toBeTruthy()
  })

  it('com vários procedimentos não escolhe nenhum sozinho', async () => {
    setup({ services: 2 })
    expect(await screen.findByText('Escolher serviço')).toBeTruthy()
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

  it('DEC-150: duração padrão é a do cadastro', async () => {
    setup({ durationMinutes: 45 })
    await screen.findByText('Procedimento 1 · Dra. Ana')
    expect(screen.getByRole('button', { name: '45 min' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: '1 h' }).getAttribute('aria-pressed')).toBe('false')
  })

  it('DEC-150: serviços com variantes saem da lista e o aviso aponta o Agendar', async () => {
    setup({ services: 1, withVariantService: true })
    await screen.findByText('Procedimento 1 · Dra. Ana')
    await userEvent.click(screen.getByRole('button', { name: 'Alterar' }))
    expect(screen.getByText(/Depilação tem opções com duração própria: marque um horário no Agendar/)).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Serviço' }))
    const sheet = await screen.findByRole('dialog', { name: 'Serviço' })
    expect(within(sheet).getByRole('option', { name: 'Procedimento 1' })).toBeTruthy()
    expect(within(sheet).queryByRole('option', { name: 'Depilação' })).toBeNull()
  })

  it('herda serviço do Agendar a cada abertura (sem ficar com o anterior)', async () => {
    const { api, rerender } = setup({
      services: 2,
      initialServiceId: 'svc1',
      initialProfessionalId: 'pro1',
      initialDate: '2026-10-28',
    })
    expect(await screen.findByText('Procedimento 2 · Dra. Ana')).toBeTruthy()

    rerender(
      <ReservarBlocoSheet
        open
        tenantId="t1"
        api={api}
        generation={1}
        conversationId="c1"
        contactName="Maria Souza"
        windowOpen
        initialServiceId="svc0"
        initialProfessionalId="pro1"
        initialDate="2026-10-27"
        onClose={vi.fn()}
        onReserved={vi.fn()}
      />,
    )
    expect(await screen.findByText('Procedimento 1 · Dra. Ana')).toBeTruthy()
  })
})
