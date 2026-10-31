// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useRef } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useOutsideClose } from './useOutsideClose'

afterEach(cleanup)

function Harness({ onClose, enabled = true }: { onClose: () => void; enabled?: boolean }) {
  const ref = useRef<HTMLElement | null>(null)
  useOutsideClose(ref, onClose, enabled)
  return (
    <>
      <div data-testid="vazio">área vazia</div>
      <button type="button">Outro item</button>
      <div role="row">Linha</div>
      <div role="listbox">Opções</div>
      <aside ref={ref}>
        <button type="button">Dentro</button>
      </aside>
    </>
  )
}

describe('useOutsideClose', () => {
  it('fecha com clique em área vazia fora do painel', () => {
    const onClose = vi.fn()
    render(<Harness onClose={onClose} />)
    fireEvent.pointerDown(screen.getByTestId('vazio'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('não fecha ao clicar dentro do painel', () => {
    const onClose = vi.fn()
    render(<Harness onClose={onClose} />)
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Dentro' }))
    expect(onClose).not.toHaveBeenCalled()
  })

  it('não fecha ao clicar em outro item, botão ou lista flutuante (o item abre o seu detalhe)', () => {
    const onClose = vi.fn()
    render(<Harness onClose={onClose} />)
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Outro item' }))
    fireEvent.pointerDown(screen.getByRole('row'))
    fireEvent.pointerDown(screen.getByRole('listbox'))
    expect(onClose).not.toHaveBeenCalled()
  })

  it('desativado, não escuta', () => {
    const onClose = vi.fn()
    render(<Harness onClose={onClose} enabled={false} />)
    fireEvent.pointerDown(screen.getByTestId('vazio'))
    expect(onClose).not.toHaveBeenCalled()
  })
})

describe('painéis laterais (CSS)', () => {
  const css = readFileSync(join(__dirname, '../../ui/panel.css'), 'utf8')

  it.each([
    '\\.conversas-3col > \\.conversas-3col-contact',
    '\\.conversas-3col > \\.conversas-3col-agendar',
    '\\.acomp-panel,\\s*\\.agenda-panel,\\s*\\.clinic-panel',
  ])('%s é fixo, do topo ao fundo da janela', (sel) => {
    const body = css.match(new RegExp(`${sel}\\s*\\{([^}]*)\\}`))?.[1] ?? ''
    expect(body).toMatch(/position:\s*fixed/)
    expect(body).toMatch(/top:\s*0/)
    expect(body).toMatch(/bottom:\s*0/)
  })

  it('o conteúdo ao lado não é empurrado quando o painel abre', () => {
    expect(css).not.toMatch(/data-contact='open'\]\s*\.conversas-3col-thread/)
    expect(css).not.toMatch(/data-agendar='open'\]\s*\.conversas-3col-thread/)
    expect(css).not.toMatch(/data-panel='open'\]\s*\.acomp-wide-(board|bar)/)
  })

  it('Conversas desktop ≥1280 px: lista estável ~400 px (Opção A Confirmada)', () => {
    expect(css).toMatch(/--conversas-list-width:\s*400px/)
    expect(css).toMatch(
      /grid-template-columns:\s*var\(--conversas-list-width\)\s+minmax\(var\(--conversas-thread-min\),\s*1fr\)/,
    )
    expect(css).toMatch(/\.conversas-3col-list\s+\.inbox-search-input\s*\{[^}]*background:\s*var\(--color-surface-sunken\)/s)
  })
})
