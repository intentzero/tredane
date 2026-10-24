import { useEffect, useState } from 'react'

type Health = 'checking' | 'ready' | 'unavailable'

const modules = [
  { number: '01', name: 'Atendimento', detail: 'WhatsApp e caixa de entrada', status: 'Planejado' },
  { number: '02', name: 'Assistente', detail: 'Sugestões de IA com revisão humana', status: 'Planejado' },
  { number: '03', name: 'Agenda', detail: 'Profissionais, serviços e recursos', status: 'Planejado' },
  { number: '04', name: 'Pipeline', detail: 'Oportunidades e conversão', status: 'Planejado' },
]

export function App() {
  const [health, setHealth] = useState<Health>('checking')

  useEffect(() => {
    const controller = new AbortController()
    async function checkApi() {
      try {
        const response = await fetch('/api/health', { signal: controller.signal })
        if (!response.ok) throw new Error('Health check failed')
        const data: unknown = await response.json()
        if (
          !data ||
          typeof data !== 'object' ||
          !('status' in data) ||
          data.status !== 'ok'
        ) throw new Error('Unexpected response')
        setHealth('ready')
      } catch {
        if (!controller.signal.aborted) setHealth('unavailable')
      }
    }
    void checkApi()
    return () => controller.abort()
  }, [])

  return (
    <div className="shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="Tredane, início">
          <span className="brand-mark" aria-hidden="true">t</span>
          <span>tredane<span className="brand-period">.</span></span>
        </a>
        <span className="environment">Ambiente de fundação · F0</span>
      </header>

      <main className="main">
        <div className="eyebrow"><span className="eyebrow-dot" /> Plataforma de atendimento inteligente</div>
        <h1>Conversas que abrem <em>oportunidades.</em></h1>
        <p className="intro">Uma experiência unificada de atendimento, agendamento e relacionamento para clínicas de estética.</p>
        <div className="status-card" role="status" aria-live="polite">
          <span className={`status-indicator ${health}`} aria-hidden="true" />
          <div>
            <strong>{health === 'checking' ? 'Verificando a API' : health === 'ready' ? 'Fundação operacional' : 'API indisponível'}</strong>
            <p>{health === 'ready' ? 'O painel React comunica com a API Hono.' : health === 'checking' ? 'A estabelecer ligação local.' : 'Verifique o processo Worker e a configuração local.'}</p>
          </div>
          <span className="status-label">F0</span>
        </div>

        <section className="modules" aria-labelledby="modules-title">
          <div className="section-heading">
            <h2 id="modules-title">Os pilares da plataforma</h2>
            <span>Funcionalidades futuras — ainda não ativadas</span>
          </div>
          <div className="module-grid">
            {modules.map((module) => (
              <article className="module" key={module.number}>
                <span className="module-number">{module.number}</span>
                <h3>{module.name}</h3>
                <p>{module.detail}</p>
                <span className="module-status">{module.status}</span>
              </article>
            ))}
          </div>
        </section>
        <p className="footnote">
          Protótipo de fundação sem login, dados reais ou integração com o WhatsApp. Não utilizar
          para atendimentos. Área de prova de componentes (issue #16):{' '}
          <a href="/prova">/prova</a>.
        </p>
      </main>
      <footer>© {new Date().getFullYear()} Tredane · Fundação do produto</footer>
    </div>
  )
}
