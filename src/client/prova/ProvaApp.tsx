import { lazy, Suspense } from 'react'
import type { ProvaRoute } from './routes'

const RadixAgendar = lazy(async () => {
  const mod = await import('./radix/Agendar')
  return { default: mod.RadixAgendar }
})
const RadixAcompanhamento = lazy(async () => {
  const mod = await import('./radix/Acompanhamento')
  return { default: mod.RadixAcompanhamento }
})
const ReactAriaAgendar = lazy(async () => {
  const mod = await import('./react-aria/Agendar')
  return { default: mod.ReactAriaAgendar }
})
const ReactAriaAcompanhamento = lazy(async () => {
  const mod = await import('./react-aria/Acompanhamento')
  return { default: mod.ReactAriaAcompanhamento }
})

function Hub() {
  return (
    <main className="panel-hub">
      <h1>Prova de componentes — F0</h1>
      <p className="lead">
        Área fora das rotas produtivas (issue #16 · DEC-041 · ADR-0013). Mesmos mocks M-04 e M-05,
        dados fictícios, tokens v0.2. Escolha a candidata e a tela.
      </p>
      <div className="panel-hub-grid">
        <a className="card" href="/prova/radix/m04">
          <strong>A · Radix — M-04 Agendar</strong>
          <span>Select, Checkbox, faixa de dias e horários</span>
        </a>
        <a className="card" href="/prova/radix/m05">
          <strong>A · Radix — M-05 Acompanhamento</strong>
          <span>Tabs e folha inferior «Mover para…»</span>
        </a>
        <a className="card" href="/prova/react-aria/m04">
          <strong>B · React Aria — M-04 Agendar</strong>
          <span>Select, Checkbox, DatePicker/Calendar pt-BR</span>
        </a>
        <a className="card" href="/prova/react-aria/m05">
          <strong>B · React Aria — M-05 Acompanhamento</strong>
          <span>Tabs e Modal/Dialog «Mover para…»</span>
        </a>
      </div>
      <p className="note">
        Voltar ao painel de fundação: <a href="/">/</a>. Nenhuma tela produtiva depende destas
        bibliotecas enquanto a escolha não for registada pelo responsável pelo produto.
      </p>
    </main>
  )
}

function ScreenFallback() {
  return <p style={{ padding: 24 }}>A carregar tela de prova…</p>
}

export function ProvaApp({ route }: { route: ProvaRoute }) {
  return (
    <Suspense fallback={<ScreenFallback />}>
      {route === 'radix-m04' ? <RadixAgendar /> : null}
      {route === 'radix-m05' ? <RadixAcompanhamento /> : null}
      {route === 'react-aria-m04' ? <ReactAriaAgendar /> : null}
      {route === 'react-aria-m05' ? <ReactAriaAcompanhamento /> : null}
      {route === 'hub' ? <Hub /> : null}
    </Suspense>
  )
}

export type { ProvaRoute }
export { resolveProvaRoute } from './routes'
