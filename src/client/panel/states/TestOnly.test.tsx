import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { isTestEnvironment, TestOnly } from './TestOnly'

afterEach(cleanup)

describe('isTestEnvironment', () => {
  it('liga só em máquina local e staging', () => {
    for (const h of ['localhost', '127.0.0.1', '[::1]', 'painel.localhost', 'staging.app.tredane.com']) {
      expect(isTestEnvironment(h), h).toBe(true)
    }
  })

  it('fica desligado em produção e em endereços desconhecidos', () => {
    for (const h of ['app.tredane.com', 'tredane.com', 'clinica.exemplo.com.br', 'stagingapp.tredane.com', '']) {
      expect(isTestEnvironment(h), h).toBe(false)
    }
  })
})

describe('TestOnly', () => {
  it('mostra a etiqueta, a nota e a ação em staging', () => {
    render(
      <TestOnly hostname="staging.app.tredane.com" note="Cria exemplos.">
        <button type="button">Criar exemplos</button>
      </TestOnly>,
    )
    expect(screen.getByText('Só em testes')).toBeTruthy()
    expect(screen.getByText('Cria exemplos.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Criar exemplos' })).toBeTruthy()
  })

  it('não renderiza nada em produção', () => {
    const { container } = render(
      <TestOnly hostname="app.tredane.com" note="Cria exemplos.">
        <button type="button">Criar exemplos</button>
      </TestOnly>,
    )
    expect(container.innerHTML).toBe('')
  })
})
