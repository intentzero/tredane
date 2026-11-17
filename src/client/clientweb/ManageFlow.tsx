import { useState } from 'react'
import {
  askTeam,
  cancelAppointment,
  fetchRescheduleSlots,
  rescheduleSlot,
  type Catalog,
  type ClientWebAppointment,
  type Slot,
} from './api'
import { civilDayLabel } from './booking-model'
import { formatAppointmentWhen } from './format'
import { TimeStep } from './TimeStep'

type Common = {
  appointment: ClientWebAppointment
  timezone: string
  onExit: () => void
  onSessionLost: () => void
}

function StepHeader({ title, caption, onBack }: { title: string; caption: string; onBack: () => void }) {
  return (
    <header>
      <div className="cw-step-header">
        <button type="button" className="cw-icon-btn" onClick={onBack} aria-label="Voltar">
          <span aria-hidden="true">‹</span>
        </button>
        <div className="cw-step-title">
          <span className="cw-caption">{caption}</span>
          <h1 className="cw-title">{title}</h1>
        </div>
      </div>
    </header>
  )
}

function ResultScreen({ title, body, tone, onExit }: { title: string; body: string; tone: 'ok' | 'warn'; onExit: () => void }) {
  return (
    <main className="cw-main cw-center" role="status">
      <span className={`cw-icon ${tone === 'ok' ? 'cw-icon-ok' : 'cw-icon-warning'}`} aria-hidden="true">
        {tone === 'ok' ? '✓' : '!'}
      </span>
      <h1 className="cw-title">{title}</h1>
      <p className="cw-body">{body}</p>
      <button type="button" className="cw-btn cw-btn-primary" onClick={onExit}>
        Ver minhas marcações
      </button>
    </main>
  )
}

/** Remarcar (C-07): mesmo serviço e zonas, outra hora; sem sinal novo. */
export function RescheduleFlow({ appointment, timezone, onExit, onSessionLost, catalog }: Common & { catalog: Catalog }) {
  const [weekStart, setWeekStart] = useState(catalog.today)
  const [day, setDay] = useState<string | null>(null)
  const [slot, setSlot] = useState<Slot | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [outcome, setOutcome] = useState<'booked' | 'paused' | 'error' | null>(null)

  async function confirm() {
    if (!slot || sending) return
    setSending(true)
    const res = await rescheduleSlot({ appointmentId: appointment.id, slotId: slot.id })
    if (res === 'unauthorized') return onSessionLost()
    if (res === 'error') return setOutcome('error')
    if (res.status === 'booked') return setOutcome('booked')
    if (res.status === 'paused') return setOutcome('paused')
    if (res.status === 'slot_taken') {
      setNotice('Esse horário acabou de ser ocupado. Escolha outro.')
      setSlot(null)
      setSending(false)
      return
    }
    setOutcome('error')
  }

  if (outcome === 'booked') {
    const l = slot ? civilDayLabel(slot.date) : null
    return (
      <ResultScreen
        tone="ok"
        title="Marcação remarcada"
        body={`${l && slot ? `${l.weekday} ${l.dayMonth}, ${slot.time}. ` : ''}Enviamos um recibo no seu WhatsApp. Se não foi você quem remarcou, toque em «Falar com a equipe» na mensagem.`}
        onExit={onExit}
      />
    )
  }
  if (outcome === 'paused') {
    return <ResultScreen tone="warn" title="A equipe atende por aqui" body="Neste momento a remarcação automática está em pausa. Fale com a equipe no WhatsApp." onExit={onExit} />
  }
  if (outcome === 'error') {
    return <ResultScreen tone="warn" title="Não foi possível remarcar" body="Nada foi alterado. Tente outra vez ou fale com a equipe no WhatsApp." onExit={onExit} />
  }

  if (slot) {
    const now = formatAppointmentWhen(appointment.startsAt, timezone)
    const l = civilDayLabel(slot.date)
    return (
      <>
        <StepHeader title="Confirme a remarcação" caption="Remarcar" onBack={() => setSlot(null)} />
        <main className="cw-main">
          <dl className="cw-dl">
            <div><dt>Serviço</dt><dd>{appointment.serviceName}</dd></div>
            <div><dt>Hoje</dt><dd>{now}</dd></div>
            <div><dt>Nova data</dt><dd>{l.weekday} {l.dayMonth}, {slot.time}</dd></div>
          </dl>
          <p className="cw-notice" role="note">Remarcar não gera novo sinal. O serviço e as zonas ficam iguais.</p>
        </main>
        <footer className="cw-bar cw-bar-col">
          <button type="button" className="cw-btn cw-btn-primary" disabled={sending} onClick={() => void confirm()}>
            {sending ? 'A confirmar…' : 'Confirmar remarcação'}
          </button>
          <button type="button" className="cw-btn cw-btn-text" disabled={sending} onClick={() => setSlot(null)}>
            Escolher outra hora
          </button>
        </footer>
      </>
    )
  }

  return (
    <>
      <StepHeader title="Nova data e hora" caption="Remarcar" onBack={onExit} />
      <TimeStep
        catalog={catalog}
        subtitle={`${appointment.serviceName} · hoje ${formatAppointmentWhen(appointment.startsAt, timezone)}`}
        depsKey={`resched:${appointment.id}`}
        load={(from, to) => fetchRescheduleSlots({ appointmentId: appointment.id, from, to })}
        loadDays={(from, to) => fetchRescheduleSlots({ appointmentId: appointment.id, from, to, daysOnly: true })}
        weekStart={weekStart}
        setWeekStart={setWeekStart}
        day={day}
        setDay={setDay}
        notice={notice}
        onSessionLost={onSessionLost}
        onPick={(s) => {
          setNotice(null)
          setSlot(s)
        }}
      />
    </>
  )
}

/** Cancelar (C-08): sem sinal cancela; com sinal pago pede à equipe. */
export function CancelFlow({ appointment, timezone, onExit, onSessionLost }: Common) {
  const [sending, setSending] = useState(false)
  const [outcome, setOutcome] = useState<'cancelled' | 'asked' | 'after_hours' | 'not_found' | 'error' | null>(null)
  const when = formatAppointmentWhen(appointment.startsAt, timezone)

  async function cancel() {
    if (sending) return
    setSending(true)
    const res = await cancelAppointment({ appointmentId: appointment.id })
    if (res === 'unauthorized') return onSessionLost()
    if (res === 'error') return setOutcome('error')
    if (res.status === 'cancelled') return setOutcome('cancelled')
    if (res.status === 'not_found') return setOutcome('not_found')
    // Chegou-se aqui com sinal pago: passa a pedir à equipe.
    setSending(false)
    setOutcome(null)
  }

  async function ask() {
    if (sending) return
    setSending(true)
    const res = await askTeam()
    if (res === 'unauthorized') return onSessionLost()
    setOutcome(res === 'asked' ? 'asked' : res === 'after_hours' ? 'after_hours' : 'error')
  }

  if (outcome === 'cancelled') {
    return (
      <ResultScreen
        tone="ok"
        title="Marcação cancelada"
        body="Enviamos um recibo no seu WhatsApp. Se não foi você quem cancelou, toque em «Falar com a equipe» na mensagem."
        onExit={onExit}
      />
    )
  }
  if (outcome === 'asked') {
    return <ResultScreen tone="ok" title="A equipe foi avisada" body="Responderemos no seu WhatsApp para tratar do cancelamento." onExit={onExit} />
  }
  if (outcome === 'after_hours') {
    return <ResultScreen tone="ok" title="Pedido recebido" body="A equipe está fora do horário. Enviámos o próximo horário de atendimento no seu WhatsApp." onExit={onExit} />
  }
  if (outcome === 'not_found') {
    return <ResultScreen tone="warn" title="Esta marcação já não existe" body="Ela pode já ter sido cancelada ou realizada." onExit={onExit} />
  }
  if (outcome === 'error') {
    return <ResultScreen tone="warn" title="Não foi possível concluir" body="Nada foi alterado. Tente outra vez ou fale com a equipe no WhatsApp." onExit={onExit} />
  }

  return (
    <>
      <StepHeader title={appointment.hasPaidSignal ? 'Pedir cancelamento' : 'Cancelar marcação?'} caption="Cancelar" onBack={onExit} />
      <main className="cw-main">
        <dl className="cw-dl">
          <div><dt>Marcação</dt><dd>{appointment.serviceName}</dd></div>
          <div><dt>Quando</dt><dd>{when}</dd></div>
        </dl>
        {appointment.hasPaidSignal ? (
          <p className="cw-notice" role="note">
            Esta marcação tem um sinal pago. O cancelamento depende da política da clínica, por isso quem trata disso é a equipe.
          </p>
        ) : (
          <p className="cw-note">Depois de cancelar, o horário fica livre para outras pessoas.</p>
        )}
      </main>
      <footer className="cw-bar cw-bar-col">
        {appointment.hasPaidSignal ? (
          <button type="button" className="cw-btn cw-btn-primary" disabled={sending} onClick={() => void ask()}>
            {sending ? 'A enviar…' : 'Pedir à equipe'}
          </button>
        ) : (
          <button type="button" className="cw-btn cw-btn-danger" disabled={sending} onClick={() => void cancel()}>
            {sending ? 'A cancelar…' : 'Cancelar marcação'}
          </button>
        )}
        <button type="button" className="cw-btn cw-btn-text" disabled={sending} onClick={onExit}>
          Manter marcação
        </button>
      </footer>
    </>
  )
}
