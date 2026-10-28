import { civilOf } from './clinicHours'

export type CalendarEntry = { id: string; startsAt: number; endsAt: number; color: string }

type Props = {
  year: number
  /** 0–11. */
  month: number
  entries: CalendarEntry[]
  timezone: string
  todayIso: string
  onPrev: () => void
  onNext: () => void
}

const MONTHS = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro']
const pad = (n: number) => String(n).padStart(2, '0')

/** Mês em grade (segunda a domingo); cada folga ou fechamento vira um ponto colorido nos dias que cobre. */
export function MonthCalendar({ year, month, entries, timezone, todayIso, onPrev, onNext }: Props) {
  const first = new Date(Date.UTC(year, month, 1))
  const lead = (first.getUTCDay() + 6) % 7
  const days = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
  const cells: Array<{ iso: string; n: number } | null> = []
  for (let i = 0; i < lead; i++) cells.push(null)
  for (let d = 1; d <= days; d++) cells.push({ iso: `${year}-${pad(month + 1)}-${pad(d)}`, n: d })
  while (cells.length % 7 !== 0) cells.push(null)

  const span = entries.map((e) => ({ ...e, a: civilOf(e.startsAt, timezone), b: civilOf(e.endsAt - 1, timezone) }))

  return (
    <div className="month-cal">
      <div className="month-cal-head">
        <button type="button" aria-label="Mês anterior" onClick={onPrev}>
          ‹
        </button>
        <strong>
          {MONTHS[month]} de {year}
        </strong>
        <button type="button" aria-label="Próximo mês" onClick={onNext}>
          ›
        </button>
      </div>
      <div className="month-cal-grid month-cal-dow" aria-hidden>
        {['S', 'T', 'Q', 'Q', 'S', 'S', 'D'].map((d, i) => (
          <span key={i}>{d}</span>
        ))}
      </div>
      <div className="month-cal-grid">
        {cells.map((c, i) =>
          c ? (
            <span key={c.iso} className="month-cal-cell" data-today={c.iso === todayIso ? 'true' : undefined}>
              <span className="month-cal-n">{c.n}</span>
              <span className="month-cal-dots">
                {span
                  .filter((e) => e.a <= c.iso && c.iso <= e.b)
                  .slice(0, 3)
                  .map((e) => (
                    <i key={e.id} style={{ background: e.color }} />
                  ))}
              </span>
            </span>
          ) : (
            <span key={`x${i}`} />
          ),
        )}
      </div>
    </div>
  )
}
