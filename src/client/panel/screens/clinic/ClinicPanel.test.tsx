// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ClinicPanel } from './ClinicPanel'

afterEach(cleanup)

function setup() {
  const onClose = vi.fn()
  render(
    <>
      <button type="button">Abrir ficha</button>
      <ClinicPanel title="Profissional" onClose={onClose}>
        <label>
          Nome
          <input defaultValue="Dra. Fictícia" />
        </label>
      </ClinicPanel>
    </>,
  )
  return onClose
}

describe('ClinicPanel (DEC-069 / DEC-105)', () => {
  it('abre com o foco no painel', () => {
    setup()
    const panel = screen.getByRole('complementary', { name: 'Profissional' })
    expect(document.activeElement).toBe(panel)
  })

  it('sem alterações, × e Esc fecham direto', () => {
    const onClose = setup()
    fireEvent.click(screen.getByRole('button', { name: 'Fechar profissional' }))
    expect(onClose).toHaveBeenCalledTimes(1)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('com alterações, × pede confirmação; continuar mantém e descartar fecha', () => {
    const onClose = setup()
    fireEvent.input(screen.getByLabelText('Nome'), { target: { value: 'Outra' } })
    fireEvent.click(screen.getByRole('button', { name: 'Fechar profissional' }))
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByRole('alertdialog', { name: 'Alterações não salvas' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Continuar a editar' }))
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect((screen.getByLabelText('Nome') as HTMLInputElement).value).toBe('Outra')
    fireEvent.click(screen.getByRole('button', { name: 'Fechar profissional' }))
    fireEvent.click(screen.getByRole('button', { name: 'Descartar' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('Esc com a confirmação aberta só a fecha, sem descartar', () => {
    const onClose = setup()
    fireEvent.input(screen.getByLabelText('Nome'), { target: { value: 'Outra' } })
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.getByRole('alertdialog')).toBeTruthy()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('ao desmontar, o foco volta ao item que abriu o painel', () => {
    const onClose = vi.fn()
    const trigger = document.createElement('button')
    document.body.appendChild(trigger)
    trigger.focus()
    const { unmount } = render(
      <ClinicPanel title="Sala" onClose={onClose}>
        <p>x</p>
      </ClinicPanel>,
    )
    expect(document.activeElement).not.toBe(trigger)
    unmount()
    expect(document.activeElement).toBe(trigger)
    trigger.remove()
  })

  it('clicar em área vazia fora fecha direto sem alterações', () => {
    const onClose = setup()
    fireEvent.pointerDown(document.body)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('clicar fora com alterações pede confirmação antes de descartar', () => {
    const onClose = setup()
    fireEvent.input(screen.getByLabelText('Nome'), { target: { value: 'Outra' } })
    fireEvent.pointerDown(document.body)
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByRole('alertdialog', { name: 'Alterações não salvas' })).toBeTruthy()
  })

  it('clicar noutro botão fora do painel não o fecha', () => {
    const onClose = setup()
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Abrir ficha' }))
    expect(onClose).not.toHaveBeenCalled()
  })
})
