import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ClinicConfigSnapshot, ClinicService, PanelApi } from '../../api'
import { PanelApiError } from '../../api'
import { ServiceForm, ServicesList } from './ServicesScreen'

afterEach(cleanup)

function svc(over: Partial<ClinicService>): ClinicService {
  return {
    id: 'svc_1',
    name: 'Limpeza fictícia',
    durationMinutes: 60,
    bufferMinutes: 0,
    occupiedMinutes: 60,
    priceCents: null,
    clientExplanation: null,
    active: true,
    requiresSignal: false,
    signalKind: null,
    signalFixedCents: null,
    signalPercent: null,
    professionalIds: [],
    roomRequirement: { mode: 'none' },
    deletable: true,
    createdAt: 0,
    updatedAt: 0,
    ...over,
  }
}

function renderForm(service: ClinicService, api: Partial<PanelApi>) {
  const onSaved = vi.fn(async () => {})
  const snap = {
    settings: { tenantId: 't', timezone: 'America/Sao_Paulo', updatedAt: 0 },
    resources: [],
    services: [service],
    weeklyWindows: [],
    blocks: [],
  } as unknown as ClinicConfigSnapshot
  render(
    <ServiceForm tenantId="t" entityId={service.id} snap={snap} api={api as PanelApi} generation={1} onSaved={onSaved} />,
  )
  return { onSaved }
}

describe('ServiceForm — duração e variantes', () => {
  it('aceita um número de minutos fora da lista antiga', async () => {
    const upsertService = vi.fn(async () => svc({ durationMinutes: 7 }))
    renderForm(svc({}), { upsertService, replaceServiceZones: vi.fn() } as Partial<PanelApi>)
    const field = screen.getByRole('textbox', { name: 'Duração (min)' })
    fireEvent.change(field, { target: { value: '7' } })
    fireEvent.blur(field)
    fireEvent.click(screen.getByRole('button', { name: 'Salvar serviço' }))
    await waitFor(() =>
      expect(upsertService).toHaveBeenCalledWith(
        't',
        expect.objectContaining({ durationMinutes: 7 }),
        expect.anything(),
      ),
    )
  })

  it('ao tirar as variantes, apaga-as antes de limpar o tipo', async () => {
    const order: string[] = []
    const replaceServiceZones = vi.fn(async () => {
      order.push('zones')
      return svc({})
    })
    const upsertService = vi.fn(async () => {
      order.push('service')
      return svc({})
    })
    renderForm(
      svc({
        variantKind: 'Zona',
        zones: [
          {
            id: 'z1',
            name: 'Axila',
            durationMinutes: 15,
            priceCents: 5_000,
            audience: 'ambos',
            active: true,
            sortOrder: 0,
          },
        ],
      }),
      { upsertService, replaceServiceZones } as Partial<PanelApi>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Remover' }))
    fireEvent.click(screen.getByRole('button', { name: 'Salvar serviço' }))
    await waitFor(() => expect(order).toEqual(['zones', 'service']))
    expect(replaceServiceZones).toHaveBeenCalledWith('t', 'svc_1', [], expect.anything())
  })

  it('não grava variante sem nome', async () => {
    const upsertService = vi.fn()
    const replaceServiceZones = vi.fn()
    renderForm(svc({}), { upsertService, replaceServiceZones } as Partial<PanelApi>)
    fireEvent.change(screen.getByRole('textbox', { name: 'Singular' }), { target: { value: 'Zona' } })
    fireEvent.change(screen.getByRole('textbox', { name: 'Plural' }), { target: { value: 'Zonas' } })
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar variante' }))
    fireEvent.click(screen.getByRole('button', { name: 'Salvar serviço' }))
    expect(upsertService).not.toHaveBeenCalled()
    expect(replaceServiceZones).not.toHaveBeenCalled()
    expect(screen.getByText(/Dê um nome a cada variante/)).toBeTruthy()
  })

  it('se a primeira variante não grava, o tipo não fica sozinho', async () => {
    const upsertService = vi.fn(async () => svc({}))
    const replaceServiceZones = vi.fn(async () => {
      throw new Error('nome')
    })
    renderForm(svc({}), { upsertService, replaceServiceZones } as Partial<PanelApi>)
    fireEvent.change(screen.getByRole('textbox', { name: 'Singular' }), { target: { value: 'Zona' } })
    fireEvent.change(screen.getByRole('textbox', { name: 'Plural' }), { target: { value: 'Zonas' } })
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar variante' }))
    const names = screen.getAllByRole('textbox', { name: 'Nome' })
    fireEvent.change(names[1]!, { target: { value: 'Axila' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar serviço' }))
    await waitFor(() => expect(upsertService).toHaveBeenCalledTimes(2))
    const second = (upsertService.mock.calls as unknown[][])[1]
    expect(second?.[1]).toMatchObject({ variantKind: null, variantKindPlural: null })
    expect(screen.getByText(/nome/)).toBeTruthy()
  })
})

describe('ServiceForm — apagar serviço', () => {
  it('sem marcações: «Apagar serviço» abre confirmação e apaga', async () => {
    const deleteService = vi.fn(async () => ({ ok: true as const, id: 'svc_1' }))
    const { onSaved } = renderForm(svc({}), { deleteService } as Partial<PanelApi>)
    fireEvent.click(screen.getByRole('button', { name: 'Apagar serviço' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByText(/não pode ser desfeita/)).toBeTruthy()
    expect(deleteService).not.toHaveBeenCalled()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Apagar permanentemente' }))
    await waitFor(() => expect(deleteService).toHaveBeenCalledWith('t', 'svc_1', expect.anything()))
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
  })

  it('cancelar no diálogo não apaga', async () => {
    const deleteService = vi.fn()
    renderForm(svc({}), { deleteService } as Partial<PanelApi>)
    fireEvent.click(screen.getByRole('button', { name: 'Apagar serviço' }))
    const dialog = await screen.findByRole('alertdialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancelar' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    expect(deleteService).not.toHaveBeenCalled()
  })

  it('com marcações: sem botão, explica que basta desativar', () => {
    renderForm(svc({ deletable: false }), {})
    expect(screen.queryByRole('button', { name: 'Apagar serviço' })).toBeNull()
    expect(screen.getByText(/Basta desativá-lo/)).toBeTruthy()
  })

  it('409 do servidor aparece no diálogo', async () => {
    const deleteService = vi.fn(async () => {
      throw new PanelApiError(409, 'Não é possível apagar: este serviço já teve marcações. Desative-o.' as never)
    })
    renderForm(svc({}), { deleteService } as Partial<PanelApi>)
    fireEvent.click(screen.getByRole('button', { name: 'Apagar serviço' }))
    const dialog = await screen.findByRole('alertdialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Apagar permanentemente' }))
    await within(dialog).findByText(/já teve marcações/)
  })
})

describe('ServicesList — esqueleto comum e avisos', () => {
  const snap = {
    settings: { tenantId: 't', timezone: 'America/Sao_Paulo', updatedAt: 0 },
    resources: [
      { id: 'p1', kind: 'professional', name: 'Gi', category: null, active: true, futureAppointmentCount: 0, createdAt: 0, updatedAt: 0 },
    ],
    services: [
      svc({ id: 'a', name: 'Com profissional', professionalIds: ['p1'], bufferMinutes: 15, occupiedMinutes: 75 }),
      svc({ id: 'b', name: 'Sem ninguém', professionalIds: [] }),
      svc({ id: 'c', name: 'Antigo', active: false, professionalIds: ['p1'] }),
    ],
    weeklyWindows: [],
    blocks: [],
  } as unknown as ClinicConfigSnapshot

  it('mostra frase de ocupação, aviso só na exceção e esconde inativos até ligar a chave', () => {
    render(<ServicesList tenantId="t" snap={snap} />)
    expect(screen.getByText('Ocupa 75 min (60 + 15 de intervalo)')).toBeTruthy()
    expect(screen.getAllByText('Sem profissional')).toHaveLength(1)
    expect(screen.getByText('2 serviços ativos')).toBeTruthy()
    expect(screen.queryByText('Antigo')).toBeNull()
    fireEvent.click(screen.getByRole('switch', { name: 'Mostrar inativos (1)' }))
    expect(screen.getByText('Antigo')).toBeTruthy()
    expect(screen.getByText('Inativo')).toBeTruthy()
  })
})
