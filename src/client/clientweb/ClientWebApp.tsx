import { useCallback, useEffect, useState } from 'react'
import './clientweb.css'
import { exchangeLink, fetchCatalog, fetchState, type Catalog, type ClientWebAppointment, type ClientWebState, type LinkPurpose } from './api'
import { CancelFlow, RescheduleFlow } from './ManageFlow'
import { BookFlow } from './BookFlow'
import { DirectionsLink } from './DirectionsLink'
import { clientWebTokenFromPath } from './routes'
import { clinicInitials, formatAppointmentWhen, formatDurationMinutes } from './format'

type View =
  | { kind: 'loading' }
  | { kind: 'ready'; state: ClientWebState }
  | {
      kind: 'booking'
      state: ClientWebState
      serviceId: string | null
      audienceLine: import('./api').Line | null
      variantIds: string[]
      preferredDate: string | null
      dayPart: 'manha' | 'tarde' | 'noite' | null
    }
  | { kind: 'reschedule'; state: ClientWebState; appointment: ClientWebAppointment; catalog: Catalog }
  | { kind: 'cancel'; state: ClientWebState; appointment: ClientWebAppointment }
  | { kind: 'unavailable' }
  | { kind: 'error' }

export function ClientWebApp() {
  const [view, setView] = useState<View>({ kind: 'loading' })
  const sessionLost = useCallback(() => setView({ kind: 'unavailable' }), [])
  const refresh = useCallback(async () => {
    setView({ kind: 'loading' })
    const state = await fetchState()
    if (state.kind === 'unauthorized') return setView({ kind: 'unavailable' })
    if (state.kind === 'error') return setView({ kind: 'error' })
    setView({ kind: 'ready', state: state.state })
  }, [])

  useEffect(() => {
    let cancelled = false
    const token = clientWebTokenFromPath(window.location.pathname)

    async function start() {
      let landing: {
        purpose: LinkPurpose
        appointmentId: string | null
        serviceId: string | null
        audienceLine: import('./api').Line | null
        variantIds: string[]
        preferredDate: string | null
        dayPart: 'manha' | 'tarde' | 'noite' | null
      } | null = null
      if (token) {
        const result = await exchangeLink(token)
        if (cancelled) return
        if (result === 'unavailable') return setView({ kind: 'unavailable' })
        if (result === 'error') return setView({ kind: 'error' })
        landing = {
          purpose: result.purpose,
          appointmentId: result.appointmentId,
          serviceId: result.serviceId,
          audienceLine: result.audienceLine,
          variantIds: result.variantIds,
          preferredDate: result.preferredDate,
          dayPart: result.dayPart,
        }
        // O token sai do endereço: não fica no histórico nem pode ser partilhado a partir da barra.
        window.history.replaceState(null, '', '/c')
      }
      const state = await fetchState()
      if (cancelled) return
      if (state.kind === 'unauthorized') return setView({ kind: 'unavailable' })
      if (state.kind === 'error') return setView({ kind: 'error' })
      // Link de remarcar ou cancelar com uma marcação alvo: abre direto nela (se ainda existir).
      const target =
        landing && landing.appointmentId && (landing.purpose === 'remarcar' || landing.purpose === 'cancelar')
          ? state.state.appointments.find((a) => a.id === landing!.appointmentId)
          : undefined
      if (target && landing?.purpose === 'cancelar') {
        return setView({ kind: 'cancel', state: state.state, appointment: target })
      }
      if (target && landing?.purpose === 'remarcar') {
        const catalog = await fetchCatalog()
        if (cancelled) return
        if (catalog === 'unauthorized') return setView({ kind: 'unavailable' })
        if (catalog !== 'error') return setView({ kind: 'reschedule', state: state.state, appointment: target, catalog })
      }
      // Link de agendar (DEC-202): abre já a escolha de serviço, com o serviço reconhecido no chat.
      if (landing?.purpose === 'agendar') {
        return setView({
          kind: 'booking',
          state: state.state,
          serviceId: landing.serviceId,
          audienceLine: landing.audienceLine,
          variantIds: landing.variantIds,
          preferredDate: landing.preferredDate,
          dayPart: landing.dayPart,
        })
      }
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
      {view.kind === 'ready' && (
        <Home
          state={view.state}
          onBook={() =>
            setView({
              kind: 'booking',
              state: view.state,
              serviceId: null,
              audienceLine: null,
              variantIds: [],
              preferredDate: null,
              dayPart: null,
            })
          }
          onCancel={(appointment) => setView({ kind: 'cancel', state: view.state, appointment })}
          onReschedule={async (appointment) => {
            const catalog = await fetchCatalog()
            if (catalog === 'unauthorized') return sessionLost()
            if (catalog === 'error') return setView({ kind: 'error' })
            setView({ kind: 'reschedule', state: view.state, appointment, catalog })
          }}
        />
      )}
      {view.kind === 'reschedule' && (
        <RescheduleFlow
          appointment={view.appointment}
          catalog={view.catalog}
          timezone={view.state.timezone}
          onExit={() => void refresh()}
          onSessionLost={sessionLost}
        />
      )}
      {view.kind === 'cancel' && (
        <CancelFlow appointment={view.appointment} timezone={view.state.timezone} onExit={() => void refresh()} onSessionLost={sessionLost} />
      )}
      {view.kind === 'booking' && (
        <BookFlow
          clinicName={view.state.clinicName}
          locationUrl={view.state.locationUrl ?? null}
          initialServiceId={view.serviceId}
          initialAudienceLine={view.audienceLine}
          initialVariantIds={view.variantIds}
          initialPreferredDate={view.preferredDate}
          initialDayPart={view.dayPart}
          onExit={() => void refresh()}
          onSessionLost={sessionLost}
        />
      )}
      {view.kind === 'unavailable' && <LinkUnavailable />}
      {view.kind === 'error' && <LoadError />}
    </div>
  )
}

function Header({ name, safe = false }: { name: string; safe?: boolean }) {
  return (
    <header>
      <div className="cw-header">
        <span className="cw-badge" aria-hidden="true">
          {clinicInitials(name)}
        </span>
        <span className="cw-clinic">{name}</span>
      </div>
      {safe && <p className="cw-safe">Esta página não pede pagamento nem senha.</p>}
    </header>
  )
}

function Home({
  state,
  onBook,
  onReschedule,
  onCancel,
}: {
  state: ClientWebState
  onBook: () => void
  onReschedule: (a: ClientWebAppointment) => void
  onCancel: (a: ClientWebAppointment) => void
}) {
  return (
    <>
      <Header name={state.clinicName} safe />
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
                <DirectionsLink url={state.locationUrl} />
                <div className="cw-card-actions">
                  <button type="button" className="cw-btn cw-btn-secondary" aria-label={`Remarcar ${a.serviceName}`} onClick={() => onReschedule(a)}>
                    Remarcar
                  </button>
                  <button type="button" className="cw-btn cw-btn-secondary" aria-label={`${a.hasPaidSignal ? 'Pedir cancelamento de' : 'Cancelar'} ${a.serviceName}`} onClick={() => onCancel(a)}>
                    {a.hasPaidSignal ? 'Pedir cancelamento' : 'Cancelar'}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </main>
      <footer className="cw-bar">
        <button type="button" className="cw-btn cw-btn-primary" onClick={onBook}>
          Agendar novo horário
        </button>
      </footer>
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
