import type { PointerEvent as ReactPointerEvent } from 'react'
import { dayLabel, formatMinutes } from './format'
import type { WeekDraft } from './clinicHours'

export type WeekBarPerson = { id: string; name: string; color: string; week: WeekDraft }

/** Folga ou fechamento sobre um dia da semana mostrada (minutos do dia). */
export type WeekBarOverlay = {
  day: number
  startMinute: number
  endMinute: number
  color: string
  label: string
}

type Props = {
  clinic: WeekDraft
  /** Pessoas escolhidas para aparecer sobre o horário da clínica. */
  people?: WeekBarPerson[]
  overlays?: WeekBarOverlay[]
  label?: string
  /** Quando informado, as bordas das faixas da clínica podem ser arrastadas (múltiplos de 15 min). */
  onChangeClinic?: (next: WeekDraft) => void
  selectedDay?: number
  onSelectDay?: (day: number) => void
}

const STEP = 15
const MIN_LEN = 15

/** Faixas por dia da semana: a clínica ao fundo e cada pessoa na sua cor. */
export function WeekBars({
  clinic,
  people = [],
  overlays = [],
  label = 'Semana',
  onChangeClinic,
  selectedDay,
  onSelectDay,
}: Props) {
  const all = [clinic, ...people.map((p) => p.week)]
  let from = 8 * 60
  let to = 20 * 60
  for (const w of all) {
    for (let d = 1; d <= 7; d++) {
      for (const x of w[d] ?? []) {
        from = Math.min(from, Math.floor(x.startMinute / 60) * 60)
        to = Math.max(to, Math.ceil(x.endMinute / 60) * 60)
      }
    }
  }
  const pct = (m: number) => ((m - from) / (to - from)) * 100
  const ticks: number[] = []
  for (let m = from; m <= to; m += 120) ticks.push(m)

  function setEdge(day: number, i: number, edge: 'startMinute' | 'endMinute', minute: number) {
    if (!onChangeClinic) return
    const list = (clinic[day] ?? []).map((w, idx) => {
      if (idx !== i) return w
      const next = { ...w, [edge]: minute }
      if (next.endMinute - next.startMinute < MIN_LEN) return w
      return next
    })
    onChangeClinic({ ...clinic, [day]: list })
  }

  function drag(
    e: ReactPointerEvent<HTMLElement>,
    day: number,
    i: number,
    edge: 'startMinute' | 'endMinute',
  ) {
    e.preventDefault()
    e.stopPropagation()
    const handle = e.currentTarget
    const rect = handle.parentElement!.getBoundingClientRect()
    handle.setPointerCapture?.(e.pointerId)
    const move = (ev: PointerEvent) => {
      const raw = from + ((ev.clientX - rect.left) / rect.width) * (to - from)
      const snapped = Math.round(raw / STEP) * STEP
      setEdge(day, i, edge, Math.max(0, Math.min(24 * 60, snapped)))
    }
    const up = () => {
      handle.removeEventListener('pointermove', move)
      handle.removeEventListener('pointerup', up)
      handle.removeEventListener('pointercancel', up)
    }
    handle.addEventListener('pointermove', move)
    handle.addEventListener('pointerup', up)
    handle.addEventListener('pointercancel', up)
  }

  function keyEdge(
    e: React.KeyboardEvent,
    day: number,
    i: number,
    edge: 'startMinute' | 'endMinute',
  ) {
    const dir = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
    if (!dir) return
    e.preventDefault()
    const cur = (clinic[day] ?? [])[i]![edge]
    setEdge(day, i, edge, Math.max(0, Math.min(24 * 60, cur + dir * STEP)))
  }

  return (
    <div className="week-bars" role="group" aria-label={label}>
      <div className="week-bars-axis" aria-hidden>
        <span />
        <span className="week-bars-ticks">
          {ticks.map((m) => (
            <span key={m}>{formatMinutes(m).slice(0, 2)}h</span>
          ))}
        </span>
      </div>
      {[1, 2, 3, 4, 5, 6, 7].map((day) => {
        const open = clinic[day] ?? []
        const dayOverlays = overlays.filter((o) => o.day === day)
        return (
          <div
            key={day}
            className="week-bars-row"
            data-selected={selectedDay === day ? 'true' : undefined}
          >
            {onSelectDay ? (
              <button
                type="button"
                className="week-bars-day week-bars-day-btn"
                aria-pressed={selectedDay === day}
                onClick={() => onSelectDay(day)}
              >
                {dayLabel(day).slice(0, 3)}
              </button>
            ) : (
              <span className="week-bars-day">{dayLabel(day).slice(0, 3)}</span>
            )}
            <div className="week-bars-track">
              {open.map((w, i) => (
                <span
                  key={i}
                  className={
                    people.length ? 'week-bars-clinic week-bars-clinic-soft' : 'week-bars-clinic'
                  }
                  style={{
                    left: `${pct(w.startMinute)}%`,
                    width: `${pct(w.endMinute) - pct(w.startMinute)}%`,
                  }}
                />
              ))}
              {open.length === 0 ? <span className="week-bars-closed">Fechado</span> : null}
              {people.map((p, k) =>
                (p.week[day] ?? []).map((w, i) => (
                  <span
                    key={`${p.id}-${i}`}
                    className="week-bars-person"
                    title={p.name}
                    style={{
                      left: `${pct(w.startMinute)}%`,
                      width: `${pct(w.endMinute) - pct(w.startMinute)}%`,
                      top: `${(k / people.length) * 100}%`,
                      height: `${100 / people.length}%`,
                      background: p.color,
                    }}
                  />
                )),
              )}
              {dayOverlays.map((o, i) => {
                const start = Math.max(from, o.startMinute)
                const end = Math.min(to, o.endMinute)
                if (end <= start) return null
                return (
                  <span
                    key={`o${i}`}
                    className="week-bars-off"
                    title={o.label}
                    style={{
                      left: `${pct(start)}%`,
                      width: `${pct(end) - pct(start)}%`,
                      borderColor: o.color,
                    }}
                  />
                )
              })}
              {onChangeClinic
                ? open.flatMap((w, i) =>
                    (['startMinute', 'endMinute'] as const).map((edge) => (
                      <span
                        key={`${i}-${edge}`}
                        role="slider"
                        tabIndex={0}
                        className="week-bars-handle"
                        aria-label={`${dayLabel(day)}, ${edge === 'startMinute' ? 'abre' : 'fecha'}`}
                        aria-valuemin={0}
                        aria-valuemax={24 * 60}
                        aria-valuenow={w[edge]}
                        aria-valuetext={formatMinutes(w[edge])}
                        style={{ left: `${pct(w[edge])}%` }}
                        onPointerDown={(e) => drag(e, day, i, edge)}
                        onKeyDown={(e) => keyEdge(e, day, i, edge)}
                      />
                    )),
                  )
                : null}
            </div>
          </div>
        )
      })}
    </div>
  )
}
