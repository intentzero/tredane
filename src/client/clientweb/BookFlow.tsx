import { useEffect, useMemo, useState } from 'react'
import {
  bookSlot,
  fetchCatalog,
  fetchSlots,
  type Catalog,
  type CatalogService,
  type Line,
  type Slot,
} from './api'
import {
  addDays,
  canGoNextWeek,
  canGoPrevWeek,
  catalogNeedsLine,
  civilDayLabel,
  dayPart,
  formatPrice,
  prevWeekStart,
  servicesForLine,
  visitTotals,
  weekDays,
  zonesForLine,
  type DayPart,
} from './booking-model'

type Step = 'line' | 'service' | 'zones' | 'time' | 'review' | 'done'
type Outcome = 'booked' | 'pix_signal' | 'paused' | 'error'

type Props = {
  clinicName: string
  onExit: () => void
  onSessionLost: () => void
}

export function BookFlow({ clinicName, onExit, onSessionLost }: Props) {
  const [catalog, setCatalog] = useState<Catalog | 'loading' | 'error'>('loading')
  const [line, setLine] = useState<Line | null>(null)
  const [step, setStep] = useState<Step>('service')
  const [service, setService] = useState<CatalogService | null>(null)
  const [zoneIds, setZoneIds] = useState<string[]>([])
  const [weekStart, setWeekStart] = useState('')
  const [day, setDay] = useState<string | null>(null)
  const [slot, setSlot] = useState<Slot | null>(null)
  const [slotNotice, setSlotNotice] = useState<string | null>(null)
  const [outcome, setOutcome] = useState<Outcome | null>(null)

  useEffect(() => {
    let cancelled = false
    void fetchCatalog().then((res) => {
      if (cancelled) return
      if (res === 'unauthorized') return onSessionLost()
      if (res === 'error') return setCatalog('error')
      setCatalog(res)
      setWeekStart(res.today)
      setStep(catalogNeedsLine(res) ? 'line' : 'service')
    })
    return () => {
      cancelled = true
    }
  }, [onSessionLost])

  if (catalog === 'loading') {
    return (
      <main className="cw-main" aria-busy="true">
        <p role="status" className="cw-muted">
          A carregar os serviços…
        </p>
      </main>
    )
  }
  if (catalog === 'error') {
    return (
      <main className="cw-main cw-center">
        <h1 className="cw-title">Não foi possível carregar os serviços</h1>
        <p className="cw-body">Verifique a ligação e tente outra vez.</p>
        <button type="button" className="cw-btn cw-btn-secondary" onClick={onExit}>
          Voltar
        </button>
      </main>
    )
  }

  const needsLine = catalogNeedsLine(catalog)
  const hasZones = (service?.zones.length ?? 0) > 0
  const totalSteps = hasZones ? 4 : 3
  const position = step === 'service' || step === 'line' ? 1 : step === 'zones' ? 2 : step === 'time' ? (hasZones ? 3 : 2) : totalSteps

  function chooseService(s: CatalogService) {
    setService(s)
    setZoneIds([])
    setDay(null)
    setSlot(null)
    setSlotNotice(null)
    setStep(s.zones.length > 0 ? 'zones' : 'time')
  }

  function back() {
    if (step === 'line' || (step === 'service' && !needsLine)) return onExit()
    if (step === 'service') return setStep('line')
    if (step === 'zones') return setStep('service')
    if (step === 'time') return setStep(hasZones ? 'zones' : 'service')
    if (step === 'review') return setStep('time')
  }

  if (step === 'done' && outcome) return <Done outcome={outcome} slot={slot} onExit={onExit} />

  const titles: Record<Exclude<Step, 'done'>, string> = {
    line: 'Para quem é?',
    service: 'Qual serviço?',
    zones: service?.variantKindPlural ? `Que ${service.variantKindPlural.toLowerCase()}?` : 'Que opções?',
    time: 'Quando?',
    review: 'Confirme o horário',
  }

  return (
    <>
      <header>
        <div className="cw-step-header">
          <button type="button" className="cw-icon-btn" onClick={back} aria-label="Voltar">
            <span aria-hidden="true">‹</span>
          </button>
          <div className="cw-step-title">
            <span className="cw-caption">
              {clinicName} · passo {position} de {totalSteps}
            </span>
            <h1 className="cw-title">{titles[step as Exclude<Step, 'done'>]}</h1>
          </div>
        </div>
        <div
          role="progressbar"
          aria-label="Progresso"
          aria-valuemin={1}
          aria-valuemax={totalSteps}
          aria-valuenow={position}
          className="cw-progress"
        >
          <div className="cw-progress-bar" style={{ width: `${(position / totalSteps) * 100}%` }} />
        </div>
      </header>

      {step === 'line' && (
        <main className="cw-main">
          <p className="cw-muted">Serve para mostrar os serviços e opções certos. Vale só para esta marcação.</p>
          <div className="cw-choice-row">
            {(['feminino', 'masculino'] as const).map((l) => (
              <button
                key={l}
                type="button"
                className="cw-btn cw-btn-secondary"
                onClick={() => {
                  setLine(l)
                  setStep('service')
                }}
              >
                {l === 'feminino' ? 'Feminino' : 'Masculino'}
              </button>
            ))}
          </div>
        </main>
      )}

      {step === 'service' && (
        <ServiceList catalog={catalog} line={line} onPick={chooseService} onChangeLine={needsLine ? () => setStep('line') : null} />
      )}

      {step === 'zones' && service && (
        <ZoneStep
          service={service}
          line={line}
          selected={zoneIds}
          onToggle={(id) =>
            setZoneIds((cur) =>
              service.variantSelection === 'uma' ? [id] : cur.includes(id) ? cur.filter((z) => z !== id) : [...cur, id],
            )
          }
          onNext={() => setStep('time')}
        />
      )}

      {step === 'time' && service && (
        <TimeStep
          catalog={catalog}
          service={service}
          zoneIds={zoneIds}
          weekStart={weekStart}
          setWeekStart={setWeekStart}
          day={day}
          setDay={setDay}
          notice={slotNotice}
          onSessionLost={onSessionLost}
          onPick={(s) => {
            setSlot(s)
            setSlotNotice(null)
            setStep('review')
          }}
        />
      )}

      {step === 'review' && service && slot && (
        <Review
          service={service}
          zoneIds={zoneIds}
          line={line}
          slot={slot}
          onChange={() => setStep('service')}
          onSessionLost={onSessionLost}
          onResult={(r) => {
            if (r === 'slot_taken') {
              setSlotNotice('Esse horário acabou de ser ocupado. Escolha outro.')
              setSlot(null)
              setStep('time')
              return
            }
            setOutcome(r)
            setStep('done')
          }}
        />
      )}
    </>
  )
}

function ServiceList({
  catalog,
  line,
  onPick,
  onChangeLine,
}: {
  catalog: Catalog
  line: Line | null
  onPick: (s: CatalogService) => void
  onChangeLine: (() => void) | null
}) {
  const services = servicesForLine(catalog, line)
  return (
    <main className="cw-main cw-flush">
      {onChangeLine && (
        <div className="cw-line-bar">
          <span>{line === 'feminino' ? 'Feminino' : line === 'masculino' ? 'Masculino' : 'Para quem é?'}</span>
          <button type="button" className="cw-link" onClick={onChangeLine}>
            Trocar
          </button>
        </div>
      )}
      {services.length === 0 ? (
        <p className="cw-note cw-margin">Não há serviços para marcar aqui. Fale com a equipe pelo WhatsApp.</p>
      ) : (
        <ul className="cw-rows" aria-label="Serviços">
          {services.map((s) => {
            const zonesFrom = s.zones.length > 0 ? Math.min(...zonesForLine(s, line).map((z) => z.priceCents ?? Infinity)) : null
            return (
              <li key={s.id}>
                <button type="button" className="cw-row" onClick={() => onPick(s)}>
                  <span className="cw-row-main">
                    <span className="cw-row-title">{s.name}</span>
                    <span className="cw-muted">
                      {s.zones.length > 0
                        ? `${s.variantKindPlural ?? 'Opções'} à escolha${zonesFrom != null && Number.isFinite(zonesFrom) ? ` · desde ${formatPrice(zonesFrom)}` : ''}`
                        : `${s.durationMinutes} min · ${formatPrice(s.priceCents)}`}
                    </span>
                  </span>
                  <span aria-hidden="true" className="cw-chevron">
                    ›
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </main>
  )
}

function ZoneStep({
  service,
  line,
  selected,
  onToggle,
  onNext,
}: {
  service: CatalogService
  line: Line | null
  selected: string[]
  onToggle: (id: string) => void
  onNext: () => void
}) {
  const zones = zonesForLine(service, line)
  const totals = visitTotals(service, selected)
  const single = service.variantSelection === 'uma'
  return (
    <>
      <main className="cw-main cw-flush">
        <p className="cw-muted cw-margin">
          {service.name}. {single ? 'Escolha uma.' : 'Escolha uma ou mais. A duração e o preço somam.'}
        </p>
        <fieldset className="cw-fieldset">
          <legend className="cw-sr">{service.variantKindPlural ?? 'Opções'}</legend>
          {zones.map((z) => (
            <label key={z.id} className={`cw-check-row${selected.includes(z.id) ? ' is-on' : ''}`}>
              <input
                type={single ? 'radio' : 'checkbox'}
                name="zona"
                checked={selected.includes(z.id)}
                onChange={() => onToggle(z.id)}
              />
              <span className="cw-row-title">{z.name}</span>
              <span className="cw-muted">
                {z.durationMinutes} min · {formatPrice(z.priceCents)}
              </span>
            </label>
          ))}
        </fieldset>
      </main>
      <footer className="cw-bar">
        <div role="status" className="cw-bar-sum">
          <span className="cw-muted">
            {selected.length} {selected.length === 1 ? 'opção' : 'opções'} · {totals.minutes} min
          </span>
          <strong>{formatPrice(totals.priceCents)}</strong>
        </div>
        <button type="button" className="cw-btn cw-btn-primary" disabled={selected.length === 0} onClick={onNext}>
          Ver horários
        </button>
      </footer>
    </>
  )
}

function TimeStep({
  catalog,
  service,
  zoneIds,
  weekStart,
  setWeekStart,
  day,
  setDay,
  notice,
  onPick,
  onSessionLost,
}: {
  catalog: Catalog
  service: CatalogService
  zoneIds: string[]
  weekStart: string
  setWeekStart: (d: string) => void
  day: string | null
  setDay: (d: string | null) => void
  notice: string | null
  onPick: (s: Slot) => void
  onSessionLost: () => void
}) {
  const [slots, setSlots] = useState<Slot[] | 'loading' | 'error'>('loading')
  const days = useMemo(() => weekDays(weekStart, catalog.today, catalog.horizonDays), [weekStart, catalog])
  const [retry, setRetry] = useState(0)

  useEffect(() => {
    let cancelled = false
    setSlots('loading')
    void fetchSlots({
      serviceId: service.id,
      variantIds: zoneIds,
      from: days[0] ?? weekStart,
      to: days[days.length - 1] ?? weekStart,
    }).then((res) => {
      if (cancelled) return
      if (res.kind === 'unauthorized') return onSessionLost()
      if (res.kind === 'error') return setSlots('error')
      setSlots(res.slots)
      const first = res.slots[0]?.date ?? null
      setDay(day && res.slots.some((s) => s.date === day) ? day : first)
    })
    return () => {
      cancelled = true
    }
    // `day` fica de fora de propósito: só reescolhe o dia quando a semana ou o pedido mudam.
  }, [service.id, zoneIds, weekStart, retry, onSessionLost])

  const daySlots = Array.isArray(slots) ? slots.filter((s) => s.date === day) : []
  const parts = (['Manhã', 'Tarde', 'Noite'] as DayPart[])
    .map((p) => ({ part: p, items: daySlots.filter((s) => dayPart(s.time) === p) }))
    .filter((g) => g.items.length > 0)
  const withSlots = new Set(Array.isArray(slots) ? slots.map((s) => s.date) : [])
  const month = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(`${weekStart}T00:00:00Z`),
  )

  return (
    <main className="cw-main cw-flush">
      <p className="cw-muted cw-margin">
        {service.name} · {visitTotals(service, zoneIds).minutes} min
      </p>
      {notice && (
        <p role="alert" className="cw-alert cw-margin">
          {notice}
        </p>
      )}
      <div className="cw-week-nav cw-margin">
        <span className="cw-month">{month}</span>
        <button
          type="button"
          className="cw-icon-btn"
          aria-label="Semana anterior"
          disabled={!canGoPrevWeek(weekStart, catalog.today)}
          onClick={() => setWeekStart(prevWeekStart(weekStart, catalog.today))}
        >
          ‹
        </button>
        <button
          type="button"
          className="cw-icon-btn"
          aria-label="Próxima semana"
          disabled={!canGoNextWeek(weekStart, catalog.today, catalog.horizonDays)}
          onClick={() => setWeekStart(addDays(weekStart, 7))}
        >
          ›
        </button>
      </div>
      <div role="group" aria-label="Dia" className="cw-days cw-margin">
        {days.map((d) => {
          const l = civilDayLabel(d)
          const free = withSlots.has(d)
          return (
            <button
              key={d}
              type="button"
              className={`cw-day${d === day ? ' is-on' : ''}`}
              aria-pressed={d === day}
              disabled={!free}
              aria-label={`${l.weekday} ${l.dayMonth}${free ? '' : ', sem horários'}`}
              onClick={() => setDay(d)}
            >
              <span className="cw-caption">{l.weekday}</span>
              <strong>{l.short}</strong>
            </button>
          )
        })}
      </div>
      {slots === 'loading' && (
        <p role="status" className="cw-muted cw-margin">
          A procurar horários…
        </p>
      )}
      {slots === 'error' && (
        <div className="cw-margin">
          <p role="alert" className="cw-alert">
            Não foi possível carregar os horários.
          </p>
          <button type="button" className="cw-btn cw-btn-secondary" onClick={() => setRetry((n) => n + 1)}>
            Tentar outra vez
          </button>
        </div>
      )}
      {Array.isArray(slots) && slots.length === 0 && (
        <p role="status" className="cw-note cw-margin">
          Sem horários livres nesta semana. Veja a semana seguinte ou fale com a equipe pelo WhatsApp.
        </p>
      )}
      {parts.map((g) => (
        <section key={g.part} aria-label={g.part} className="cw-margin cw-part">
          <h2 className="cw-caption-title">{g.part}</h2>
          <div className="cw-times">
            {g.items.map((s) => (
              <button key={s.id} type="button" className="cw-time" onClick={() => onPick(s)}>
                {s.time}
              </button>
            ))}
          </div>
        </section>
      ))}
      {Array.isArray(slots) && slots.length > 0 && <p className="cw-muted cw-margin">Nada fica marcado antes de Confirmar.</p>}
    </main>
  )
}

function Review({
  service,
  zoneIds,
  line,
  slot,
  onChange,
  onResult,
  onSessionLost,
}: {
  service: CatalogService
  zoneIds: string[]
  line: Line | null
  slot: Slot
  onChange: () => void
  onResult: (r: Outcome | 'slot_taken') => void
  onSessionLost: () => void
}) {
  const [sending, setSending] = useState(false)
  const totals = visitTotals(service, zoneIds)
  const zones = service.zones.filter((z) => zoneIds.includes(z.id))
  const label = civilDayLabel(slot.date)

  async function confirm() {
    if (sending) return
    setSending(true)
    const res = await bookSlot({ serviceId: service.id, variantIds: zoneIds, line, slotId: slot.id })
    if (res === 'unauthorized') return onSessionLost()
    if (res === 'error') {
      setSending(false)
      return onResult('error')
    }
    if (res.status === 'booked') return onResult('booked')
    if (res.status === 'pix_signal') return onResult('pix_signal')
    if (res.status === 'slot_taken') return onResult('slot_taken')
    if (res.status === 'paused') return onResult('paused')
    return onResult('error')
  }

  return (
    <>
      <main className="cw-main">
        <p className="cw-note">Esta página não pede pagamento nem senha.</p>
        <dl className="cw-dl">
          <div><dt>Serviço</dt><dd>{service.name}</dd></div>
          {zones.length > 0 && (
            <div><dt>{service.variantKindPlural ?? 'Opções'}</dt><dd>{zones.map((z) => z.name).join(', ')}</dd></div>
          )}
          <div><dt>Quando</dt><dd>{label.weekday} {label.dayMonth}, {slot.time}</dd></div>
          <div><dt>Duração</dt><dd>{totals.minutes} min</dd></div>
          <div><dt>Preço</dt><dd>{formatPrice(totals.priceCents)}</dd></div>
        </dl>
        <p className="cw-notice" role="note">
          {service.requiresSignal
            ? 'Este serviço pede um sinal. O Pix chega no WhatsApp e o horário só fica reservado depois do pagamento.'
            : 'Esta proposta vale por 30 min.'}
        </p>
        <p className="cw-caption">Ao confirmar, você marca este horário. Isto não é consentimento para outros usos dos seus dados.</p>
      </main>
      <footer className="cw-bar cw-bar-col">
        <button type="button" className="cw-btn cw-btn-primary" disabled={sending} onClick={() => void confirm()}>
          {sending ? 'A confirmar…' : 'Confirmar'}
        </button>
        <button type="button" className="cw-btn cw-btn-text" disabled={sending} onClick={onChange}>
          Alterar
        </button>
      </footer>
    </>
  )
}

function Done({ outcome, slot, onExit }: { outcome: Outcome; slot: Slot | null; onExit: () => void }) {
  const label = slot ? civilDayLabel(slot.date) : null
  const copy: Record<Outcome, { title: string; body: string; tone: 'ok' | 'warn' }> = {
    booked: {
      title: 'Horário marcado',
      body: 'Enviamos um recibo no seu WhatsApp. Se não foi você quem marcou, toque em «Falar com a equipe» na mensagem.',
      tone: 'ok',
    },
    pix_signal: {
      title: 'Falta só o sinal',
      body: 'Enviamos o Pix no seu WhatsApp. O horário fica reservado depois do pagamento.',
      tone: 'ok',
    },
    paused: {
      title: 'A equipe atende por aqui',
      body: 'Neste momento a marcação automática está em pausa. Fale com a equipe no WhatsApp para marcar.',
      tone: 'warn',
    },
    error: {
      title: 'Não foi possível confirmar',
      body: 'Nada foi marcado. Tente outra vez ou fale com a equipe no WhatsApp.',
      tone: 'warn',
    },
  }
  const c = copy[outcome]
  return (
    <main className="cw-main cw-center" role="status">
      <span className={`cw-icon ${c.tone === 'ok' ? 'cw-icon-ok' : 'cw-icon-warning'}`} aria-hidden="true">
        {c.tone === 'ok' ? '✓' : '!'}
      </span>
      <h1 className="cw-title">{c.title}</h1>
      {label && slot && outcome === 'booked' && (
        <p className="cw-row-title">
          {label.weekday} {label.dayMonth}, {slot.time}
        </p>
      )}
      <p className="cw-body">{c.body}</p>
      <button type="button" className="cw-btn cw-btn-primary" onClick={onExit}>
        Ver minhas marcações
      </button>
    </main>
  )
}
