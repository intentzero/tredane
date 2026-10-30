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

function renderForm(
  service: ClinicService,
  api: Partial<PanelApi>,
  resources: ClinicConfigSnapshot['resources'] = [],
) {
  const onSaved = vi.fn(async () => {})
  const snap = {
    settings: { tenantId: 't', timezone: 'America/Sao_Paulo', updatedAt: 0 },
    resources,
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

  it('pede salas ou Sem espaço definido e grava as salas marcadas', async () => {
    const upsertService = vi.fn(async () => svc({}))
    const rooms: ClinicConfigSnapshot['resources'] = [
      {
        id: 'sala-b',
        kind: 'room',
        name: 'Sala B',
        category: null,
        active: true,
        futureAppointmentCount: 0,
        createdAt: 0,
        updatedAt: 0,
      },
      {
        id: 'sala-a',
        kind: 'room',
        name: 'Sala A',
        category: null,
        active: true,
        futureAppointmentCount: 0,
        createdAt: 0,
        updatedAt: 0,
      },
    ]
    renderForm(svc({ roomRequirement: { mode: 'none' } }), { upsertService }, rooms)
    const none = screen.getByRole('button', { name: 'Sem espaço definido' })
    expect(none.getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: 'Sala A' }))
    fireEvent.click(screen.getByRole('button', { name: 'Sala B' }))
    expect(screen.getByRole('button', { name: 'Sem espaço definido' }).getAttribute('aria-pressed')).toBe(
      'false',
    )
    fireEvent.click(screen.getByRole('button', { name: 'Salvar serviço' }))
    await waitFor(() =>
      expect(upsertService).toHaveBeenCalledWith(
        't',
        expect.objectContaining({
          roomRequirement: { mode: 'rooms', resourceIds: ['sala-a', 'sala-b'] },
        }),
        expect.anything(),
      ),
    )

    cleanup()
    const blocked = vi.fn()
    renderForm(svc({ roomRequirement: { mode: 'none' } }), { upsertService: blocked }, rooms)
    fireEvent.click(screen.getByRole('button', { name: 'Sem espaço definido' }))
    fireEvent.click(screen.getByRole('button', { name: 'Salvar serviço' }))
    expect(blocked).not.toHaveBeenCalled()
    expect(
      screen.getByText('Escolha uma ou mais salas, ou Sem espaço definido. O que você digitou continua aqui.'),
    ).toBeTruthy()
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
    fireEvent.click(screen.getByRole('radio', { name: 'Opção única' }))
    fireEvent.click(screen.getByRole('button', { name: 'Salvar serviço' }))
    await waitFor(() => expect(order).toEqual(['zones', 'service']))
    expect(replaceServiceZones).toHaveBeenCalledWith('t', 'svc_1', [], expect.anything())
  })

  it('não grava variante sem nome', async () => {
    const upsertService = vi.fn()
    const replaceServiceZones = vi.fn()
    renderForm(svc({}), { upsertService, replaceServiceZones } as Partial<PanelApi>)
    fireEvent.click(screen.getByRole('radio', { name: 'Com variantes' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Nome no singular' }), { target: { value: 'Zona' } })
    fireEvent.change(screen.getByRole('textbox', { name: 'Adicionar zona' }), { target: { value: 'Axila' } })
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar' }))
    const names = screen.getAllByRole('textbox', { name: /^Nome$/ })
    fireEvent.change(names[names.length - 1]!, { target: { value: '' } })
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
    fireEvent.click(screen.getByRole('radio', { name: 'Com variantes' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Nome no singular' }), { target: { value: 'Zona' } })
    fireEvent.change(screen.getByRole('textbox', { name: 'Adicionar zona' }), { target: { value: 'Axila' } })
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar' }))
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

describe('ServiceForm — catálogo de variantes', () => {
  const zone = (id: string, name: string, audience: 'ambos' | 'feminino' | 'masculino') => ({
    id,
    name,
    durationMinutes: 15,
    priceCents: 5000,
    audience,
    active: true,
    sortOrder: 0,
  })

  it('mostra singular e plural e grava o plural sugerido', async () => {
    const upsertService = vi.fn(async () => ({ id: 'svc_1' }))
    const replaceServiceZones = vi.fn(async () => [])
    renderForm(
      svc({ variantKind: 'Zona', zones: [zone('z1', 'Axila', 'ambos')] }),
      { upsertService, replaceServiceZones } as unknown as Partial<PanelApi>,
    )
    expect((screen.getByLabelText('Nome no singular') as HTMLInputElement).value).toBe('Zona')
    expect((screen.getByLabelText('No plural') as HTMLInputElement).value).toBe('Zonas')

    fireEvent.change(screen.getByLabelText('Nome no singular'), { target: { value: 'Sessão' } })
    expect((screen.getByLabelText('No plural') as HTMLInputElement).value).toBe('Sessões')

    fireEvent.click(screen.getByRole('button', { name: 'Salvar serviço' }))
    await waitFor(() => expect(upsertService).toHaveBeenCalled())
    const body = (upsertService.mock.calls[0] as unknown[])[1] as Record<string, unknown>
    expect(body.variantKind).toBe('Sessão')
    expect(body.variantKindPlural).toBe('Sessões')
  })

  it('avisa quando o serviço é masculino e há variante só feminina', () => {
    renderForm(
      svc({
        audiencia: 'masculino',
        variantKind: 'Zona',
        zones: [zone('z1', 'Buço', 'feminino')],
      }),
      {},
    )
    expect(screen.getByText(/só para feminino/).textContent).toMatch(/só para feminino/)
  })

  it('não grava opção única quando o formato é com variantes e não há linha', () => {
    const upsertService = vi.fn()
    renderForm(svc({}), { upsertService } as Partial<PanelApi>)
    fireEvent.click(screen.getByRole('radio', { name: 'Com variantes' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Nome no singular' }), {
      target: { value: 'Zona' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar serviço' }))
    expect(upsertService).not.toHaveBeenCalled()
    expect(screen.getByText(/Adicione ao menos uma variante/)).toBeTruthy()
  })

  it('com variantes, o sinal percentual usa a soma e não grava o preço da linha', async () => {
    const upsertService = vi.fn(async () => ({ id: 'svc_1' }))
    const replaceServiceZones = vi.fn(async () => [])
    renderForm(
      svc({
        priceCents: 10_000,
        requiresSignal: true,
        signalKind: 'percent',
        signalPercent: 30,
        variantKind: 'Zona',
        variantKindPlural: 'Zonas',
        zones: [zone('z1', 'Axila', 'ambos')],
      }),
      { upsertService, replaceServiceZones } as unknown as Partial<PanelApi>,
    )
    fireEvent.click(screen.getByRole('button', { name: /Sinal Pix/i }))
    const summary = screen.getByText(/30% de/).textContent ?? ''
    expect(summary).toMatch(/50,00/)
    expect(summary).not.toMatch(/100,00/)
    fireEvent.click(screen.getByRole('button', { name: 'Salvar serviço' }))
    await waitFor(() => expect(upsertService).toHaveBeenCalled())
    const body = (upsertService.mock.calls[0] as unknown[])[1] as Record<string, unknown>
    expect(body.priceCents).toBeNull()
    expect(body.signalPercent).toBe(30)
  })

  it('preço ilegível na linha recolhida aparece como sem preço', () => {
    renderForm(
      svc({ variantKind: 'Zona', zones: [zone('z1', 'Axila', 'ambos')] }),
      {},
    )
    fireEvent.click(screen.getByRole('button', { name: /Axila/ }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Preço' }), { target: { value: 'abc' } })
    fireEvent.click(screen.getByRole('button', { name: 'Pronto' }))
    expect(screen.getByText('Sem preço')).toBeTruthy()
  })

  it('opção única esconde o catálogo e mostra duração e preço', () => {
    renderForm(svc({}), {})
    expect(screen.queryByLabelText('Nome no singular')).toBeNull()
    expect(screen.getByText('Preço (opcional)')).toBeTruthy()
  })
})

describe('ServiceForm — combos de variantes (DEC-080)', () => {
  const zone = (id: string, name: string, priceCents: number, audience: 'ambos' | 'feminino' | 'masculino') => ({
    id,
    name,
    durationMinutes: 15,
    priceCents,
    audience,
    active: true,
    sortOrder: 0,
  })
  const base = () =>
    svc({
      variantKind: 'Zona',
      variantKindPlural: 'Zonas',
      zones: [
        zone('z1', 'Axila', 5000, 'ambos'),
        zone('z2', 'Buço', 3500, 'feminino'),
        zone('z3', 'Peitoral', 12000, 'masculino'),
      ],
      combos: [{ id: 'c1', name: 'Buço + axila', priceCents: 7000, zoneIds: ['z1', 'z2'], active: true, sortOrder: 0 }],
    })

  it('mostra o combo com a economia e grava o preço novo com as variantes', async () => {
    const upsertService = vi.fn(async () => ({ id: 'svc_1' }))
    const replaceServiceZones = vi.fn(async () => base())
    const replaceServiceCombos = vi.fn(async () => base())
    renderForm(base(), { upsertService, replaceServiceZones, replaceServiceCombos } as unknown as Partial<PanelApi>)

    expect(screen.getByText('Buço + axila')).toBeTruthy()
    expect(screen.getByText(/economia R\$\s?15,00/)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /Buço \+ axila/ }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Preço do combo' }), { target: { value: '6500' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar serviço' }))

    await waitFor(() => expect(replaceServiceCombos).toHaveBeenCalled())
    const sent = (replaceServiceCombos.mock.calls[0] as unknown[])[2] as Array<Record<string, unknown>>
    expect(sent).toMatchObject([{ id: 'c1', name: 'Buço + axila', priceCents: 650000, zoneIds: ['z1', 'z2'] }])
  })

  it('não deixa misturar masculino e feminino no mesmo combo', () => {
    renderForm(base(), {})
    fireEvent.click(screen.getByRole('button', { name: /Buço \+ axila/ }))
    const peitoral = screen.getByRole('button', { name: 'Peitoral' }) as HTMLButtonElement
    expect(peitoral.disabled).toBe(true)
  })

  it('avisa quando o combo não sai mais barato que a soma', () => {
    renderForm(base(), {})
    fireEvent.click(screen.getByRole('button', { name: /Buço \+ axila/ }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Preço do combo' }), { target: { value: '9000' } })
    expect(screen.getByText(/não sai mais barato/)).toBeTruthy()
  })

  it('combo sem nome ou preço não grava', async () => {
    const upsertService = vi.fn()
    renderForm(base(), { upsertService } as unknown as Partial<PanelApi>)
    fireEvent.click(screen.getByRole('button', { name: /Buço \+ axila/ }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Nome do combo' }), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar serviço' }))
    expect(upsertService).not.toHaveBeenCalled()
    expect(screen.getByText(/Dê nome e preço a cada combo/)).toBeTruthy()
  })
})
