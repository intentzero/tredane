import { useEffect, useMemo, useRef, useState } from 'react'
import type { Catalog, Slot, SlotsResult } from './api'
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

export function TimeStep({
  catalog,
  subtitle,
  depsKey,
  load,
  weekStart,
  setWeekStart,
  day,
  setDay,
  notice,
  onPick,
  onSessionLost,
}: {
  catalog: Catalog
  /** Linha por baixo do título: serviço e duração. */
  subtitle: string
  /** Muda quando o pedido de horas muda (serviço, zonas, marcação). */
  depsKey: string
  load: (from: string, to: string) => Promise<SlotsResult>
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
  const loadRef = useRef(load)
  loadRef.current = load

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
  const parts = (['Manhã', 'Tarde', 'Noite'] as DayPart[])
    .map((p) => ({ part: p, items: daySlots.filter((s) => dayPart(s.time) === p) }))
    .filter((g) => g.items.length > 0)
  const withSlots = new Set(Array.isArray(slots) ? slots.map((s) => s.date) : [])
  const month = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(`${weekStart}T00:00:00Z`),
  )

  return (
    <main className="cw-main cw-flush">
      <p className="cw-muted cw-margin">{subtitle}</p>
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

