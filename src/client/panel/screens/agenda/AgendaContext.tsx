import type { ScheduleHold } from '../../api'
import { AgendaDayList, type AgendaProfessional } from './AgendaDayList'
import { AgendaMiniMonth } from './AgendaMiniMonth'
import { initialsOf, shortName } from './dayList'

export type AgendaRoom = { id: string; name: string }

type Props = {
  date: string
  today: string
  timezone: string
  now: number
  professionals: AgendaProfessional[]
  rooms: AgendaRoom[]
  selectedPros: string[]
  selectedRooms: string[]
  countOf: (professionalId: string) => number
  /** Dias do mês visível com compromisso ou reserva por período. */
  monthMarks: ReadonlyMap<string, number>
  onViewMonth: (month: string) => void
  holds: ScheduleHold[]
  onPickDate: (iso: string) => void
  onTogglePro: (id: string) => void
  onToggleRoom: (id: string) => void
  onClearFilters: () => void
  onOpen: (id: string) => void
  onOpenHold: (hold: ScheduleHold) => void
}

/**
 * Coluna de contexto da Agenda no desktop (≥ 1280 px, DEC-068; Agendar no cabeçalho, DEC-170): mês pequeno,
 * filtros por profissional e sala (e as horas a definir). A grade fica na área de trabalho ao lado.
 */
export function AgendaContext({
  date,
  today,
  timezone,
  now,
  professionals,
  rooms,
  selectedPros,
  selectedRooms,
  countOf,
  monthMarks,
  onViewMonth,
  holds,
  onPickDate,
  onTogglePro,
  onToggleRoom,
  onClearFilters,
  onOpen,
  onOpenHold,
}: Props) {
  const filtering = selectedPros.length > 0 || selectedRooms.length > 0
  return (
    <aside className="agenda-context" aria-label="Contexto da agenda">
      <AgendaMiniMonth
        date={date}
        today={today}
        timezone={timezone}
        marks={monthMarks}
        onPick={onPickDate}
        onViewMonth={onViewMonth}
      />

      {professionals.length > 1 ? (
        <section className="agenda-context-block" aria-labelledby="agenda-ctx-pros">
          <h2 id="agenda-ctx-pros" className="panel-legend">
            Profissionais
          </h2>
          <div className="agenda-context-chips" role="group" aria-label="Filtrar por profissional">
            {professionals.map((p) => {
              const on = selectedPros.includes(p.id)
              const n = countOf(p.id)
              return (
                <button
                  key={p.id}
                  type="button"
                  className="panel-chip"
                  aria-pressed={on}
                  aria-label={`${p.name}, ${n} ${n === 1 ? 'horário' : 'horários'}`}
                  onClick={() => onTogglePro(p.id)}
                >
                  <span className="agenda-context-initials" aria-hidden>
                    {initialsOf(p.name)}
                  </span>
                  {shortName(p.name)}
                  <span className="panel-chip-count">{n}</span>
                </button>
              )
            })}
          </div>
        </section>
      ) : null}

      {rooms.length > 1 ? (
        <section className="agenda-context-block" aria-labelledby="agenda-ctx-rooms">
          <h2 id="agenda-ctx-rooms" className="panel-legend">
            Salas
          </h2>
          <div className="agenda-context-chips" role="group" aria-label="Filtrar por sala">
            {rooms.map((r) => (
              <button
                key={r.id}
                type="button"
                className="panel-chip"
                aria-pressed={selectedRooms.includes(r.id)}
                onClick={() => onToggleRoom(r.id)}
              >
                {r.name}
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {filtering ? (
        <button type="button" className="agenda-context-clear" onClick={onClearFilters}>
          Limpar filtros
        </button>
      ) : null}

      {/* A lista do dia saiu daqui (repetia a grade); ficam só as horas a definir, que a grade não mostra. */}
      {holds.length > 0 ? (
        <section className="agenda-context-day">
          <AgendaDayList
            entries={[]}
            holds={holds}
            professionals={professionals}
            timezone={timezone}
            now={now}
            onOpen={onOpen}
            onOpenHold={onOpenHold}
          />
        </section>
      ) : null}
    </aside>
  )
}
