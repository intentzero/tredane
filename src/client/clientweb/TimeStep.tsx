import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Catalog, CatalogProfessional, EmptyDay, EmptyDayReason, Slot, SlotsResult } from './api'
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

function emptyReasonCopy(reason: EmptyDayReason | null): { title: string; body: string; icon: 'calendar' | 'clock' } {
  if (reason === 'closed') {
    return {
      title: 'Clínica fechada neste dia.',
      body: 'Escolha outro dia na semana para ver os horários disponíveis.',
      icon: 'calendar',
    }
  }
  // `full` ou motivo ausente (API antiga / calendário): sem afirmar abertura.
  return {
    title: 'Sem horários disponíveis neste dia.',
    body:
      reason === 'full'
        ? 'A clínica está aberta, mas não há vagas livres para este serviço. Tente outro dia.'
        : 'Escolha outro dia na semana para ver os horários disponíveis.',
    icon: 'clock',
  }
}

function ReasonIcon({ kind }: { kind: 'calendar' | 'clock' }) {
  if (kind === 'calendar') {
    return (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="3" y="4" width="18" height="18" rx="2" />
        <path d="M16 2v4M8 2v4M3 10h18" />
        <path d="M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01" />
      </svg>
    )
  }
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  )
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
  const [emptyDays, setEmptyDays] = useState<EmptyDay[]>([])
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
      setEmptyDays(res.emptyDays)
      const inWeek = day != null && days.includes(day)
      const firstFree = res.slots[0]?.date ?? null
      setDay(inWeek ? day : firstFree ?? days[0] ?? null)
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
  const emptyReasonByDate = useMemo(() => {
    const map = new Map<string, EmptyDayReason>()
    for (const row of emptyDays) map.set(row.date, row.reason)
    return map
  }, [emptyDays])
  const month = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(`${weekStart}T00:00:00Z`),
  )

  const showPref = professionals.length > 1 && onPreferredProfessionalChange
  const showDayEmpty = Array.isArray(slots) && day != null && !withSlots.has(day)
  const dayEmptyCopy = showDayEmpty ? emptyReasonCopy(emptyReasonByDate.get(day) ?? null) : null

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
          const empty = !free && Array.isArray(slots)
          const reason = emptyReasonByDate.get(d)
          const emptyHint =
            reason === 'closed' ? ', clínica fechada' : empty ? ', sem horários' : ''
          return (
            <button
              key={d}
              type="button"
              className={`cw-day${d === day ? ' is-on' : ''}${empty ? ' is-empty' : ''}`}
              aria-pressed={d === day}
              aria-label={`${l.weekday} ${l.dayMonth}${emptyHint}`}
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
      {dayEmptyCopy && (
        <div className="cw-reason cw-margin" role="status">
          <span className="cw-reason-icon" aria-hidden="true">
            <ReasonIcon kind={dayEmptyCopy.icon} />
          </span>
          <p className="cw-reason-title">{dayEmptyCopy.title}</p>
          <p className="cw-reason-body">{dayEmptyCopy.body}</p>
        </div>
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
      {Array.isArray(slots) && <p className="cw-muted cw-margin">Nada fica marcado antes de Confirmar.</p>}
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
