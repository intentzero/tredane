import { lazy, Suspense } from 'react'
import type { ProvaRoute } from './routes'

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
        Área fora das rotas produtivas (issue #16 · DEC-048 · ADR-0013). Biblioteca-base{' '}
        <strong>Confirmada</strong>: React Aria Components. Mocks M-04 e M-05, dados fictícios,
        tokens v0.2 (DEC-041). Candidata Radix removida.
      </p>
      <div className="panel-hub-grid">
        <a className="card" href="/prova/react-aria/m04">
          <strong>React Aria — M-04 Agendar</strong>
          <span>Select, Checkbox, DatePicker/Calendar pt-BR</span>
        </a>
        <a className="card" href="/prova/react-aria/m05">
          <strong>React Aria — M-05 Acompanhamento</strong>
          <span>Tabs e Modal/Dialog «Mover para…»</span>
        </a>
      </div>
      <p className="note">
        Voltar ao painel de fundação: <a href="/">/</a>. Referência para telas produtivas (#22+);
        não é rota de produção.
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
      {route === 'react-aria-m04' ? <ReactAriaAgendar /> : null}
      {route === 'react-aria-m05' ? <ReactAriaAcompanhamento /> : null}
      {route === 'hub' ? <Hub /> : null}
    </Suspense>
  )
}

export type { ProvaRoute }
export { resolveProvaRoute } from './routes'
