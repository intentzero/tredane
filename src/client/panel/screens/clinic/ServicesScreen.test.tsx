import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ClinicConfigSnapshot, ClinicService, PanelApi } from '../../api'
import { PanelApiError } from '../../api'
import { navigatePanel } from '../../routes'
import { ClinicPanel } from './ClinicPanel'
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
    fireEvent.click(screen.getByRole('radio', { name: /Só um/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Salvar serviço' }))
    await waitFor(() => expect(order).toEqual(['zones', 'service']))
    expect(replaceServiceZones).toHaveBeenCalledWith('t', 'svc_1', [], expect.anything())
  })

  it('não grava variante sem nome', async () => {
    const upsertService = vi.fn()
    const replaceServiceZones = vi.fn()
    renderForm(svc({}), { upsertService, replaceServiceZones } as Partial<PanelApi>)
    fireEvent.click(screen.getByRole('radio', { name: /Várias juntas/ }))
    fireEvent.change(screen.getByRole('textbox', { name: /nome no singular/ }), { target: { value: 'Zona' } })
    fireEvent.change(screen.getByRole('textbox', { name: 'Adicionar zona' }), { target: { value: 'Axila' } })
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar' }))
    fireEvent.click(screen.getByRole('button', { name: /Axila/ }))
    const names = screen.getAllByRole('textbox', { name: /^Nome$/ })
    fireEvent.change(names[names.length - 1]!, { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'Aplicar' }))
    // DEC-176: a folha não aplica um nome vazio; a ficha fica como estava.
    expect(screen.getByText(/Dê um nome a esta zona/)).toBeTruthy()
    expect(upsertService).not.toHaveBeenCalled()
    expect(replaceServiceZones).not.toHaveBeenCalled()
  })

  it('se a primeira variante não grava, o tipo não fica sozinho', async () => {
    const upsertService = vi.fn(async () => svc({}))
    const replaceServiceZones = vi.fn(async () => {
      throw new Error('nome')
    })
    renderForm(svc({}), { upsertService, replaceServiceZones } as Partial<PanelApi>)
    fireEvent.click(screen.getByRole('radio', { name: /Várias juntas/ }))
    fireEvent.change(screen.getByRole('textbox', { name: /nome no singular/ }), { target: { value: 'Zona' } })
    fireEvent.change(screen.getByRole('textbox', { name: 'Adicionar zona' }), { target: { value: 'Axila' } })
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar' }))
    fireEvent.click(screen.getByRole('button', { name: 'Salvar serviço' }))
    await waitFor(() => expect(upsertService).toHaveBeenCalledTimes(2))
    const second = (upsertService.mock.calls as unknown[][])[1]
    expect(second?.[1]).toMatchObject({ variantKind: null, variantKindPlural: null })
    expect(screen.getByRole('alert')).toBeTruthy()
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

  it('mostra duração em linha, aviso só na exceção e esconde inativos até ligar a chave', () => {
    render(<ServicesList tenantId="t" snap={snap} />)
    // DEC-163: duração, profissional e sala numa linha; o preço vai à direita do nome.
    expect(screen.getByText('60 min + 15 de intervalo · Gi')).toBeTruthy()
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

  it('grava variantSelection=uma ao escolher «Escolhe uma opção»', async () => {
    const upsertService = vi.fn(async () =>
      svc({
        variantKind: 'Tipo',
        variantKindPlural: 'Tipos',
        variantSelection: 'uma',
        zones: [zone('z1', 'Relaxante', 'ambos')],
      }),
    )
    const replaceServiceZones = vi.fn(async () =>
      svc({
        variantKind: 'Tipo',
        variantKindPlural: 'Tipos',
        variantSelection: 'uma',
        zones: [zone('z1', 'Relaxante', 'ambos')],
      }),
    )
    renderForm(
      svc({
        variantKind: 'Tipo',
        variantKindPlural: 'Tipos',
        variantSelection: 'varias',
        zones: [zone('z1', 'Relaxante', 'ambos')],
      }),
      { upsertService, replaceServiceZones } as unknown as Partial<PanelApi>,
    )
    fireEvent.click(screen.getByRole('radio', { name: /Uma opção/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Salvar serviço' }))
    await waitFor(() => expect(upsertService).toHaveBeenCalled())
    const body = (upsertService.mock.calls[0] as unknown[])[1] as Record<string, unknown>
    expect(body.variantSelection).toBe('uma')
  })

  it('reabre com «Escolhe uma opção» quando o serviço já está em uma', () => {
    renderForm(
      svc({
        variantKind: 'Tipo',
        variantKindPlural: 'Tipos',
        variantSelection: 'uma',
        zones: [zone('z1', 'Relaxante', 'ambos')],
      }),
      {},
    )
    // Modo uma: catálogo de variantes visível; combos (só em varias) ocultos.
    expect(screen.getByLabelText(/nome no singular/)).toBeTruthy()
    expect(screen.getByText('Relaxante')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Adicionar combo/i })).toBeNull()
    expect(screen.queryByText(/economia R\$/)).toBeNull()
  })

  it('mostra o erro DEC-149 quando a API recusa varias→uma com combos', async () => {
    const upsertService = vi.fn(async () => {
      throw new PanelApiError(
        400,
        'unknown',
        'Desative o combo «Buço + axila» antes de mudar para uma variante por atendimento.',
      )
    })
    renderForm(
      svc({
        variantKind: 'Zona',
        variantKindPlural: 'Zonas',
        variantSelection: 'varias',
        zones: [
          zone('z1', 'Axila', 'ambos'),
          zone('z2', 'Buço', 'feminino'),
        ],
        combos: [
          {
            id: 'c1',
            name: 'Buço + axila',
            priceCents: 7000,
            zoneIds: ['z1', 'z2'],
            active: true,
            sortOrder: 0,
          },
        ],
      }),
      { upsertService } as unknown as Partial<PanelApi>,
    )
    fireEvent.click(screen.getByRole('radio', { name: /Uma opção/ }))
    expect(screen.getByText(/ainda tem combo ativo/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Salvar serviço' }))
    await waitFor(() =>
      expect(screen.getByText(/Desative o combo «Buço \+ axila»/)).toBeTruthy(),
    )
    expect(screen.getByText(/continua aqui/)).toBeTruthy()
  })

  it('mostra singular e plural e grava o plural sugerido', async () => {
    const upsertService = vi.fn(async () => ({ id: 'svc_1' }))
    const replaceServiceZones = vi.fn(async () => [])
    renderForm(
      svc({ variantKind: 'Zona', zones: [zone('z1', 'Axila', 'ambos')] }),
      { upsertService, replaceServiceZones } as unknown as Partial<PanelApi>,
    )
    expect((screen.getByLabelText(/nome no singular/) as HTMLInputElement).value).toBe('Zona')
    expect((screen.getByLabelText(/nome no plural/) as HTMLInputElement).value).toBe('Zonas')

    fireEvent.change(screen.getByLabelText(/nome no singular/), { target: { value: 'Sessão' } })
    expect((screen.getByLabelText(/nome no plural/) as HTMLInputElement).value).toBe('Sessões')

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
    fireEvent.click(screen.getByRole('radio', { name: /Várias juntas/ }))
    fireEvent.change(screen.getByRole('textbox', { name: /nome no singular/ }), {
      target: { value: 'Zona' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar serviço' }))
    expect(upsertService).not.toHaveBeenCalled()
    expect(screen.getByText(/Adicione ao menos uma opção/)).toBeTruthy()
  })

  it('com variantes e sinal, grava preço da linha null e preserva o espelho do sinal (DEC-180)', async () => {
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
    // DEC-180: UI de sinal por serviço some; nota aponta para Recebimento.
    expect(screen.queryByRole('button', { name: /Sinal Pix/i })).toBeNull()
    expect(screen.getByText(/Sinal activo nesta clínica/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Salvar serviço' }))
    await waitFor(() => expect(upsertService).toHaveBeenCalled())
    const body = (upsertService.mock.calls[0] as unknown[])[1] as Record<string, unknown>
    expect(body.priceCents).toBeNull()
    expect(body.requiresSignal).toBe(true)
    expect(body.signalPercent).toBe(30)
  })

  it('preço ilegível na linha recolhida aparece como sem preço', () => {
    renderForm(
      svc({ variantKind: 'Zona', zones: [zone('z1', 'Axila', 'ambos')] }),
      {},
    )
    fireEvent.click(screen.getByRole('button', { name: /Axila/ }))
    fireEvent.change(screen.getByRole('textbox', { name: /^Preço/ }), { target: { value: 'abc' } })
    fireEvent.click(screen.getByRole('button', { name: 'Aplicar' }))
    expect(screen.getByText('15 min · sem preço')).toBeTruthy()
  })

  it('opção única esconde o catálogo e mostra duração e preço', () => {
    renderForm(svc({}), {})
    expect(screen.queryByLabelText(/nome no singular/)).toBeNull()
    expect(screen.getByText('Preço (opcional)')).toBeTruthy()
  })
})

describe('ServiceForm — alterações não salvas', () => {
  const here = '/c/t/clinica/servicos/svc_1'

  function atService() {
    window.history.replaceState(null, '', here)
  }

  function addZone(name: string) {
    fireEvent.click(screen.getByRole('radio', { name: /Várias juntas/ }))
    fireEvent.change(screen.getByRole('textbox', { name: /nome no singular/ }), {
      target: { value: 'Zona' },
    })
    fireEvent.change(screen.getByRole('textbox', { name: 'Adicionar zona' }), {
      target: { value: name },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar' }))
  }

  it('variante nova bloqueia a saída; continuar fica; sair sem salvar deixa', () => {
    atService()
    renderForm(svc({}), {})
    addZone('Axila')

    fireEvent.click(screen.getByRole('button', { name: 'Voltar' }))
    const dialog = screen.getByRole('dialog', { name: 'Alterações não salvas' })
    expect(within(dialog).getByRole('button', { name: 'Continuar editando' })).toBeTruthy()
    expect(within(dialog).getByRole('button', { name: 'Sair sem salvar' })).toBeTruthy()
    expect(within(dialog).queryByRole('button', { name: 'Gravar' })).toBeNull()
    expect(window.location.pathname).toBe(here)

    fireEvent.click(within(dialog).getByRole('button', { name: 'Continuar editando' }))
    expect(screen.queryByRole('dialog', { name: 'Alterações não salvas' })).toBeNull()
    expect(screen.getByText('Axila')).toBeTruthy()
    expect(window.location.pathname).toBe(here)

    act(() => {
      navigatePanel({ kind: 'area', area: 'agenda', tenantId: 't', section: 'dia' })
    })
    expect(screen.getByRole('dialog', { name: 'Alterações não salvas' })).toBeTruthy()
    expect(window.location.pathname).toBe(here)

    fireEvent.click(screen.getByRole('button', { name: 'Sair sem salvar' }))
    expect(screen.queryByRole('dialog', { name: 'Alterações não salvas' })).toBeNull()
    expect(window.location.pathname).toBe('/c/t/agenda')
  })

  it('variante removida e ainda não salva também bloqueia', () => {
    atService()
    renderForm(
      svc({
        variantKind: 'Zona',
        variantKindPlural: 'Zonas',
        zones: [
          {
            id: 'z1',
            name: 'Axila',
            durationMinutes: 15,
            priceCents: 5000,
            audience: 'ambos',
            active: true,
            sortOrder: 0,
          },
        ],
      }),
      {},
    )
    fireEvent.click(screen.getByRole('button', { name: /Axila/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Remover zona…' }))
    fireEvent.click(screen.getByRole('button', { name: 'Remover zona' }))
    act(() => {
      navigatePanel({
        kind: 'area',
        area: 'clinica',
        tenantId: 't',
        section: 'servico',
        entityId: 'outro',
      })
    })
    expect(screen.getByRole('dialog', { name: 'Alterações não salvas' })).toBeTruthy()
    expect(window.location.pathname).toBe(here)
    expect(screen.queryByRole('button', { name: /Axila/ })).toBeNull()
  })

  it('formulário limpo sai sem diálogo', () => {
    atService()
    renderForm(svc({}), {})
    fireEvent.click(screen.getByRole('button', { name: 'Voltar' }))
    expect(screen.queryByRole('dialog', { name: 'Alterações não salvas' })).toBeNull()
    expect(window.location.pathname).toBe('/c/t/clinica/servicos')

    cleanup()
    atService()
    renderForm(svc({}), {})
    act(() => {
      navigatePanel({ kind: 'area', area: 'agenda', tenantId: 't', section: 'dia' })
    })
    expect(screen.queryByRole('dialog', { name: 'Alterações não salvas' })).toBeNull()
    expect(window.location.pathname).toBe('/c/t/agenda')
  })

  it('fechar o painel com alterações pergunta e continuar mantém a ficha', () => {
    atService()
    render(
      <ClinicPanel
        title="Serviço"
        onClose={() =>
          navigatePanel({ kind: 'area', area: 'clinica', tenantId: 't', section: 'servicos' })
        }
      >
        <ServiceForm
          tenantId="t"
          entityId="svc_1"
          snap={
            {
              settings: { tenantId: 't', timezone: 'America/Sao_Paulo', updatedAt: 0 },
              resources: [],
              services: [svc({})],
              weeklyWindows: [],
              blocks: [],
            } as unknown as ClinicConfigSnapshot
          }
          api={{} as PanelApi}
          generation={1}
          onSaved={async () => {}}
        />
      </ClinicPanel>,
    )
    fireEvent.change(screen.getByRole('textbox', { name: 'Nome no catálogo' }), { target: { value: 'Com rascunho' } })
    fireEvent.click(screen.getByRole('button', { name: 'Fechar serviço' }))
    expect(screen.queryByRole('alertdialog')).toBeNull()
    const dialog = screen.getByRole('dialog', { name: 'Alterações não salvas' })
    expect(window.location.pathname).toBe(here)
    fireEvent.click(within(dialog).getByRole('button', { name: 'Continuar editando' }))
    expect((screen.getByRole('textbox', { name: 'Nome no catálogo' }) as HTMLInputElement).value).toBe('Com rascunho')
    expect(window.location.pathname).toBe(here)
    fireEvent.click(screen.getByRole('button', { name: 'Fechar serviço' }))
    fireEvent.click(screen.getByRole('button', { name: 'Sair sem salvar' }))
    expect(window.location.pathname).toBe('/c/t/clinica/servicos')
  })

  it('salvar com sucesso sai sem o diálogo', async () => {
    atService()
    const upsertService = vi.fn(async () => svc({ name: 'Novo nome' }))
    renderForm(svc({}), { upsertService, replaceServiceZones: vi.fn() } as Partial<PanelApi>)
    fireEvent.change(screen.getByRole('textbox', { name: 'Nome no catálogo' }), { target: { value: 'Novo nome' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar serviço' }))
    await waitFor(() => expect(upsertService).toHaveBeenCalled())
    expect(screen.queryByRole('dialog', { name: 'Alterações não salvas' })).toBeNull()
    expect(window.location.pathname).toBe('/c/t/clinica/servicos')
  })

  it('o voltar do navegador com a ficha suja pergunta e continuar fica', () => {
    atService()
    renderForm(svc({}), {})
    act(() => {
      navigatePanel({
        kind: 'area',
        area: 'clinica',
        tenantId: 't',
        section: 'servico',
        entityId: 'svc_1',
      })
    })
    fireEvent.change(screen.getByRole('textbox', { name: 'Nome no catálogo' }), { target: { value: 'Rascunho' } })
    act(() => {
      window.history.pushState(null, '', '/c/t/agenda')
      window.dispatchEvent(new PopStateEvent('popstate'))
    })
    expect(screen.getByRole('dialog', { name: 'Alterações não salvas' })).toBeTruthy()
    expect(window.location.pathname).toBe(here)
    fireEvent.click(screen.getByRole('button', { name: 'Continuar editando' }))
    expect(window.location.pathname).toBe(here)
    expect((screen.getByRole('textbox', { name: 'Nome no catálogo' }) as HTMLInputElement).value).toBe('Rascunho')
    act(() => {
      window.history.pushState(null, '', '/c/t/agenda')
      window.dispatchEvent(new PopStateEvent('popstate'))
    })
    fireEvent.click(screen.getByRole('button', { name: 'Sair sem salvar' }))
    expect(window.location.pathname).toBe('/c/t/agenda')
  })

  it('pede confirmação do navegador só com a ficha suja', () => {
    atService()
    renderForm(svc({}), {})
    const clean = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(clean)
    expect(clean.defaultPrevented).toBe(false)

    fireEvent.change(screen.getByRole('textbox', { name: 'Nome no catálogo' }), { target: { value: 'Rascunho' } })
    const dirty = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(dirty)
    expect(dirty.defaultPrevented).toBe(true)
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

describe('ServiceForm — variantes: folha, lote e prontidão', () => {
  function withTwoZones() {
    return svc({
      variantKind: 'Zona',
      variantKindPlural: 'Zonas',
      zones: [
        { id: 'z1', name: 'Axila', durationMinutes: 15, priceCents: 5_000, audience: 'ambos', active: true, sortOrder: 0 },
        { id: 'z2', name: 'Buço', durationMinutes: 15, priceCents: 5_000, audience: 'ambos', active: true, sortOrder: 1 },
      ],
    })
  }

  it('resume durações e preços iguais e aplica «Mudar todos…»', () => {
    renderForm(withTwoZones(), {})
    expect(screen.getByText(/Todas com/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Mudar todos…' }))
    const all = screen.getByRole('textbox', { name: 'Duração de todas (min)' })
    fireEvent.change(all, { target: { value: '30' } })
    fireEvent.blur(all)
    fireEvent.click(screen.getByRole('button', { name: 'Aplicar a todas' }))
    expect(screen.getAllByText(/^30 min/).length).toBeGreaterThanOrEqual(2)
  })

  it('a duração aparece uma vez na folha e só entra com «Aplicar»', () => {
    renderForm(withTwoZones(), {})
    fireEvent.click(screen.getByRole('button', { name: /Axila/ }))
    expect(screen.queryByRole('button', { name: '45 min' })).toBeNull()
    const minutes = screen.getByRole('textbox', { name: /^Minutos/ })
    fireEvent.change(minutes, { target: { value: '45' } })
    fireEvent.blur(minutes)
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(screen.queryByText(/^45 min/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Axila/ }))
    const again = screen.getByRole('textbox', { name: /^Minutos/ })
    fireEvent.change(again, { target: { value: '45' } })
    fireEvent.blur(again)
    fireEvent.click(screen.getByRole('button', { name: 'Aplicar' }))
    expect(screen.getByText(/^45 min/)).toBeTruthy()
    expect(screen.getByText('Alterações por salvar')).toBeTruthy()
  })

  it('«Pronto para atender» avisa opção sem preço', () => {
    const f = withTwoZones()
    f.zones![0]!.priceCents = null
    renderForm(f, {})
    expect(screen.getByText(/1 opção sem preço/)).toBeTruthy()
  })

  it('«Pronto para atender» marca preço opcional na linha sem inventar sucesso', () => {
    renderForm(svc({ priceCents: null, roomRequirement: { mode: 'none' } }), {})
    expect(screen.getByText('Preço em aberto (opcional).')).toBeTruthy()
    expect(screen.queryByText('Preço e duração definidos.')).toBeNull()
  })

  it('«Pronto para atender» avisa preço em falta com sinal percentual', () => {
    renderForm(
      svc({
        priceCents: null,
        requiresSignal: true,
        signalKind: 'percent',
        signalPercent: 30,
        roomRequirement: { mode: 'none' },
      }),
      {},
    )
    expect(screen.getByText('Falta o preço para o sinal percentual.')).toBeTruthy()
    expect(screen.queryByText('Preço e duração definidos.')).toBeNull()
    expect(screen.queryByText('Preço em aberto (opcional).')).toBeNull()
  })

  it('«Pronto para atender» confirma preço e duração quando a linha tem preço', () => {
    renderForm(svc({ priceCents: 12_000, roomRequirement: { mode: 'none' } }), {})
    expect(screen.getByText('Preço e duração definidos.')).toBeTruthy()
  })
})

describe('ServiceForm — layout do painel (overflow horizontal)', () => {
  it('CSS do corpo do painel/folha e dos cartões de formato evita rolagem horizontal', () => {
    const css = readFileSync(join(__dirname, '../../../ui/panel.css'), 'utf8')
    expect(css).toMatch(
      /\.clinic-panel-body\s*\{[^}]*overflow-x:\s*clip[^}]*overflow-y:\s*auto/s,
    )
    expect(css).toMatch(
      /\.clinic-sheet-body\s*\{[^}]*overflow-x:\s*clip[^}]*overflow-y:\s*auto/s,
    )
    expect(css).toMatch(/\.clinic-footer-sticky\s*\{[^}]*margin:\s*0;/s)
    expect(css).not.toMatch(
      /\.clinic-footer-sticky\s*\{[^}]*margin:\s*0\s+calc\(var\(--space-4\)\s*\*\s*-1\)/s,
    )
    // M-64 Opção A: teclado aberto (data-keyboard=open) esconde o rodapé sticky.
    expect(css).toMatch(
      /:root\[data-keyboard=['"]open['"]\]\s*\.clinic-footer-sticky\s*\{[^}]*display:\s*none/s,
    )
    expect(css).toMatch(/\.svc-format-item\s*\{[^}]*position:\s*relative/s)
    expect(css).toMatch(/\.svc-format-item\s*\{[^}]*min-width:\s*0/s)
  })

  it('mostra o título e os três cartões de formato sem cortar o texto', () => {
    renderForm(
      svc({
        name: 'Massagem',
        variantKind: 'Tipo',
        variantKindPlural: 'Tipos',
        variantSelection: 'uma',
        zones: [
          {
            id: 'z1',
            name: 'Relaxante',
            durationMinutes: 60,
            priceCents: 18_000,
            audience: 'ambos',
            active: true,
            sortOrder: 0,
          },
        ],
      }),
      {},
    )
    expect(screen.getByRole('heading', { name: 'Como a cliente escolhe' }).textContent).toBe(
      'Como a cliente escolhe',
    )
    const group = screen.getByRole('radiogroup', { name: 'Como a cliente escolhe' })
    const copy = group.textContent ?? ''
    expect(copy).toContain('Só um')
    expect(copy).toContain('Uma opção')
    expect(copy).toContain('Várias juntas')
    expect(copy).not.toMatch(/\bno a cliente escolhe\b/)
    const uma = within(group).getByRole('radio', { name: /Uma opção/ }) as HTMLInputElement
    expect(uma.checked).toBe(true)
  })
})

describe('ServiceForm — opções agrupadas e palavras (DEC-176)', () => {
  const z = (
    id: string,
    name: string,
    audience: 'ambos' | 'feminino' | 'masculino',
    over: Partial<{ durationMinutes: number; priceCents: number | null; synonyms: string[] }> = {},
  ) => ({
    id,
    name,
    durationMinutes: 10,
    priceCents: 5_000,
    audience,
    active: true,
    sortOrder: 0,
    synonyms: [] as string[],
    ...over,
  })

  function depilacao(over: Partial<ClinicService> = {}) {
    return svc({
      name: 'Depilação',
      bufferMinutes: 15,
      variantKind: 'Zona',
      variantKindPlural: 'Zonas',
      variantSelection: 'varias',
      zones: [
        z('z1', 'Axila', 'feminino', { synonyms: ['sovaco'] }),
        z('z2', 'Axila', 'masculino', { priceCents: 6_000, synonyms: ['sovaco'] }),
        z('z3', 'Pernas', 'feminino', { durationMinutes: 20, priceCents: 12_000 }),
      ],
      ...over,
    })
  }

  it('mostra uma linha por nome, com tempo e preço de cada público e os sinônimos', () => {
    renderForm(depilacao(), {})
    const list = screen.getByRole('list', { name: 'Zonas' })
    expect(within(list).getAllByRole('listitem')).toHaveLength(2)
    expect(screen.getByText('Fem. 10 min · R$ 50,00; Masc. 10 min · R$ 60,00')).toBeTruthy()
    expect(screen.getByText('Só fem. 20 min · R$ 120,00')).toBeTruthy()
    expect(screen.getByText('Também: sovaco')).toBeTruthy()
    expect(screen.getByText('Sem sinônimos')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Zonas · 2' })).toBeTruthy()
  })

  it('sinônimos e nome da opção gravam em todas as variantes do grupo', async () => {
    const upsertService = vi.fn(async () => depilacao())
    const replaceServiceZones = vi.fn(async () => depilacao())
    renderForm(depilacao(), { upsertService, replaceServiceZones } as unknown as Partial<PanelApi>)
    fireEvent.click(screen.getByRole('button', { name: 'Editar Axila' }))
    const sheetField = screen.getAllByRole('textbox', { name: 'Também chamam de' }).at(-1)!
    fireEvent.change(sheetField, { target: { value: 'axilas' } })
    fireEvent.keyDown(sheetField, { key: 'Enter' })
    fireEvent.click(screen.getByRole('button', { name: 'Aplicar' }))
    fireEvent.click(screen.getByRole('button', { name: 'Salvar serviço' }))
    await waitFor(() => expect(replaceServiceZones).toHaveBeenCalled())
    const sent = (replaceServiceZones.mock.calls[0] as unknown[])[2] as Array<Record<string, unknown>>
    expect(sent.slice(0, 2)).toMatchObject([
      { id: 'z1', name: 'Axila', audience: 'feminino', synonyms: ['sovaco', 'axilas'] },
      { id: 'z2', name: 'Axila', audience: 'masculino', synonyms: ['sovaco', 'axilas'] },
    ])
  })

  it('desmarcar um público gravado deixa a variante inativa; marcar cria a que falta', async () => {
    const upsertService = vi.fn(async () => depilacao())
    const replaceServiceZones = vi.fn(async () => depilacao())
    renderForm(depilacao(), { upsertService, replaceServiceZones } as unknown as Partial<PanelApi>)
    fireEvent.click(screen.getByRole('button', { name: 'Editar Axila' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Masculino' }))
    fireEvent.click(screen.getByRole('button', { name: 'Aplicar' }))
    fireEvent.click(screen.getByRole('button', { name: 'Editar Pernas' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Masculino' }))
    fireEvent.click(screen.getByRole('button', { name: 'Aplicar' }))
    fireEvent.click(screen.getByRole('button', { name: 'Salvar serviço' }))
    await waitFor(() => expect(replaceServiceZones).toHaveBeenCalled())
    const sent = (replaceServiceZones.mock.calls[0] as unknown[])[2] as Array<Record<string, unknown>>
    expect(sent).toHaveLength(4)
    expect(sent[1]).toMatchObject({ id: 'z2', active: false })
    expect(sent[3]).toMatchObject({ id: undefined, name: 'Pernas', audience: 'masculino', durationMinutes: 20 })
  })

  it('não deixa adicionar um nome que já está na lista', () => {
    renderForm(depilacao(), {})
    fireEvent.change(screen.getByRole('textbox', { name: 'Adicionar zona' }), { target: { value: 'axila' } })
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar' }))
    expect(screen.getByText(/«Axila» já está na lista/)).toBeTruthy()
    expect(within(screen.getByRole('list', { name: 'Zonas' })).getAllByRole('listitem')).toHaveLength(2)
  })

  it('avisa quando singular e plural são iguais e corrige com um toque', () => {
    renderForm(depilacao({ variantKind: 'Zonas', variantKindPlural: 'Zonas' }), {})
    expect(screen.getByText(/«Zonas» nos dois dá «1 zonas»/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Usar «Zona»' }))
    expect((screen.getByLabelText(/nome no singular/) as HTMLInputElement).value).toBe('Zona')
    expect(screen.queryByText(/nos dois dá/)).toBeNull()
  })

  it('público em conflito: aviso junto de «Para quem» e «Usar «Qualquer»» grava qualquer', async () => {
    const upsertService = vi.fn(async () => depilacao())
    const replaceServiceZones = vi.fn(async () => depilacao())
    renderForm(depilacao({ audiencia: 'masculino' }), {
      upsertService,
      replaceServiceZones,
    } as unknown as Partial<PanelApi>)
    expect(screen.getByText(/2 zonas são só para feminino/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Usar «Qualquer»' }))
    expect(screen.queryByText(/só para feminino/)).toBeNull()
    const qualquer = within(screen.getByRole('radiogroup', { name: 'Para quem' })).getByRole('radio', {
      name: 'Qualquer',
    }) as HTMLInputElement
    expect(qualquer.checked).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Salvar serviço' }))
    await waitFor(() => expect(upsertService).toHaveBeenCalled())
    expect((upsertService.mock.calls[0] as unknown[])[1]).toMatchObject({ audiencia: 'qualquer' })
  })

  it('«Como fica na agenda» soma as opções escolhidas, não a duração da linha', () => {
    renderForm(depilacao(), {})
    const hint = screen.getByRole('status', { name: 'Como fica na agenda' }).textContent ?? ''
    expect(hint).toContain('Ocupa a soma das zonas escolhidas + 15 min de intervalo, uma vez')
    expect(hint).toContain('Ex.: Axila + Pernas = 45 min')
    expect(hint).not.toContain('75')

    cleanup()
    renderForm(depilacao({ variantSelection: 'uma' }), {})
    const uma = screen.getByRole('status', { name: 'Como fica na agenda' }).textContent ?? ''
    expect(uma).toContain('Ocupa o tempo da zona escolhida + 15 min de intervalo. Ex.: Axila = 25 min')
    expect(screen.getByText('A cliente escolhe uma por visita.')).toBeTruthy()
    expect(screen.queryByText(/não se mistura feminino com masculino/)).toBeNull()
  })

  it('recusa um sinônimo que já está noutro serviço antes de gravar', () => {
    const snap = {
      settings: { tenantId: 't', timezone: 'America/Sao_Paulo', updatedAt: 0 },
      resources: [],
      services: [
        depilacao(),
        svc({
          id: 'svc_2',
          name: 'Massagem',
          variantKind: 'Tipo',
          variantKindPlural: 'Tipos',
          zones: [z('m1', 'Relaxante', 'ambos', { synonyms: ['pernas cansadas'] })],
        }),
      ],
      weeklyWindows: [],
      blocks: [],
    } as unknown as ClinicConfigSnapshot
    render(
      <ServiceForm tenantId="t" entityId="svc_1" snap={snap} api={{} as PanelApi} generation={1} onSaved={async () => {}} />,
    )
    const field = screen.getAllByRole('textbox', { name: 'Também chamam de' })[0]!
    fireEvent.change(field, { target: { value: 'Pernas cansadas' } })
    fireEvent.keyDown(field, { key: 'Enter' })
    expect(screen.getByText(/«Pernas cansadas» já está em Massagem › Relaxante/)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Editar Axila' }))
    const inSheet = screen.getAllByRole('textbox', { name: 'Também chamam de' }).at(-1)!
    fireEvent.change(inSheet, { target: { value: 'pernas' } })
    fireEvent.keyDown(inSheet, { key: 'Enter' })
    expect(screen.getByText(/«pernas» já está em Depilação › Pernas/)).toBeTruthy()
  })
})
