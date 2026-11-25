import { useCallback, useEffect, useRef, useState } from 'react'
import type { Catalog, CatalogProfessional, EmptyDay, PickPage, PickQuery, PickResult, PickWhen, Slot, SlotsResult } from './api'
import { AskTimeSheet } from './AskTimeSheet'
import { CalendarSheet } from './CalendarSheet'
import { addDays, civilDayLabel, nextFreeWhen, pickHeading } from './booking-model'

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

type Part = 'manha' | 'tarde' | 'noite'
const PART_LABEL: Record<Part, string> = { manha: 'Manhã', tarde: 'Tarde', noite: 'Noite' }
const partOf = (time: string): Part => (time < '12:00' ? 'manha' : time < '18:00' ? 'tarde' : 'noite')

/** Dias da faixa: hoje e os 6 seguintes (o resto está em «Outra data»). */
const STRIP_DAYS = 7

function whenKey(w: PickWhen | null): string {
  return w == null ? 'auto' : typeof w === 'string' ? w : `date:${w.date}:${w.dayPart ?? ''}`
}

/**
 * Passo «Quando?» (DEC-227, Proposto): faixa de dias, 3 horas sugeridas pelo servidor (marcações
 * confirmadas atraem as seguintes; hora pedida primeiro) e uma fila curada do dia que se desliza na
 * horizontal. O servidor nunca envia a agenda completa; «Outra hora?» pergunta uma hora pontual.
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
  const [days, setDays] = useState<{ slotDates: Set<string>; empty: EmptyDay[] } | null>(null)
  const [retry, setRetry] = useState(0)
  const [calendarOpen, setCalendarOpen] = useState(false)
  const [askOpen, setAskOpen] = useState(false)
  const [activePart, setActivePart] = useState<Part | null>(null)
  const railRef = useRef<HTMLDivElement | null>(null)
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

  // Faixa de dias: só diz quais dias têm vaga (sem contar quantas).
  useEffect(() => {
    let cancelled = false
    void loadDaysRef.current(catalog.today, addDays(catalog.today, STRIP_DAYS - 1)).then((res) => {
      if (cancelled || res.kind !== 'ok') return
      setDays({ slotDates: new Set(res.slots.map((x) => x.date)), empty: res.emptyDays })
    })
    return () => {
      cancelled = true
    }
  }, [depsKey, catalog.today, retry])

  useEffect(() => {
    let cancelled = false
    setPage('loading')
    void pickRef
      .current({ when: when ?? 'agora', requestedTime })
      .then((res) => {
        if (cancelled) return
        if (res.kind === 'unauthorized') return onSessionLost()
        if (res.kind === 'error') return setPage('error')
        // Sem conveniência pedida e «Agora» vazio: salta para o primeiro dia com vaga.
        if (when == null && res.slots.length === 0 && res.nextAvailable) return setWhen({ date: res.nextAvailable.date })
        setPage(res)
      })
    return () => {
      cancelled = true
    }
    // `when` e a hora pedida são o pedido; `retry` refaz depois de um erro.
  }, [depsKey, whenKey(when), requestedTime, retry, onSessionLost])

  const done = typeof page === 'object' ? page : null
  const shown = done?.slots ?? []
  const rail = done?.rail ?? []
  const firstSuggested = shown[0]?.time ?? null

  // A fila abre já posicionada na primeira hora sugerida.
  useEffect(() => {
    const el = railRef.current
    if (!el || !firstSuggested) return
    const target = el.querySelector<HTMLElement>(`[data-time="${firstSuggested}"]`)
    if (target) el.scrollLeft = Math.max(0, target.offsetLeft - 16)
    setActivePart(partOf(firstSuggested))
  }, [done?.date, firstSuggested])

  function onRailScroll() {
    const el = railRef.current
    if (!el) return
    let cur: Part | null = null
    el.querySelectorAll<HTMLElement>('[data-first]').forEach((n) => {
      if (n.offsetLeft - 16 <= el.scrollLeft + 40) cur = n.dataset.first as Part
    })
    if (cur && cur !== activePart) setActivePart(cur)
  }

  function jumpTo(part: Part) {
    const el = railRef.current
    const target = el?.querySelector<HTMLElement>(`[data-first="${part}"]`)
    if (!el || !target) return
    el.scrollTo?.({ left: Math.max(0, target.offsetLeft - 16), behavior: 'smooth' })
    setActivePart(part)
  }

  const showPref = professionals.length > 1 && onPreferredProfessionalChange
  const selectedDate = done?.date ?? null
  const dateChoice = when != null && typeof when !== 'string' ? when.date : null
  const stripDates = Array.from({ length: STRIP_DAYS }, (_, i) => addDays(catalog.today, i)).filter((d) => {
    if (!days) return d === catalog.today
    return days.slotDates.has(d) || days.empty.some((e) => e.date === d && e.reason === 'full')
  })
  const outsideStrip = selectedDate != null && !stripDates.includes(selectedDate) ? selectedDate : null
  const railParts = new Set(rail.map((r) => partOf(r.time)))
  const suggestedIds = new Set(shown.map((x) => x.id))

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
          Dia
        </p>
        <div className="cw-days" role="group" aria-labelledby="cw-when-label">
          {stripDates.map((d) => {
            const label = civilDayLabel(d)
            const full = days?.empty.some((e) => e.date === d && e.reason === 'full') && !days.slotDates.has(d)
            const on = selectedDate === d
            return (
              <button
                key={d}
                type="button"
                aria-pressed={on}
                aria-disabled={full || undefined}
                className={`cw-day${on ? ' is-on' : ''}${full ? ' is-full' : ''}`}
                onClick={() => {
                  if (full) return
                  setRequestedTime(null)
                  setWhen({ date: d })
                }}
              >
                <span className="cw-day-wd">{d === catalog.today ? 'Hoje' : d === addDays(catalog.today, 1) ? 'Amanhã' : label.weekday}</span>
                <span className="cw-day-num">{label.short}</span>
                <span className="cw-day-note">{full ? 'cheio' : ''}</span>
              </button>
            )
          })}
          {outsideStrip && (
            <button type="button" aria-pressed="true" className="cw-day is-on" onClick={() => setCalendarOpen(true)}>
              <span className="cw-day-wd">{civilDayLabel(outsideStrip).weekday}</span>
              <span className="cw-day-num">{civilDayLabel(outsideStrip).short}</span>
              <span className="cw-day-note" />
            </button>
          )}
          <button
            type="button"
            aria-haspopup="dialog"
            aria-expanded={calendarOpen}
            className="cw-day cw-day-other"
            onClick={() => setCalendarOpen(true)}
          >
            <span className="cw-day-num" aria-hidden="true">
              ▦
            </span>
            Outra data
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
      {done && shown.length > 0 && (
        <section className="cw-margin cw-rail-block" aria-labelledby="cw-rail-title">
          <h2 id="cw-rail-title" className="cw-caption-title">
            Outros horários
          </h2>
          <div className="cw-parts" role="group" aria-label="Ir para o período">
            {(['manha', 'tarde', 'noite'] as const).map((part) => (
              <button
                key={part}
                type="button"
                aria-pressed={activePart === part}
                disabled={!railParts.has(part)}
                className={`cw-pref-chip${activePart === part ? ' is-on' : ''}`}
                onClick={() => jumpTo(part)}
              >
                {PART_LABEL[part]}
              </button>
            ))}
          </div>
        </section>
      )}
      {done && shown.length > 0 && (
        <div className="cw-rail-wrap">
          <div ref={railRef} className="cw-rail" role="group" aria-labelledby="cw-rail-title" onScroll={onRailScroll}>
            {rail.map((s, i) => {
              const part = partOf(s.time)
              const first = i === 0 || partOf(rail[i - 1]!.time) !== part
              return (
                <div key={s.id} className="cw-rail-item" data-time={s.time} data-first={first ? part : undefined}>
                  <span className="cw-rail-head">{first ? PART_LABEL[part] : ''}</span>
                  <button type="button" className={`cw-time${suggestedIds.has(s.id) ? ' is-suggested' : ''}`} onClick={() => onPick(s)}>
                    {s.time}
                  </button>
                </div>
              )
            })}
            <div className="cw-rail-item cw-rail-ask">
              <span className="cw-rail-head" />
              <button type="button" className="cw-time cw-time-ask" aria-haspopup="dialog" onClick={() => setAskOpen(true)}>
                Outra hora?
              </button>
            </div>
          </div>
        </div>
      )}
      {done && shown.length === 0 && (
        <div className="cw-empty-pick cw-margin" role="status">
          <p className="cw-empty-pick-title">{emptyCopy(done.emptyReason)}</p>
          {done.nextAvailable && (
            <button type="button" className="cw-btn cw-btn-secondary" onClick={() => onPick(done.nextAvailable!)}>
              Próximo livre: {nextFreeWhen(done.nextAvailable.date, catalog.today)}, {done.nextAvailable.time}
            </button>
          )}
          <p className="cw-muted">Nenhum serve? Fale com a equipe no WhatsApp.</p>
        </div>
      )}
      {done && <p className="cw-muted cw-margin">Nada fica marcado antes de Confirmar.</p>}
      {askOpen && selectedDate && (
        <AskTimeSheet
          dayLabel={pickHeading(selectedDate, catalog.today)}
          when={{ date: selectedDate }}
          pick={pick}
          onSessionLost={onSessionLost}
          onClose={() => setAskOpen(false)}
          onChoose={(slot) => {
            setAskOpen(false)
            onPick(slot)
          }}
        />
      )}
      {calendarOpen && (
        <CalendarSheet
          catalog={catalog}
          selected={dateChoice}
          loadDays={stableLoadDays}
          onSessionLost={onSessionLost}
          onClose={() => setCalendarOpen(false)}
          onPick={(date, wish) => {
            setCalendarOpen(false)
            setRequestedTime(wish.requestedTime)
            setWhen({ date, dayPart: wish.dayPart })
          }}
        />
      )}
    </main>
  )
}
