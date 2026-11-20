import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Catalog, CatalogProfessional, Slot, SlotsResult } from './api'
import { CalendarSheet } from './CalendarSheet'
import {
  addDays,
  canGoNextWeek,
  canGoPrevWeek,
  civilDayLabel,
  dayPart,
  prevWeekStart,
  weekDays,
  type DayPart,
} from './booking-model'

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0]!.slice(0, 2)
  return `${parts[0]![0] ?? ''}${parts[1]![0] ?? ''}`.toUpperCase()
}

export function TimeStep({
  catalog,
  subtitle,
  depsKey,
  load,
  loadDays,
  weekStart,
  setWeekStart,
  day,
  setDay,
  notice,
  onPick,
  onSessionLost,
  preferredDayPart = null,
  professionals = [],
  preferredProfessionalId = null,
  onPreferredProfessionalChange,
}: {
  catalog: Catalog
  /** Linha por baixo do título: serviço e duração. */
  subtitle: string
  /** Muda quando o pedido de horas muda (serviço, zonas, marcação, preferência). */
  depsKey: string
  load: (from: string, to: string) => Promise<SlotsResult>
  /** Calendário do mês: primeira hora de cada dia do horizonte. */
  loadDays: (from: string, to: string) => Promise<SlotsResult>
  weekStart: string
  setWeekStart: (d: string) => void
  day: string | null
  setDay: (d: string | null) => void
  notice: string | null
  onPick: (s: Slot) => void
  onSessionLost: () => void
  /** Período pedido no chat: mostra-o primeiro. */
  preferredDayPart?: DayPart | null
  /** DEC-218: profissionais do serviço; com 0–1 o bloco «Quem prefere?» esconde-se. */
  professionals?: CatalogProfessional[]
  /** null = Sem preferência. */
  preferredProfessionalId?: string | null
  onPreferredProfessionalChange?: (id: string | null) => void
}) {
  const [slots, setSlots] = useState<Slot[] | 'loading' | 'error'>('loading')
  const days = useMemo(() => weekDays(weekStart, catalog.today, catalog.horizonDays), [weekStart, catalog])
  const [retry, setRetry] = useState(0)
  const loadRef = useRef(load)
  loadRef.current = load
  const loadDaysRef = useRef(loadDays)
  loadDaysRef.current = loadDays
  const stableLoadDays = useCallback((from: string, to: string) => loadDaysRef.current(from, to), [])
  const [calendarOpen, setCalendarOpen] = useState(false)

  useEffect(() => {
    let cancelled = false
    setSlots('loading')
    void loadRef.current(days[0] ?? weekStart, days[days.length - 1] ?? weekStart).then((res) => {
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
  }, [depsKey, weekStart, retry, onSessionLost])

  const daySlots = Array.isArray(slots) ? slots.filter((s) => s.date === day) : []
  const orderedParts = (['Manhã', 'Tarde', 'Noite'] as DayPart[]).sort((a, b) => {
    if (preferredDayPart && a === preferredDayPart && b !== preferredDayPart) return -1
    if (preferredDayPart && b === preferredDayPart && a !== preferredDayPart) return 1
    return 0
  })
  const parts = orderedParts
    .map((p) => ({ part: p, items: daySlots.filter((s) => dayPart(s.time) === p) }))
    .filter((g) => g.items.length > 0)
  const withSlots = new Set(Array.isArray(slots) ? slots.map((s) => s.date) : [])
  const month = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(`${weekStart}T00:00:00Z`),
  )

  const showPref = professionals.length > 1 && onPreferredProfessionalChange

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
          <p className="cw-pref-hint">
            {preferredProfessionalId == null
              ? 'Sem preferência: a clínica escolhe entre quem estiver livre (rodízio).'
              : 'Horários só desta profissional neste serviço.'}
          </p>
        </div>
      )}
      {notice && (
        <p role="alert" className="cw-alert cw-margin">
          {notice}
        </p>
      )}
      <div className="cw-week-nav cw-margin">
        <button type="button" className="cw-month-btn" aria-haspopup="dialog" aria-expanded={calendarOpen} onClick={() => setCalendarOpen(true)}>
          <span className="cw-month">{month}</span>
          <span aria-hidden="true"> ▾</span>
        </button>
        <span className="cw-spacer" />
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
        <section
          key={g.part}
          aria-label={g.part}
          className={`cw-margin cw-part${preferredDayPart === g.part ? ' is-preferred' : ''}`}
        >
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
      {calendarOpen && (
        <CalendarSheet
          catalog={catalog}
          selected={day}
          loadDays={stableLoadDays}
          onSessionLost={onSessionLost}
          onClose={() => setCalendarOpen(false)}
          onPick={(date) => {
            setCalendarOpen(false)
            setDay(date)
            setWeekStart(date)
          }}
        />
      )}
    </main>
  )
}
