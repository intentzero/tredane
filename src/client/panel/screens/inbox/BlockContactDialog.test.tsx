import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { BlockContactDialog } from './BlockContactDialog'

afterEach(() => cleanup())

const PIX_WARNING = 'Este contato tem um Pix pendente. O Pix continua válido e não será cancelado.'

function renderDialog(hasPendingPix?: boolean) {
  render(
    <BlockContactDialog
      open
      contactLabel="Paulo Fictício"
      busy={false}
      hasPendingPix={hasPendingPix}
      onClose={() => {}}
      onConfirm={() => {}}
    />,
  )
}

describe('BlockContactDialog — Pix pendente (Decidido)', () => {
  it('com Pix pendente mostra o aviso antes de confirmar', () => {
    renderDialog(true)
    expect(screen.getByText(PIX_WARNING)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Bloquear contato' })).toBeTruthy()
  })

  it('sem Pix pendente o diálogo fica igual (sem aviso)', () => {
    renderDialog(false)
    expect(screen.queryByText(PIX_WARNING)).toBeNull()
    cleanup()
    renderDialog(undefined)
    expect(screen.queryByText(PIX_WARNING)).toBeNull()
  })
})
