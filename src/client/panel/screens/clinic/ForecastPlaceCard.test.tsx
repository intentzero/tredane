// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PanelApi } from '../../api'
import { ForecastPlaceCard } from './ForecastPlaceCard'

afterEach(cleanup)

function apiMock() {
  return {
    setForecastPlace: vi.fn(async () => ({
      forecastMode: 'cidade' as const,
      forecastCity: 'Campinas',
      forecastLatitude: null,
      forecastLongitude: null,
    })),
  }
}

describe('Local para a previsão', () => {
  it('recusa cidade vazia e grava Campinas sem coordenadas', async () => {
    const api = apiMock()
    render(
      <ForecastPlaceCard
        tenantId="clinic-demo-a"
        api={api as unknown as PanelApi}
        generation={1}
        place={{ mode: 'nenhum' }}
        onSaved={() => {}}
      />,
    )
    expect(screen.getByRole('heading', { name: 'Local para a previsão' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Salvar local' }))
    expect(screen.getByRole('alert').textContent).toContain('Informe a cidade.')
    expect(api.setForecastPlace).not.toHaveBeenCalled()

    fireEvent.change(screen.getByPlaceholderText('Campinas'), { target: { value: 'Campinas' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar local' }))
    await screen.findByText('Cidade salva.')
    expect(api.setForecastPlace).toHaveBeenCalledWith(
      'clinic-demo-a',
      { mode: 'cidade', city: 'Campinas' },
      { generation: 1, expectGeneration: expect.any(Function) },
    )
  })

  it('recusa latitude 91 antes de chamar a API', () => {
    const api = apiMock()
    render(
      <ForecastPlaceCard
        tenantId="clinic-demo-a"
        api={api as unknown as PanelApi}
        generation={1}
        place={{ mode: 'cidade', city: 'Campinas' }}
        onSaved={() => {}}
      />,
    )
    fireEvent.click(screen.getByRole('radio', { name: 'Coordenadas' }))
    fireEvent.change(screen.getByLabelText('Latitude'), { target: { value: '91' } })
    fireEvent.change(screen.getByLabelText('Longitude'), { target: { value: '-47' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar local' }))
    expect(screen.getByRole('alert').textContent).toContain('Latitude')
    expect(api.setForecastPlace).not.toHaveBeenCalled()
  })
})
