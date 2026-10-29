import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useState } from 'react'
import { Button } from 'react-aria-components'
import { blockRange, civilClock, type WeekDraft } from './clinicHours'
import { formatMinutes } from './format'

export type GridPerson = { id: string; name: string; color: string; mark?: string; week: WeekDraft }
export type GridBlock = { id: string; resourceId: string; startsAt: number; endsAt: number }

const NAMES = ['Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado', 'Domingo']
const FROM = 7 * 60
const TO = 20 * 60
const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']

const addDays = (iso: string, by: number): string => {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y!, m! - 1, d! + by)).toISOString().slice(0, 10)
}
const mondayOf = (iso: string): string => {
  const [y, m, d] = iso.split('-').map(Number)
  const dow = new Date(Date.UTC(y!, m! - 1, d!)).getUTCDay() || 7
  return addDays(iso, 1 - dow)
}

/** Faixas bloqueadas de uma data, em minutos do dia (dia inteiro = 0–1440). */
function blockedSpans(blocks: GridBlock[], iso: string, tz: string): Array<[number, number]> {
  const day = blockRange(iso, iso, true, 0, 0, tz)
  if (!day) return []
  return blocks
    .filter((b) => b.startsAt < day.endsAt && b.endsAt > day.startsAt)
    .map((b): [number, number] => {
      const from = b.startsAt <= day.startsAt ? 0 : civilClock(b.startsAt, tz).minute
      const to = b.endsAt >= day.endsAt ? 1440 : civilClock(b.endsAt, tz).minute
      return [from, to]
    })
}

/**
 * Semana navegável do desktop (#224): uma linha por dia com a clínica ao fundo e as pessoas
 * escolhidas em «Mostrar» em faixas finas por cor. Folgas e fechamentos aparecem hachurados.
 * Só desenha; escolher um dia entrega o dia da semana (1–7) a quem usa.
 */
export function WeekGrid({
  clinic,
  people,
  clinicBlocks,
  personBlocks,
  timezone,
  todayIso,
  selectedDay,
  changedDays = [],
  onPickDay,
}: {
  clinic: WeekDraft
  people: GridPerson[]
  clinicBlocks: GridBlock[]
  personBlocks: GridBlock[]
  timezone: string
  todayIso: string
  selectedDay: number | null
  /** Dias da semana (1–7) com rascunho ainda não salvo. */
  changedDays?: number[]
  onPickDay: (day: number) => void
}) {
  const [offset, setOffset] = useState(0)
  const [shown, setShown] = useState<string[]>(() => people.map((p) => p.id))
  const monday = addDays(mondayOf(todayIso), offset * 7)
  const sunday = addDays(monday, 6)
  const label = (() => {
    const [, m1, d1] = monday.split('-').map(Number)
    const [, m2, d2] = sunday.split('-').map(Number)
    return m1 === m2 ? `${d1} a ${d2} de ${MONTHS[m1! - 1]}` : `${d1} de ${MONTHS[m1! - 1]} a ${d2} de ${MONTHS[m2! - 1]}`
  })()
  const pct = (minute: number) => `${(Math.min(Math.max(minute, FROM), TO) - FROM) / (TO - FROM) * 100}%`
  const span = (a: number, b: number) => ({
    left: pct(a),
    width: `${Math.max(0, Math.min(b, TO) - Math.max(a, FROM)) / (TO - FROM) * 100}%`,
  })
  const visible = people.filter((p) => shown.includes(p.id))
  const hours = [7, 10, 13, 16, 19]

  return (
    <div className="week-grid">
      <div className="week-grid-head">
        <Button className="panel-icon-btn" aria-label="Semana anterior" onPress={() => setOffset(offset - 1)}>
          <ChevronLeft aria-hidden size={18} strokeWidth={2} />
        </Button>
        <Button className="panel-icon-btn" aria-label="Próxima semana" onPress={() => setOffset(offset + 1)}>
          <ChevronRight aria-hidden size={18} strokeWidth={2} />
        </Button>
        <strong className="week-grid-range">{label}</strong>
        {offset !== 0 ? (
          <Button className="panel-btn panel-btn-ghost" onPress={() => setOffset(0)}>
            Hoje
          </Button>
        ) : null}
        {people.length > 0 ? (
          <div className="week-grid-show" role="group" aria-label="Mostrar">
            <span>Mostrar</span>
            {people.map((p) => {
              const on = shown.includes(p.id)
              return (
                <Button
                  key={p.id}
                  className="week-grid-chip"
                  aria-pressed={on}
                  onPress={() => setShown(on ? shown.filter((x) => x !== p.id) : [...shown, p.id])}
                >
                  <i className="week-grid-dot" style={{ background: p.color }} aria-hidden>
                    {p.mark}
                  </i>
                  {p.name}
                </Button>
              )
            })}
          </div>
        ) : null}
      </div>

      <div className="week-grid-ticks" aria-hidden>
        {hours.map((h) => (
          <span key={h} style={{ left: pct(h * 60) }}>
            {String(h).padStart(2, '0')}h
          </span>
        ))}
      </div>

      <ul className="week-grid-days">
        {NAMES.map((name, i) => {
          const dow = i + 1
          const iso = addDays(monday, i)
          const windows = clinic[dow] ?? []
          const closure = blockedSpans(clinicBlocks, iso, timezone)
          const text = windows.length === 0 ? 'fechado' : windows.map((w) => `${formatMinutes(w.startMinute)} às ${formatMinutes(w.endMinute)}`).join(' e ')
          const [, mm, dd] = iso.split('-')
          return (
            <li key={iso}>
              <Button
                className="week-grid-day"
                data-selected={selectedDay === dow ? true : undefined}
                data-today={iso === todayIso ? true : undefined}
                aria-pressed={selectedDay === dow}
                aria-label={`${name}, ${dd}/${mm}, ${text}${closure.length ? ', com fechamento' : ''}${changedDays.includes(dow) ? ', alterado' : ''}. Editar`}
                onPress={() => onPickDay(dow)}
              >
                <span className="week-grid-name">
                  <strong>{name}</strong>
                  <span>
                    {dd}/{mm}
                  </span>
                  {changedDays.includes(dow) ? <em className="hours-changed">Alterado</em> : null}
                </span>
                <span className="week-grid-track" aria-hidden>
                  {windows.map((w, k) => (
                    <i key={k} className="week-grid-clinic" style={span(w.startMinute, w.endMinute)}>
                      {formatMinutes(w.startMinute)}–{formatMinutes(w.endMinute)}
                    </i>
                  ))}
                  {closure.map(([a, b], k) => (
                    <i key={`c${k}`} className="week-grid-hatch week-grid-closed" style={span(a, b)} />
                  ))}
                  {visible.map((p) => {
                    const mine = personBlocks.filter((b) => b.resourceId === p.id)
                    return (
                      <span key={p.id} className="week-grid-lane" data-person={p.id}>
                        {(p.week[dow] ?? []).map((w, k) => (
                          <i key={k} style={{ ...span(w.startMinute, w.endMinute), background: p.color }} />
                        ))}
                        {blockedSpans(mine, iso, timezone).map(([a, b], k) => (
                          <i key={`b${k}`} className="week-grid-hatch" style={{ ...span(a, b), color: p.color }} />
                        ))}
                      </span>
                    )
                  })}
                </span>
              </Button>
            </li>
          )
        })}
      </ul>
      <p className="week-grid-legend">
        <span>
          <i className="week-grid-key" /> Clínica aberta
        </span>
        <span>
          <i className="week-grid-key week-grid-hatch week-grid-closed" /> Fechada
        </span>
        <span>
          <i className="week-grid-key week-grid-hatch" /> Folga
        </span>
        <span>Clique num dia para editar.</span>
      </p>
    </div>
  )
}
