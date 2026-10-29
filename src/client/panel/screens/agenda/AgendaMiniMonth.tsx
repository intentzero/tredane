import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button } from 'react-aria-components'
import { formatLongDate } from './format'

type Props = {
  /** Dia mostrado na grade (AAAA-MM-DD). */
  date: string
  today: string
  timezone: string
  onPick: (iso: string) => void
}

const pad = (n: number) => String(n).padStart(2, '0')

function monthOf(iso: string): { y: number; m: number } {
  const [y, m] = iso.split('-').map(Number)
  return { y: y!, m: m! - 1 }
}

/** Mês pequeno da coluna de contexto da Agenda (desktop): escolhe o dia da grade. Segunda a domingo. */
export function AgendaMiniMonth({ date, today, timezone, onPick }: Props) {
  const [view, setView] = useState(() => monthOf(date))
  const dateMonth = date.slice(0, 7)

  // Quando o dia muda por outro caminho (Hoje, setas da grade), o mês acompanha.
  useEffect(() => {
    setView(monthOf(date))
  }, [dateMonth])

  const first = new Date(Date.UTC(view.y, view.m, 1))
  const lead = (first.getUTCDay() + 6) % 7
  const days = new Date(Date.UTC(view.y, view.m + 1, 0)).getUTCDate()
  const cells: Array<{ iso: string; n: number } | null> = []
  for (let i = 0; i < lead; i++) cells.push(null)
  for (let d = 1; d <= days; d++) cells.push({ iso: `${view.y}-${pad(view.m + 1)}-${pad(d)}`, n: d })
  while (cells.length % 7 !== 0) cells.push(null)

  const title = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(first)
  const shift = (delta: number) =>
    setView(({ y, m }) => {
      const next = new Date(Date.UTC(y, m + delta, 1))
      return { y: next.getUTCFullYear(), m: next.getUTCMonth() }
    })

  return (
    <div className="agenda-month" role="group" aria-label="Escolher o dia">
      <div className="agenda-month-head">
        <Button className="panel-icon-btn" aria-label="Mês anterior" onPress={() => shift(-1)}>
          <ChevronLeft aria-hidden size={18} strokeWidth={2} />
        </Button>
        <strong className="agenda-month-title">{title}</strong>
        <Button className="panel-icon-btn" aria-label="Próximo mês" onPress={() => shift(1)}>
          <ChevronRight aria-hidden size={18} strokeWidth={2} />
        </Button>
      </div>
      <div className="agenda-month-grid agenda-month-dow" aria-hidden>
        {['S', 'T', 'Q', 'Q', 'S', 'S', 'D'].map((d, i) => (
          <span key={i}>{d}</span>
        ))}
      </div>
      <div className="agenda-month-grid">
        {cells.map((c, i) =>
          c ? (
            <button
              key={c.iso}
              type="button"
              className="agenda-month-day"
              aria-label={formatLongDate(c.iso, timezone)}
              aria-pressed={c.iso === date}
              aria-current={c.iso === today ? 'date' : undefined}
              onClick={() => onPick(c.iso)}
            >
              {c.n}
            </button>
          ) : (
            <span key={`x${i}`} />
          ),
        )}
      </div>
    </div>
  )
}
