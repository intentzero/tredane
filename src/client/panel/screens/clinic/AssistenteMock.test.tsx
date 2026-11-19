// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PanelApi } from '../../api'
import '../../../ui/panel.css'
import { AiAssistCard } from './AiAssistCard'

afterEach(cleanup)

describe('Assistente: interruptor do atendimento (DEC-212)', () => {
  it('é um interruptor; diz o que faz ligado e o que acontece desligado; mostra «Salvo»', async () => {
    const api = {
      setClinicAiAssist: vi.fn(async () => ({ aiAssistEnabled: false })),
    } as unknown as PanelApi
    render(<AiAssistCard tenantId="clinic-demo-a" api={api} generation={1} initialEnabled />)
    const sw = screen.getByRole('switch', { name: 'Atendimento automático no WhatsApp' })
    expect(sw.className).toContain('panel-switch')
    expect(sw.className).not.toContain('panel-checkbox')
    expect(screen.getAllByText(/Abrir agenda/).length).toBeGreaterThan(0)
    fireEvent.click(sw)
    await waitFor(() => expect(screen.getByText('Salvo')).toBeTruthy())
    expect(screen.getByText(/Nada sai sozinho/)).toBeTruthy()
  })

  it('não ensina o modelo antigo (marcar pelo botão do WhatsApp)', () => {
    const api = {} as unknown as PanelApi
    const { container } = render(
      <AiAssistCard tenantId="clinic-demo-a" api={api} generation={1} initialEnabled />,
    )
    expect(container.textContent).not.toMatch(/botão da proposta|toca no botão do WhatsApp|confirma o horário no WhatsApp/i)
  })
})
