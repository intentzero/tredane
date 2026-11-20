// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PanelApi } from '../../api'
import '../../../ui/panel.css'
import { AiProfileCard } from './AiAssistCard'

afterEach(cleanup)

function api(signal: { enabled: boolean; cancellationPolicy: string }): PanelApi {
  return {
    getPix: vi.fn(async () => ({ signalSettings: signal })),
    setClinicAiProfile: vi.fn(async () => ({ ok: true })),
  } as unknown as PanelApi
}

describe('Sobre a clínica — regras gerais', () => {
  it('mostra como a cliente recebe: sinal primeiro, frase de ligação, regras gerais; botão com nome claro', async () => {
    render(
      <AiProfileCard
        tenantId="clinic-demo-a"
        api={api({ enabled: true, cancellationPolicy: 'Sinal de R$ 50,00 confirma o horário.' })}
        generation={1}
        initialReschedulePolicy="Atrasos acima de 15 minutos perdem o horário."
      />,
    )
    const preview = await screen.findByRole('region', { name: /Como a cliente recebe/ })
    await waitFor(() => expect(preview.textContent).toContain('Sinal de R$ 50,00'))
    expect(preview.textContent).toContain('Regras gerais da clínica:')
    expect(preview.textContent).toContain('Atrasos acima de 15 minutos')
    expect(screen.getByRole('button', { name: 'Salvar localização e regras' })).toBeTruthy()
  })

  it('sem sinal ligado só saem as regras gerais; o contador acompanha o texto', async () => {
    render(
      <AiProfileCard
        tenantId="clinic-demo-a"
        api={api({ enabled: false, cancellationPolicy: 'Texto antigo do sinal.' })}
        generation={1}
      />,
    )
    const box = screen.getByRole('textbox', { name: /Regras gerais/ })
    fireEvent.change(box, { target: { value: 'Avise com 24 h.' } })
    const preview = await screen.findByRole('region', { name: /Como a cliente recebe/ })
    await waitFor(() => expect(preview.textContent).toContain('Avise com 24 h.'))
    expect(preview.textContent).not.toContain('Texto antigo')
    expect(screen.getByText(/15\/500/)).toBeTruthy()
  })

  it('com localização e regras preenchidas abre como resumo; «Editar» mostra os campos', async () => {
    render(
      <AiProfileCard
        tenantId="clinic-demo-a"
        api={api({ enabled: false, cancellationPolicy: '' })}
        generation={1}
        initialGoogleBusinessUrl="https://maps.app.goo.gl/clinica"
        initialReschedulePolicy="Avise com 24 h."
      />,
    )
    expect(screen.queryByRole('textbox', { name: /Regras gerais/ })).toBeNull()
    expect(screen.getByText('maps.app.goo.gl/clinica')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Editar' }))
    expect(await screen.findByRole('textbox', { name: /Regras gerais/ })).toBeTruthy()
  })
})
