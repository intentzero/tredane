import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { Badge } from './Badge'
import { Banner } from './Banner'
import { ListSkeleton } from './ListSkeleton'
import { OfflineStrip } from './OfflineStrip'
import { EmptyState, ErrorState } from './StatusScreens'

afterEach(cleanup)

describe('Banner', () => {
  it('erro anuncia como alerta e liga o título à região', () => {
    render(
      <Banner tone="error" title="O WhatsApp parou de funcionar">
        <p>As mensagens não estão chegando.</p>
      </Banner>,
    )
    const region = screen.getByRole('alert')
    expect(region.className).toContain('panel-banner-error')
    expect(region.getAttribute('aria-labelledby')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'O WhatsApp parou de funcionar' })).toBeTruthy()
  })

  it('aviso, ok e info não anunciam sozinhos; role pode ser pedido', () => {
    render(
      <>
        <Banner tone="warn" title="Falta pouco" />
        <Banner tone="ok" title="Pronta para atender" />
        <Banner tone="info" title="Como funciona" role="status" />
      </>,
    )
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByRole('status').className).toContain('panel-banner-info')
  })

  it('mostra a ação principal', () => {
    render(
      <Banner tone="warn" title="T" action={<button type="button">Reconectar</button>} />,
    )
    expect(screen.getByRole('button', { name: 'Reconectar' })).toBeTruthy()
  })
})

describe('Badge', () => {
  it('sempre tem texto, nunca só cor', () => {
    render(<Badge tone="wait">Aguardando sinal</Badge>)
    const el = screen.getByText('Aguardando sinal')
    expect(el.className).toContain('panel-badge-wait')
  })
})

describe('ListSkeleton', () => {
  it('é um status ocupado com rótulo só para leitor de tela', () => {
    const { container } = render(<ListSkeleton label="Carregando conversas…" rows={3} />)
    const status = screen.getByRole('status')
    expect(status.getAttribute('aria-busy')).toBe('true')
    expect(screen.getByText('Carregando conversas…').className).toContain('panel-sr-only')
    expect(container.querySelectorAll('.panel-skeleton-row')).toHaveLength(3)
  })
})

describe('OfflineStrip', () => {
  it('explica o que muda sem conexão', () => {
    render(<OfflineStrip />)
    const strip = screen.getByRole('status')
    expect(strip.textContent).toContain('Sem conexão')
    expect(strip.textContent).toContain('agenda e pagamento')
  })
})

describe('estados vazio e erro', () => {
  it('estado vazio sem ação não mostra botão', () => {
    render(<EmptyState title="Nenhuma conversa ainda" description="Quando uma cliente escrever, aparece aqui." />)
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('erro mostra os detalhes para o suporte recolhidos', () => {
    render(<ErrorState title="Ops" description="Tente de novo." detail="invalid_body · HTTP 400" />)
    expect(screen.getByText('Detalhes para o suporte')).toBeTruthy()
    expect(screen.getByText('invalid_body · HTTP 400')).toBeTruthy()
  })
})
