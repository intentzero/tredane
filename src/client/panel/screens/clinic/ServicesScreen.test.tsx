import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ClinicConfigSnapshot, ClinicService, PanelApi } from '../../api'
import { PanelApiError } from '../../api'
import { ServiceForm } from './ServicesScreen'

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
