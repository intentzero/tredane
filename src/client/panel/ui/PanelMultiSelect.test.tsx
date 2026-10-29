// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { PanelMultiSelect } from './PanelMultiSelect'

afterEach(cleanup)

const OPTIONS = [
  { id: 'a', label: 'Ana' },
  { id: 'b', label: 'Bia' },
]

function Harness() {
  const [value, setValue] = useState<string[]>(['a'])
  return <PanelMultiSelect label="Quem fica fora" options={OPTIONS} value={value} onChange={setValue} />
}

describe('PanelMultiSelect — teclado', () => {
  it('abre com o foco na lista, e Esc fecha sem limpar a seleção', async () => {
    render(<Harness />)
    const trigger = screen.getByRole('button', { name: /Quem fica fora/ })
    fireEvent.click(trigger)
    const list = await screen.findByRole('listbox')
    await waitFor(() => expect(list.contains(document.activeElement)).toBe(true))
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
    fireEvent.keyUp(document.activeElement ?? document.body, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull())
    expect(screen.getByRole('button', { name: /Quem fica fora/ }).textContent).toContain('Ana')
  })
})
