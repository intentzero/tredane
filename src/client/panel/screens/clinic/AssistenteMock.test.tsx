// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PanelApi } from '../../api'
import '../../../ui/panel.css'
import { AiAssistCard } from './AiAssistCard'
import { ClientConfirmsCard } from './ClientConfirmsCard'

afterEach(cleanup)

describe('Assistente: interruptores e cartão (M-74)', () => {
  it('«Ativar sugestões» é um interruptor, não uma caixa; mostra «Salvo» depois de gravar', async () => {
    const api = {
      setClinicAiAssist: vi.fn(async () => ({ aiAssistEnabled: false })),
      setClinicAiProfile: vi.fn(),
    } as unknown as PanelApi
    render(<AiAssistCard tenantId="clinic-demo-a" api={api} generation={1} initialEnabled />)
    const sw = screen.getByRole('switch', { name: 'Ativar sugestões de resposta com IA' })
    expect(sw.className).toContain('panel-switch')
    expect(sw.className).not.toContain('panel-checkbox')
    fireEvent.click(sw)
    await waitFor(() => expect(screen.getByText('Salvo')).toBeTruthy())
  })

  it('o cartão diz que só marca quando a cliente toca no botão', () => {
    render(<ClientConfirmsCard />)
    expect(screen.getByRole('region', { name: 'A cliente confirma o horário no WhatsApp' })).toBeTruthy()
    expect(screen.getByText(/Só marca quando ela toca no botão da proposta/)).toBeTruthy()
  })
})
