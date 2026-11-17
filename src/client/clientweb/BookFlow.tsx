import { useEffect, useState } from 'react'
import {
  bookSlot,
  fetchCatalog,
  fetchSlots,
  type Catalog,
  type CatalogService,
  type Line,
  type Slot,
} from './api'
import { catalogNeedsLine, civilDayLabel, formatPrice, servicesForLine, visitTotals, zonesForLine } from './booking-model'
import { TimeStep } from './TimeStep'
import { Highlight } from './Highlight'
import { searchCatalog, filterZones } from './search-model'

type Step = 'line' | 'service' | 'zones' | 'time' | 'review' | 'done'
type Outcome = 'booked' | 'pix_signal' | 'paused' | 'error'

type Props = {
  clinicName: string
  /** Serviço reconhecido no chat (DEC-202): a página abre nele, se estiver ativo. */
  initialServiceId?: string | null
  onExit: () => void
  onSessionLost: () => void
}

export function BookFlow({ clinicName, initialServiceId = null, onExit, onSessionLost }: Props) {
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
      const preset = initialServiceId ? res.services.find((s) => s.id === initialServiceId) : undefined
      if (preset && preset.audience === 'qualquer' && preset.zones.every((z) => z.audience === 'ambos')) {
        // Serviço que não depende de género: salta a lista (zonas, se houver, ou horário).
        setService(preset)
        setStep(preset.zones.length > 0 ? 'zones' : 'time')
        return
      }
      setStep(catalogNeedsLine(res) ? 'line' : 'service')
    })
    return () => {
      cancelled = true
    }
  }, [onSessionLost, initialServiceId])

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

  function chooseService(s: CatalogService, preselectZoneId?: string) {
    setService(s)
    setZoneIds(preselectZoneId ? [preselectZoneId] : [])
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
          subtitle={`${service.name} · ${visitTotals(service, zoneIds).minutes} min`}
          depsKey={`${service.id}:${zoneIds.join(',')}`}
          load={(from, to) => fetchSlots({ serviceId: service.id, variantIds: zoneIds, from, to })}
          loadDays={(from, to) => fetchSlots({ serviceId: service.id, variantIds: zoneIds, from, to, daysOnly: true })}
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

function SearchField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="cw-search">
      <span aria-hidden="true" className="cw-search-icon">
        ⌕
      </span>
      <input
        type="search"
        className="cw-search-input"
        aria-label={label}
        placeholder={label}
        value={value}
        autoComplete="off"
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
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
  onPick: (s: CatalogService, preselectZoneId?: string) => void
  onChangeLine: (() => void) | null
}) {
  const [query, setQuery] = useState('')
  const services = servicesForLine(catalog, line)
  const q = query.trim()
  const result = q ? searchCatalog(catalog, services, line, q) : null
  return (
    <main className="cw-main cw-flush">
      <div className="cw-search-wrap">
        <SearchField label="Procurar serviço ou zona" value={query} onChange={setQuery} />
        {onChangeLine && (
          <div className="cw-line-inline">
            <span>{line === 'feminino' ? 'Feminino' : line === 'masculino' ? 'Masculino' : 'Para quem é?'}</span>
            <button type="button" className="cw-link" onClick={onChangeLine}>
              Trocar
            </button>
            {result && (
              <span role="status" className="cw-results-count">
                {result.count} {result.count === 1 ? 'resultado' : 'resultados'}
              </span>
            )}
          </div>
        )}
        {!onChangeLine && result && (
          <span role="status" className="cw-results-count">
            {result.count} {result.count === 1 ? 'resultado' : 'resultados'}
          </span>
        )}
      </div>
      {result ? (
        result.groups.length === 0 ? (
          <div role="status" className="cw-empty">
            <h2 className="cw-title">Nada encontrado para «{q}»</h2>
            <p className="cw-body">Pode ser um serviço que não se marca por aqui. A equipe responde no WhatsApp.</p>
            <button type="button" className="cw-btn cw-btn-secondary" onClick={() => setQuery('')}>
              Ver todos os serviços
            </button>
          </div>
        ) : (
          <nav aria-label="Resultados" className="cw-rows">
            {result.groups.map((g) => (
              <section key={g.service.id} aria-label={g.service.name}>
                <h2 className="cw-group-title">{g.service.name}</h2>
                {g.serviceMatched && (
                  <button type="button" className="cw-row" onClick={() => onPick(g.service)}>
                    <span className="cw-row-main">
                      <span className="cw-row-title">
                        <Highlight text={g.service.name} query={q} />
                      </span>
                      <span className="cw-muted">
                        {g.service.zones.length > 0
                          ? `${g.service.variantKindPlural ?? 'Opções'} à escolha`
                          : `${g.service.durationMinutes} min · ${formatPrice(g.service.priceCents)}`}
                      </span>
                    </span>
                    <span aria-hidden="true" className="cw-chevron">
                      ›
                    </span>
                  </button>
                )}
                {g.zones.map((z) => (
                  <button key={z.id} type="button" className="cw-row" onClick={() => onPick(g.service, z.id)}>
                    <span className="cw-row-main">
                      <span className="cw-row-title">
                        <Highlight text={z.name} query={q} />
                      </span>
                      <span className="cw-muted">
                        {g.service.variantKind ?? 'Zona'} · {z.durationMinutes} min · {formatPrice(z.priceCents)}
                      </span>
                    </span>
                    <span aria-hidden="true" className="cw-chevron">
                      ›
                    </span>
                  </button>
                ))}
              </section>
            ))}
            <p className="cw-muted cw-margin cw-pad">Resultados agrupados pelo serviço. Tocar numa zona abre a escolha de zonas com ela já marcada.</p>
          </nav>
        )
      ) : services.length === 0 ? (
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
  const [zoneQuery, setZoneQuery] = useState('')
  const allZones = zonesForLine(service, line)
  const zones = filterZones(allZones, zoneQuery)
  const totals = visitTotals(service, selected)
  const single = service.variantSelection === 'uma'
  return (
    <>
      <main className="cw-main cw-flush">
        <p className="cw-muted cw-margin">
          {service.name}. {single ? 'Escolha uma.' : 'Escolha uma ou mais. A duração e o preço somam.'}
        </p>
        <div className="cw-search-wrap">
          <SearchField label={`Procurar ${(service.variantKind ?? 'opção').toLowerCase()}`} value={zoneQuery} onChange={setZoneQuery} />
        </div>
        {zones.length === 0 && (
          <p role="status" className="cw-note cw-margin">
            Nada encontrado para «{zoneQuery.trim()}».
          </p>
        )}
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
              <span className="cw-row-title">
                <Highlight text={z.name} query={zoneQuery} />
              </span>
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
