import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ClinicConfigSnapshot, ClinicResource, PanelApi } from '../../api'
import { PanelApiError } from '../../api'
import { ResourceForm, ResourcesList } from './ResourcesScreen'

afterEach(cleanup)

function res(over: Partial<ClinicResource>): ClinicResource {
  return {
    id: 'pro_1',
    kind: 'professional',
    name: 'Dra. Paula Reis',
    category: null,
    active: true,
    futureAppointmentCount: 0,
    hasAppointmentHistory: true,
    createdAt: 0,
    updatedAt: 0,
    ...over,
  }
}

function snap(resources: ClinicResource[]): ClinicConfigSnapshot {
  return {
    settings: { tenantId: 't', timezone: 'America/Sao_Paulo', updatedAt: 0 },
    resources,
    services: [],
    weeklyWindows: [],
    blocks: [],
  } as unknown as ClinicConfigSnapshot
}

function renderForm(resource: ClinicResource, api: Partial<PanelApi>) {
  const onSaved = vi.fn(async () => {})
  render(
    <ResourceForm
      tenantId="t"
      kind={resource.kind === 'professional' ? 'professional' : 'room'}
      entityId={resource.id}
      snap={snap([resource])}
      api={api as PanelApi}
      generation={1}
      onSaved={onSaved}
    />,
  )
  return { onSaved }
}

describe('ResourcesList — filtro de inativos', () => {
  it('esconde inativos por padrão e mostra ao ligar «Mostrar inativas»', () => {
    render(
      <ResourcesList
        tenantId="t"
        snap={snap([res({ id: 'a', name: 'Ativa' }), res({ id: 'b', name: 'Antiga', active: false })])}
      />,
    )
    expect(screen.getByText('Ativa')).toBeTruthy()
    expect(screen.queryByText('Antiga')).toBeNull()
    fireEvent.click(screen.getByRole('switch', { name: 'Mostrar inativas (1)' }))
    expect(screen.getByText('Antiga')).toBeTruthy()
  })
})

describe('ResourceForm — ciclo de vida', () => {
  it('não tem mais a caixa de seleção; mostra «Desativar» e sem «Excluir» com histórico', () => {
    renderForm(res({}), {})
    expect(screen.queryByRole('checkbox')).toBeNull()
    expect(screen.getByRole('button', { name: 'Desativar' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Excluir/ })).toBeNull()
    expect(screen.queryByText(/Desactivar/)).toBeNull()
  })

  it('sem compromissos futuros desativa direto', async () => {
    const deactivateResource = vi.fn(async () => ({
      ...res({ active: false }),
      reassigned: [],
      keptAppointmentIds: [],
    }))
    renderForm(res({}), { deactivateResource } as Partial<PanelApi>)
    fireEvent.click(screen.getByRole('button', { name: 'Desativar' }))
    await waitFor(() => expect(deactivateResource).toHaveBeenCalled())
    expect((deactivateResource.mock.calls[0] as unknown[])[2]).toEqual([])
    await screen.findByText(/foi desativado para novos agendamentos/)
  })

  it('com futuros abre a lista com sugestão e envia remanejamento escolhido', async () => {
    const listResourceFutureAppointments = vi.fn(async () => ({
      resource: res({ futureAppointmentCount: 2 }),
      appointments: [
        {
          appointmentId: 'apt_1',
          serviceId: 's',
          serviceName: 'Limpeza de pele',
          contactLabel: 'Paciente A',
          startsAt: Date.UTC(2030, 0, 7, 13),
          endsAt: Date.UTC(2030, 0, 7, 14),
          professionalId: 'pro_1',
          roomResourceId: null,
          version: 3,
          candidates: [{ id: 'pro_2', name: 'Bia Souza' }],
          suggestedResourceId: 'pro_2',
        },
        {
          appointmentId: 'apt_2',
          serviceId: 's',
          serviceName: 'Limpeza de pele',
          contactLabel: null,
          startsAt: Date.UTC(2030, 0, 7, 15),
          endsAt: Date.UTC(2030, 0, 7, 16),
          professionalId: 'pro_1',
          roomResourceId: null,
          version: 1,
          candidates: [],
          suggestedResourceId: null,
        },
      ],
    }))
    const deactivateResource = vi.fn(async () => ({
      ...res({ active: false }),
      reassigned: [{ appointmentId: 'apt_1', fromResourceId: 'pro_1', toResourceId: 'pro_2' }],
      keptAppointmentIds: ['apt_2'],
    }))
    renderForm(res({ futureAppointmentCount: 2 }), {
      listResourceFutureAppointments,
      deactivateResource,
    } as Partial<PanelApi>)
    fireEvent.click(screen.getByRole('button', { name: 'Desativar' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/Há 2 compromissos futuros/)).toBeTruthy()
    expect(within(dialog).getByText('Remanejar para Bia Souza')).toBeTruthy()
    expect(within(dialog).getByText('Manter neste horário')).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remanejar 1 e desativar' }))
    await waitFor(() => expect(deactivateResource).toHaveBeenCalled())
    expect((deactivateResource.mock.calls[0] as unknown[])[2]).toEqual([
      { appointmentId: 'apt_1', targetResourceId: 'pro_2', expectedVersion: 3 },
    ])
    await screen.findByText(/1 compromisso\(s\) remanejado\(s\)/)
  })

  it('«Manter todos» desativa só para novos agendamentos', async () => {
    const listResourceFutureAppointments = vi.fn(async () => ({
      resource: res({ futureAppointmentCount: 1 }),
      appointments: [
        {
          appointmentId: 'apt_1',
          serviceId: 's',
          serviceName: null,
          contactLabel: null,
          startsAt: Date.UTC(2030, 0, 7, 13),
          endsAt: Date.UTC(2030, 0, 7, 14),
          professionalId: 'pro_1',
          roomResourceId: null,
          version: 1,
          candidates: [{ id: 'pro_2', name: 'Bia Souza' }],
          suggestedResourceId: 'pro_2',
        },
      ],
    }))
    const deactivateResource = vi.fn(async () => ({
      ...res({ active: false }),
      reassigned: [],
      keptAppointmentIds: ['apt_1'],
    }))
    renderForm(res({ futureAppointmentCount: 1 }), {
      listResourceFutureAppointments,
      deactivateResource,
    } as Partial<PanelApi>)
    fireEvent.click(screen.getByRole('button', { name: 'Desativar' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Manter todos' }))
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Desativar só para novos agendamentos' }),
    )
    await waitFor(() => expect(deactivateResource).toHaveBeenCalled())
    expect((deactivateResource.mock.calls[0] as unknown[])[2]).toEqual([])
  })

  it('inativo mostra «Reativar»', async () => {
    const setResourceActive = vi.fn(async () => res({ active: true }))
    renderForm(res({ active: false }), { setResourceActive } as Partial<PanelApi>)
    fireEvent.click(screen.getByRole('button', { name: 'Reativar' }))
    await waitFor(() => expect(setResourceActive).toHaveBeenCalledWith('t', 'pro_1', true, expect.anything()))
  })

  it('sem histórico permite excluir com confirmação; erro do servidor é claro', async () => {
    const deleteResource = vi.fn(async () => {
      throw new PanelApiError(409, 'resource_has_history' as never)
    })
    renderForm(res({ hasAppointmentHistory: false }), { deleteResource } as Partial<PanelApi>)
    fireEvent.click(screen.getByRole('button', { name: 'Excluir profissional' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByText(/não pode ser desfeita/)).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Excluir permanentemente' }))
    await waitFor(() => expect(deleteResource).toHaveBeenCalled())
    await screen.findByText(/já teve compromissos/)
  })
})

describe('ResourceForm — volta para a lista certa', () => {
  it('Voltar numa sala volta para a aba Salas; num profissional, para Profissionais', () => {
    renderForm(res({ id: 'room_1', kind: 'room', name: 'Sala fictícia' }), {})
    fireEvent.click(screen.getByRole('button', { name: 'Voltar' }))
    expect(window.location.pathname).toMatch(/\/recursos\/salas$/)
    cleanup()
    renderForm(res({}), {})
    fireEvent.click(screen.getByRole('button', { name: 'Voltar' }))
    expect(window.location.pathname).toMatch(/\/recursos$/)
  })
})
