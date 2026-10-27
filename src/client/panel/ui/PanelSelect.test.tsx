// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PanelSelect } from './PanelSelect'

afterEach(cleanup)

const options = [
  { id: 'fixed', label: 'Valor fixo (R$)' },
  { id: 'percent', label: 'Percentual do preço', disabled: true, hint: 'Cadastre o preço primeiro' },
]

describe('PanelSelect', () => {
  it('mostra o valor atual e abre uma folha com as opções', () => {
    render(<PanelSelect label="Tipo" value="fixed" onChange={() => {}} options={options} />)
    const trigger = screen.getByRole('button', { name: /Tipo/ })
    expect(trigger.textContent).toContain('Valor fixo (R$)')
    fireEvent.click(trigger)
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(screen.getAllByRole('option')).toHaveLength(2)
  })

  it('escolher uma opção chama onChange e fecha; opção desativada não escolhe', () => {
    const onChange = vi.fn()
    render(<PanelSelect label="Tipo" value={null} onChange={onChange} options={options} />)
    expect(screen.getByRole('button', { name: /Tipo/ }).textContent).toContain('Escolha')
    fireEvent.click(screen.getByRole('button', { name: /Tipo/ }))
    const percent = screen.getByRole('option', { name: /Percentual/ })
    expect(percent.getAttribute('aria-disabled')).toBe('true')
    fireEvent.click(percent)
    expect(onChange).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('option', { name: /Valor fixo/ }))
    expect(onChange).toHaveBeenCalledWith('fixed')
  })

  it('desativado não abre', () => {
    render(<PanelSelect label="Tipo" value="fixed" isDisabled onChange={() => {}} options={options} />)
    const trigger = screen.getByRole('button', { name: /Tipo/ }) as HTMLButtonElement
    expect(trigger.disabled).toBe(true)
  })
})
