import { dayLabel, formatMinutes } from './format'
import type { WeekDraft } from './clinicHours'

export type WeekBarPerson = { id: string; name: string; color: string; week: WeekDraft }

type Props = {
  clinic: WeekDraft
  /** Pessoas escolhidas para aparecer sobre o horário da clínica. */
  people?: WeekBarPerson[]
  label?: string
}

/** Faixas por dia da semana: a clínica ao fundo e cada pessoa na sua cor. Só leitura. */
export function WeekBars({ clinic, people = [], label = 'Semana' }: Props) {
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

  return (
    <div className="week-bars" role="img" aria-label={label}>
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
        return (
          <div key={day} className="week-bars-row">
            <span className="week-bars-day">{dayLabel(day).slice(0, 3)}</span>
            <div className="week-bars-track">
              {open.map((w, i) => (
                <span
                  key={i}
                  className={people.length ? 'week-bars-clinic week-bars-clinic-soft' : 'week-bars-clinic'}
                  style={{ left: `${pct(w.startMinute)}%`, width: `${pct(w.endMinute) - pct(w.startMinute)}%` }}
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
            </div>
          </div>
        )
      })}
    </div>
  )
}
