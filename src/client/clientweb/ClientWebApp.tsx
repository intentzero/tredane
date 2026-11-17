import { useEffect, useState } from 'react'
import './clientweb.css'
import { exchangeLink, fetchState, type ClientWebState } from './api'
import { clientWebTokenFromPath } from './routes'
import { clinicInitials, formatAppointmentWhen, formatDurationMinutes } from './format'

type View =
  | { kind: 'loading' }
  | { kind: 'ready'; state: ClientWebState }
  | { kind: 'unavailable' }
  | { kind: 'error' }

export function ClientWebApp() {
  const [view, setView] = useState<View>({ kind: 'loading' })

  useEffect(() => {
    let cancelled = false
    const token = clientWebTokenFromPath(window.location.pathname)

    async function start() {
      if (token) {
        const result = await exchangeLink(token)
        if (cancelled) return
        if (result === 'unavailable') return setView({ kind: 'unavailable' })
        if (result === 'error') return setView({ kind: 'error' })
        // O token sai do endereço: não fica no histórico nem pode ser partilhado a partir da barra.
        window.history.replaceState(null, '', '/c')
      }
      const state = await fetchState()
      if (cancelled) return
      if (state.kind === 'unauthorized') return setView({ kind: 'unavailable' })
      if (state.kind === 'error') return setView({ kind: 'error' })
      setView({ kind: 'ready', state: state.state })
    }
    void start()
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div className="cw-root">
      {view.kind === 'loading' && (
        <main className="cw-main" aria-busy="true">
          <p role="status" className="cw-muted">
            A abrir a sua agenda…
          </p>
        </main>
      )}
      {view.kind === 'ready' && <Home state={view.state} />}
      {view.kind === 'unavailable' && <LinkUnavailable />}
      {view.kind === 'error' && <LoadError />}
    </div>
  )
}

function Header({ name }: { name: string }) {
  return (
    <header className="cw-header">
      <span className="cw-badge" aria-hidden="true">
        {clinicInitials(name)}
      </span>
      <span className="cw-clinic">{name}</span>
    </header>
  )
}

function Home({ state }: { state: ClientWebState }) {
  return (
    <>
      <Header name={state.clinicName} />
      <p className="cw-safe">Esta página não pede pagamento nem senha.</p>
      <main className="cw-main">
        <div className="cw-intro">
          <h1 className="cw-title">{state.firstName ? `Olá, ${state.firstName}` : 'Olá'}</h1>
          <p className="cw-muted">
            {state.appointments.length > 0 ? 'Suas próximas marcações' : 'Você não tem marcações futuras.'}
          </p>
        </div>
        {state.appointments.length > 0 && (
          <ul className="cw-list" aria-label="Marcações futuras">
            {state.appointments.map((a) => (
              <li key={a.id} className="cw-card">
                <div className="cw-card-head">
                  <span className="cw-card-title">{a.serviceName}</span>
                  <span className="cw-chip">Confirmada</span>
                </div>
                <span className="cw-muted">
                  {formatAppointmentWhen(a.startsAt, state.timezone)} · {formatDurationMinutes(a.startsAt, a.endsAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="cw-note">
          Para agendar, remarcar ou cancelar, continue pela conversa no WhatsApp.
        </p>
      </main>
    </>
  )
}

function LinkUnavailable() {
  return (
    <main className="cw-main cw-center">
      <span className="cw-icon cw-icon-warning" aria-hidden="true">
        !
      </span>
      <h1 className="cw-title">Este link já foi usado</h1>
      <p className="cw-body">
        Por segurança, cada link abre a sua agenda uma vez e por pouco tempo. Peça outro no chat do WhatsApp e ele
        chega na hora.
      </p>
      <p className="cw-muted">As suas marcações continuam guardadas.</p>
    </main>
  )
}

function LoadError() {
  return (
    <main className="cw-main cw-center">
      <h1 className="cw-title">Não foi possível abrir a agenda</h1>
      <p className="cw-body">Verifique a ligação e abra o link outra vez. Se continuar, peça outro no chat do WhatsApp.</p>
    </main>
  )
}
