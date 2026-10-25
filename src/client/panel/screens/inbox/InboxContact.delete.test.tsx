/**
 * UI exclusão de contacto — owner-only, confirmação, sem PII em mensagens de erro.
 */
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import '../../../ui/panel.css'
import { InboxContactScreen } from './InboxContact'
import type { PanelApi } from '../../api'
import { PanelApiError } from '../../api'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function mockApi(overrides: Partial<PanelApi> = {}): PanelApi {
  return {
    getInboxContact: vi.fn(async () => ({
      contact: {
        id: 'ctc_ficticio',
        waId: '5511999000111',
        displayName: 'Ana Fictícia',
        createdAt: 1_700_000_000_000,
      },
      conversations: [],
    })),
    deleteContact: vi.fn(async () => ({
      deleted: true,
      contactId: 'ctc_ficticio',
      deletedMessageCount: 2,
      deletedAttachmentCount: 1,
      r2Deleted: 1,
      anonymizedAppointmentCount: 0,
      auditId: 'aud_test',
    })),
    ...overrides,
  } as unknown as PanelApi
}

describe('InboxContactScreen — exclusão', () => {
  it('owner vê exclusão; confirma e chama API sem PII no sucesso', async () => {
    const user = userEvent.setup()
    const api = mockApi()
    render(
      <InboxContactScreen
        tenantId="clinic-demo-a"
        contactId="ctc_ficticio"
        api={api}
        generation={1}
        isOwner
      />,
    )
    await screen.findByText('Informações do contacto')
    await user.click(screen.getByRole('button', { name: 'Excluir contacto' }))
    const dialog = screen.getByRole('alertdialog', { name: 'Excluir contacto?' })
    expect(dialog).toBeTruthy()
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'Cancelar' }),
    )
    await user.click(screen.getByRole('button', { name: 'Excluir permanentemente' }))
    await waitFor(() => {
      expect(api.deleteContact).toHaveBeenCalledWith(
        'clinic-demo-a',
        'ctc_ficticio',
        expect.any(Object),
      )
    })
    await screen.findByText(/Contacto excluído/)
    expect(screen.queryByText('5511999000111')).toBeNull()
  })

  it('Esc na confirmação cancela sem chamar API', async () => {
    const user = userEvent.setup()
    const api = mockApi()
    render(
      <InboxContactScreen
        tenantId="clinic-demo-a"
        contactId="ctc_ficticio"
        api={api}
        generation={1}
        isOwner
      />,
    )
    await screen.findByText('Informações do contacto')
    await user.click(screen.getByRole('button', { name: 'Excluir contacto' }))
    await screen.findByRole('alertdialog', { name: 'Excluir contacto?' })
    await user.keyboard('{Escape}')
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).toBeNull()
    })
    expect(api.deleteContact).not.toHaveBeenCalled()
  })

  it('atendente não vê zona de exclusão', async () => {
    const api = mockApi()
    render(
      <InboxContactScreen
        tenantId="clinic-demo-a"
        contactId="ctc_ficticio"
        api={api}
        generation={1}
        isOwner={false}
      />,
    )
    await screen.findByText('Informações do contacto')
    expect(screen.queryByRole('button', { name: 'Excluir contacto' })).toBeNull()
  })

  it('erro de permissão é genérico (sem PII)', async () => {
    const user = userEvent.setup()
    const api = mockApi({
      deleteContact: vi.fn(async () => {
        throw new PanelApiError(403, 'permission_denied')
      }),
    })
    render(
      <InboxContactScreen
        tenantId="clinic-demo-a"
        contactId="ctc_ficticio"
        api={api}
        generation={1}
        isOwner
      />,
    )
    await screen.findByText('Informações do contacto')
    await user.click(screen.getByRole('button', { name: 'Excluir contacto' }))
    await user.click(screen.getByRole('button', { name: 'Excluir permanentemente' }))
    const msg = await screen.findByRole('alert')
    expect(msg.textContent).toContain('Só o responsável pode excluir contactos.')
    expect(msg.textContent).not.toContain('Ana')
    expect(msg.textContent).not.toContain('5511')
  })
})
