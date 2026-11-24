import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Catalog, CatalogProfessional, PickChips, PickPage, PickQuery, PickResult, PickWhen, Slot, SlotsResult } from './api'
import { CalendarSheet } from './CalendarSheet'
import { civilDayLabel, nextFreeWhen, pickHeading } from './booking-model'

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0]!.slice(0, 2)
  return `${parts[0]![0] ?? ''}${parts[1]![0] ?? ''}`.toUpperCase()
}

function emptyCopy(reason: PickPage['emptyReason']): string {
  if (reason === 'closed') return 'A clínica está fechada neste dia.'
  if (reason === 'past') return 'Esse período já passou.'
  return 'Sem horários nesta altura.'
}

type Preset = 'agora' | 'hoje_manha' | 'hoje_tarde' | 'amanha'

const CHIPS: Array<{ id: Preset; label: string; chip?: keyof PickChips }> = [
  { id: 'agora', label: 'Agora', chip: 'agora' },
  { id: 'hoje_manha', label: 'Hoje de manhã', chip: 'hojeManha' },
  { id: 'hoje_tarde', label: 'Hoje à tarde', chip: 'hojeTarde' },
  { id: 'amanha', label: 'Amanhã' },
]

function whenKey(w: PickWhen | null): string {
  return w == null ? 'auto' : typeof w === 'string' ? w : `date:${w.date}:${w.dayPart ?? ''}`
}

/**
 * Passo «Quando?» (DEC-227, Proposto): «Quando prefere?» e até 3 horas escolhidas pelo servidor
 * (marcações confirmadas atraem as seguintes; hora pedida primeiro). Nunca mostra a grade do dia.
 */
export function TimeStep({
  catalog,
  subtitle,
  depsKey,
  pick,
  loadDays,
  notice,
  onPick,
  onSessionLost,
  initialWhen = null,
  professionals = [],
  preferredProfessionalId = null,
  onPreferredProfessionalChange,
}: {
  catalog: Catalog
  /** Linha por baixo do título: serviço e duração. */
  subtitle: string
  /** Muda quando o pedido muda (serviço, zonas, marcação, preferência): volta ao início. */
  depsKey: string
  pick: (q: PickQuery) => Promise<PickResult>
  /** Calendário do mês: primeira hora de cada dia do horizonte. */
  loadDays: (from: string, to: string) => Promise<SlotsResult>
  notice: string | null
  onPick: (s: Slot) => void
  onSessionLost: () => void
  /** Conveniência pedida no chat; null = a primeira com vaga. */
  initialWhen?: PickWhen | null
  /** DEC-218: profissionais do serviço; com 0–1 o bloco «Quem prefere?» esconde-se. */
  professionals?: CatalogProfessional[]
  /** null = Sem preferência. */
  preferredProfessionalId?: string | null
  onPreferredProfessionalChange?: (id: string | null) => void
}) {
  const [when, setWhen] = useState<PickWhen | null>(initialWhen)
  const [requestedTime, setRequestedTime] = useState<string | null>(null)
  const [page, setPage] = useState<PickPage | 'loading' | 'error'>('loading')
  const [shown, setShown] = useState<Slot[]>([])
  const [chips, setChips] = useState<PickChips | null>(null)
  const [more, setMore] = useState<'idle' | 'loading'>('idle')
  const [retry, setRetry] = useState(0)
  const [calendarOpen, setCalendarOpen] = useState(false)
  const pickRef = useRef(pick)
  pickRef.current = pick
  const loadDaysRef = useRef(loadDays)
  loadDaysRef.current = loadDays
  const stableLoadDays = useCallback((from: string, to: string) => loadDaysRef.current(from, to), [])
  const seenDeps = useRef(depsKey)

  // O pedido mudou (outro serviço, zonas, preferência): recomeça pela primeira conveniência com vaga.
  useEffect(() => {
    if (seenDeps.current === depsKey) return
    seenDeps.current = depsKey
    setWhen(initialWhen)
    setRequestedTime(null)
  }, [depsKey, initialWhen])

  useEffect(() => {
    let cancelled = false
    setPage('loading')
    void pickRef
      .current({ when: when ?? 'agora', requestedTime, offset: 0, wantChips: true })
      .then((res) => {
        if (cancelled) return
        if (res.kind === 'unauthorized') return onSessionLost()
        if (res.kind === 'error') return setPage('error')
        setChips(res.chips)
        if (when == null) {
          // Sem conveniência pedida: «Agora» se houver vaga, senão a primeira que tiver.
          const c = res.chips
          const fallback: Preset = !c || c.agora ? 'agora' : c.hojeManha ? 'hoje_manha' : c.hojeTarde ? 'hoje_tarde' : 'amanha'
          if (fallback !== 'agora') return setWhen(fallback)
          setWhen('agora')
        }
        setShown(res.slots)
        setPage(res)
      })
    return () => {
      cancelled = true
    }
    // `when` e a hora pedida são o pedido; `retry` refaz depois de um erro.
  }, [depsKey, whenKey(when), requestedTime, retry, onSessionLost])

  async function loadMore() {
    if (page === 'loading' || page === 'error' || more === 'loading') return
    setMore('loading')
    const res = await pickRef.current({ when: when ?? 'agora', requestedTime, offset: shown.length })
    setMore('idle')
    if (res.kind === 'unauthorized') return onSessionLost()
    if (res.kind === 'error') return
    setShown((cur) => [...cur, ...res.slots.filter((s) => !cur.some((c) => c.id === s.id))])
    setPage({ ...page, hasMore: res.hasMore })
  }

  const showPref = professionals.length > 1 && onPreferredProfessionalChange
  const selectedPreset = typeof when === 'string' ? when : null
  const dateChoice = when != null && typeof when !== 'string' ? when.date : null
  const visibleChips = useMemo(
    () => CHIPS.filter((c) => !c.chip || !chips || chips[c.chip] || selectedPreset === c.id),
    [chips, selectedPreset],
  )
  const done = typeof page === 'object' ? page : null

  return (
    <main className="cw-main cw-flush">
      <p className="cw-muted cw-margin">{subtitle}</p>
      {showPref && (
        <div className="cw-pref cw-margin">
          <p className="cw-pref-label" id="cw-pref-label">
            Quem prefere?
          </p>
          <div className="cw-pref-chips" role="radiogroup" aria-labelledby="cw-pref-label">
            <button
              type="button"
              role="radio"
              aria-checked={preferredProfessionalId == null}
              className={`cw-pref-chip${preferredProfessionalId == null ? ' is-on' : ''}`}
              onClick={() => onPreferredProfessionalChange(null)}
            >
              Sem preferência
            </button>
            {professionals.map((p) => (
              <button
                key={p.id}
                type="button"
                role="radio"
                aria-checked={preferredProfessionalId === p.id}
                className={`cw-pref-chip${preferredProfessionalId === p.id ? ' is-on' : ''}`}
                onClick={() => onPreferredProfessionalChange(p.id)}
              >
                <span className="cw-pref-av" aria-hidden="true">
                  {initials(p.name)}
                </span>
                {p.name}
              </button>
            ))}
          </div>
        </div>
      )}
      {notice && (
        <p role="alert" className="cw-alert cw-margin">
          {notice}
        </p>
      )}
      <div className="cw-pref cw-when cw-margin">
        <p className="cw-pref-label" id="cw-when-label">
          Quando prefere?
        </p>
        <div className="cw-pref-chips" role="group" aria-labelledby="cw-when-label" style={{ flexWrap: 'wrap' }}>
          {visibleChips.map((c) => (
            <button
              key={c.id}
              type="button"
              aria-pressed={selectedPreset === c.id}
              className={`cw-pref-chip${selectedPreset === c.id ? ' is-on' : ''}`}
              onClick={() => {
                setRequestedTime(null)
                setWhen(c.id)
              }}
            >
              {c.label}
            </button>
          ))}
          <button
            type="button"
            aria-pressed={dateChoice != null}
            aria-haspopup="dialog"
            aria-expanded={calendarOpen}
            className={`cw-pref-chip${dateChoice != null ? ' is-on' : ''}`}
            onClick={() => setCalendarOpen(true)}
          >
            {dateChoice ? `${civilDayLabel(dateChoice).weekday} ${civilDayLabel(dateChoice).dayMonth}` : 'Outra data'}
          </button>
        </div>
      </div>
      {page === 'loading' && (
        <p role="status" className="cw-muted cw-margin">
          A procurar horários…
        </p>
      )}
      {page === 'error' && (
        <div className="cw-margin">
          <p role="alert" className="cw-alert">
            Não foi possível carregar os horários.
          </p>
          <button type="button" className="cw-btn cw-btn-secondary" onClick={() => setRetry((n) => n + 1)}>
            Tentar outra vez
          </button>
        </div>
      )}
      {done && done.earliestPossible && shown.length > 0 && (
        <p role="status" className="cw-lead-note cw-margin">
          O mais cedo possível é às {done.earliestPossible}.
        </p>
      )}
      {done && shown.length > 0 && (
        <section className="cw-margin" aria-labelledby="cw-pick-title">
          <h2 id="cw-pick-title" className="cw-caption-title">
            {pickHeading(done.date, catalog.today)}
          </h2>
          <div className="cw-times cw-times-pick">
            {shown.map((s) => (
              <button key={s.id} type="button" className="cw-time" onClick={() => onPick(s)}>
                {s.time}
              </button>
            ))}
          </div>
        </section>
      )}
      {done && shown.length > 0 && done.hasMore && (
        <button type="button" className="cw-more cw-margin" disabled={more === 'loading'} onClick={() => void loadMore()}>
          Outros horários <span aria-hidden="true">▾</span>
        </button>
      )}
      {done && shown.length === 0 && (
        <div className="cw-empty-pick cw-margin" role="status">
          <p className="cw-empty-pick-title">{emptyCopy(done.emptyReason)}</p>
          {done.nextAvailable && (
            <button type="button" className="cw-btn cw-btn-secondary" onClick={() => onPick(done.nextAvailable!)}>
              Próximo livre: {nextFreeWhen(done.nextAvailable.date, catalog.today)}, {done.nextAvailable.time}
            </button>
          )}
        </div>
      )}
      {done && <p className="cw-muted cw-margin">Nada fica marcado antes de Confirmar.</p>}
      {calendarOpen && (
        <CalendarSheet
          catalog={catalog}
          selected={dateChoice}
          loadDays={stableLoadDays}
          onSessionLost={onSessionLost}
          onClose={() => setCalendarOpen(false)}
          onPick={(date, time) => {
            setCalendarOpen(false)
            setRequestedTime(time)
            setWhen({ date })
          }}
        />
      )}
    </main>
  )
}
