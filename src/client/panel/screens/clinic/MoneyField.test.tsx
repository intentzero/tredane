import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { MoneyField } from './MoneyField'

describe('MoneyField', () => {
  it('mostra o prefixo R$ e formata ao digitar', () => {
    const onChange = vi.fn()
    render(<MoneyField label="Preço" value="" onChange={onChange} />)

    expect(screen.getByText('R$')).toBeTruthy()
    const input = screen.getByRole('textbox', { name: 'Preço' })
    fireEvent.change(input, { target: { value: '12000' } })
    expect(onChange).toHaveBeenCalledWith('120,00')
  })

  it('normaliza valor legado com R$ para o campo', () => {
    render(<MoneyField label="Preço" value="R$ 50,00" onChange={() => {}} />)
    expect((screen.getByRole('textbox', { name: 'Preço' }) as HTMLInputElement).value).toBe(
      '50,00',
    )
  })

  it('limpa letras sem dígitos', () => {
    const onChange = vi.fn()
    render(<MoneyField label="Preço (opcional)" value="10,00" onChange={onChange} />)
    fireEvent.change(screen.getByRole('textbox', { name: /^Preço/ }), {
      target: { value: 'abc' },
    })
    expect(onChange).toHaveBeenCalledWith('')
  })
})
