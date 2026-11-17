import { useEffect, useMemo, useRef, useState } from 'react'
import type { Catalog, Slot, SlotsResult } from './api'
import { addDays, civilDayLabel } from './booking-model'

type Props = {
  catalog: Catalog
  /** Dia civil escolhido agora. */
  selected: string | null
  /** Primeira hora de cada dia do horizonte (`daysOnly`). */
  loadDays: (from: string, to: string) => Promise<SlotsResult>
  onPick: (date: string) => void
  onClose: () => void
  onSessionLost: () => void
}

const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']
const WEEK_HEAD = [
  ['D', 'domingo'],
  ['S', 'segunda'],
  ['T', 'terça'],
  ['Q', 'quarta'],
  ['Q', 'quinta'],
  ['S', 'sexta'],
  ['S', 'sábado'],
] as const

function monthOf(date: string): string {
  return date.slice(0, 7)
}

function monthLabel(ym: string): string {
  const [y, m] = ym.split('-').map(Number) as [number, number]
  return `${MONTHS[m - 1]} ${y}`
}

function shiftMonth(ym: string, n: number): string {
  const [y, m] = ym.split('-').map(Number) as [number, number]
  const d = new Date(Date.UTC(y, m - 1 + n, 1))
  return d.toISOString().slice(0, 7)
}

/** Dias civis do mês em linhas de 7 (domingo primeiro); `null` = célula vazia. */
export function monthGrid(ym: string): Array<Array<string | null>> {
  const [y, m] = ym.split('-').map(Number) as [number, number]
  const first = new Date(Date.UTC(y, m - 1, 1))
  const lead = first.getUTCDay()
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate()
  const cells: Array<string | null> = [...Array(lead).fill(null)]
  for (let d = 1; d <= days; d++) cells.push(`${ym}-${String(d).padStart(2, '0')}`)
  while (cells.length % 7 !== 0) cells.push(null)
  const rows: Array<Array<string | null>> = []
  for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7))
  return rows
}

/** Calendário do mês em folha inferior (C-12): pontos nos dias com horas livres, resto apagado. */
export function CalendarSheet({ catalog, selected, loadDays, onPick, onClose, onSessionLost }: Props) {
  const last = addDays(catalog.today, catalog.horizonDays - 1)
  const firstMonth = monthOf(catalog.today)
  const lastMonth = monthOf(last)
  const [month, setMonth] = useState(selected && selected >= catalog.today && selected <= last ? monthOf(selected) : firstMonth)
  const [days, setDays] = useState<Set<string> | 'loading' | 'error'>('loading')
  const [retry, setRetry] = useState(0)
  const closeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    let cancelled = false
    setDays('loading')
    void loadDays(catalog.today, last).then((res) => {
      if (cancelled) return
      if (res.kind === 'unauthorized') return onSessionLost()
      if (res.kind === 'error') return setDays('error')
      setDays(new Set((res.slots as Slot[]).map((s) => s.date)))
    })
    return () => {
      cancelled = true
    }
  }, [catalog.today, last, loadDays, onSessionLost, retry])

  useEffect(() => {
    closeRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const rows = useMemo(() => monthGrid(month), [month])
  const first = days instanceof Set ? [...days].sort()[0] : undefined
  const firstLabel = first ? civilDayLabel(first) : null

  return (
    <div className="cw-sheet-backdrop" onClick={onClose}>
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="cw-cal-title"
        className="cw-sheet"
        onClick={(e) => e.stopPropagation()}
      >
        <span aria-hidden="true" className="cw-sheet-grip" />
        <div className="cw-sheet-head">
          <h2 id="cw-cal-title" className="cw-title">
            Escolher data
          </h2>
          <button ref={closeRef} type="button" className="cw-icon-btn" aria-label="Fechar" onClick={onClose}>
            <span aria-hidden="true">×</span>
          </button>
        </div>
        <div className="cw-sheet-month">
          <button type="button" className="cw-icon-btn" aria-label="Mês anterior" disabled={month <= firstMonth} onClick={() => setMonth(shiftMonth(month, -1))}>
            ‹
          </button>
          <span aria-live="polite" className="cw-month">
            {monthLabel(month)}
          </span>
          <button type="button" className="cw-icon-btn" aria-label="Próximo mês" disabled={month >= lastMonth} onClick={() => setMonth(shiftMonth(month, 1))}>
            ›
          </button>
        </div>
        <table className="cw-cal" aria-label={monthLabel(month)}>
          <thead>
            <tr>
              {WEEK_HEAD.map(([letter, name], i) => (
                <th key={i} scope="col" abbr={name} aria-label={name}>
                  {letter}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, ri) => (
              <tr key={ri}>
                {row.map((date, ci) => {
                  if (!date) return <td key={ci} />
                  const inRange = date >= catalog.today && date <= last
                  const free = days instanceof Set && inRange && days.has(date)
                  const l = civilDayLabel(date)
                  const num = Number(date.slice(8))
                  return (
                    <td key={ci}>
                      {free ? (
                        <button
                          type="button"
                          className={`cw-cal-day${date === selected ? ' is-on' : ''}`}
                          aria-label={`${l.weekday} ${l.dayMonth}, com horários`}
                          aria-pressed={date === selected}
                          onClick={() => onPick(date)}
                        >
                          {num}
                          <span aria-hidden="true" className="cw-cal-dot" />
                        </button>
                      ) : (
                        <span className="cw-cal-day is-off" aria-label={`${l.weekday} ${l.dayMonth}, sem horários`}>
                          {num}
                        </span>
                      )}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
        {days === 'loading' && (
          <p role="status" className="cw-muted">
            A procurar datas…
          </p>
        )}
        {days === 'error' && (
          <div>
            <p role="alert" className="cw-alert">
              Não foi possível carregar as datas.
            </p>
            <button type="button" className="cw-btn cw-btn-secondary" onClick={() => setRetry((n) => n + 1)}>
              Tentar outra vez
            </button>
          </div>
        )}
        {days instanceof Set && days.size === 0 && (
          <p role="status" className="cw-note">
            Sem horários livres nos próximos {catalog.horizonDays} dias. Fale com a equipe pelo WhatsApp.
          </p>
        )}
        {days instanceof Set && days.size > 0 && (
          <p className="cw-muted">
            <span aria-hidden="true" className="cw-cal-dot cw-cal-dot-inline" /> Com horários livres. Os outros dias estão cheios ou fechados.
          </p>
        )}
        {firstLabel && first && (
          <button type="button" className="cw-btn cw-btn-secondary" onClick={() => onPick(first)}>
            Primeira data livre: {firstLabel.weekday} {firstLabel.dayMonth}
          </button>
        )}
        <p className="cw-caption cw-center-text">Pode marcar até {catalog.horizonDays} dias à frente.</p>
      </section>
    </div>
  )
}
