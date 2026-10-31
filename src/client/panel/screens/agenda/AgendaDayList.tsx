import { Users } from 'lucide-react'
import type { AgendaAppointmentItem, ScheduleHold } from '../../api'
import { formatSlotTime } from './format'
import type { FreeSlot } from './freeSlots'
import { initialsOf, PROFESSIONAL_TONES, shortName, type DayEntry } from './dayList'

export type AgendaProfessional = { id: string; name: string }

type Props = {
  entries: DayEntry[]
  holds: ScheduleHold[]
  professionals: AgendaProfessional[]
  timezone: string
  now: number
  onOpen: (id: string) => void
  onSchedule: () => void
  /** Livre escolhido: abre o Agendar com dia, hora e profissional. */
  onScheduleAt?: (slot: FreeSlot) => void
  onOpenHold: (hold: ScheduleHold) => void
}

function toneOf(professionals: AgendaProfessional[], id: string): number {
  const i = professionals.findIndex((p) => p.id === id)
  return (i < 0 ? 0 : i) % PROFESSIONAL_TONES
}

function Mini({ pro, professionals }: { pro: { id: string; name: string }; professionals: AgendaProfessional[] }) {
  return (
    <span className={`agenda-mini agenda-tone-${toneOf(professionals, pro.id)}`} aria-hidden="true">
      {initialsOf(pro.name)}
    </span>
  )
}

function AptCard({
  item,
  professionals,
  timezone,
  onOpen,
}: {
  item: AgendaAppointmentItem
  professionals: AgendaProfessional[]
  timezone: string
  onOpen: (id: string) => void
}) {
  return (
    <button type="button" className="agenda-card" onClick={() => onOpen(item.id)}>
      <span className="agenda-card-title">{item.contactLabel || 'Sem nome'}</span>
      <span className="agenda-card-line">
        {item.serviceName} · até {formatSlotTime(item.endsAt, timezone)}
        {item.durationAdjusted ? ' · duração ajustada' : ''}
        {item.bookedByAi ? ' · Marcado pela IA' : ''}
      </span>
      <span className="agenda-card-meta">
        <Mini pro={{ id: item.professionalId, name: item.professionalName }} professionals={professionals} />
        {item.professionalName}
        {item.roomResourceName ? ` · ${item.roomResourceName}` : ''}
      </span>
    </button>
  )
}

/** Lista cronológica do dia no celular (M-06 + sala compartilhada, DEC-059). */
export function AgendaDayList({
  entries,
  holds,
  professionals,
  timezone,
  now,
  onOpen,
  onSchedule,
  onScheduleAt,
  onOpenHold,
}: Props) {
  return (
    <div className="agenda-list">
      {holds.length > 0 ? (
        <section className="agenda-holds" aria-label="Hora a definir">
          <h2 className="agenda-list-h">Hora a definir</h2>
          {holds.map((h) => (
            <button key={h.id} type="button" className="agenda-hold" onClick={() => onOpenHold(h)}>
              <span className="agenda-card-title">{h.contactName || 'Sem nome'}</span>
              <span className="agenda-card-line">
                {h.serviceName} · {formatSlotTime(h.windowStartsAt, timezone)}–{formatSlotTime(h.windowEndsAt, timezone)} · {h.durationMinutes} min
              </span>
              <span className="agenda-hold-cta">Definir horário</span>
            </button>
          ))}
        </section>
      ) : null}

      {/* Dia vazio sem livres: sem faixa tracejada nem «Agendar horário» — o «+ Agendar» do topo já cobre (Paulo). */}
      {entries.length === 0 ? null : (
        <ol className="agenda-rows" aria-label="Horários do dia">
          {entries.map((e) => {
            if (e.kind === 'now') {
              return (
                <li key={e.key} className="agenda-row agenda-row--now" aria-label="Agora">
                  <span className="agenda-now-line" aria-hidden="true" />
                  <span className="agenda-now-label">Agora {formatSlotTime(now, timezone)}</span>
                </li>
              )
            }
            if (e.kind === 'free') {
              return (
                <li key={e.key} className="agenda-row">
                  <span className="agenda-row-time">{formatSlotTime(e.startsAt, timezone)}</span>
                  <button
                    type="button"
                    className="agenda-free"
                    aria-label={`Agendar ${formatSlotTime(e.slot.startsAt, timezone)}, ${e.slot.professionalName}`}
                    onClick={() => onScheduleAt?.(e.slot)}
                  >
                    <span className="agenda-free-text">
                      <strong>Livre</strong>
                      <span>
                        {formatSlotTime(e.slot.startsAt, timezone)}–{formatSlotTime(e.slot.endsAt, timezone)} ·{' '}
                        <Mini pro={{ id: e.slot.professionalId, name: e.slot.professionalName }} professionals={professionals} />
                        {shortName(e.slot.professionalName)}
                      </span>
                    </span>
                    <span className="agenda-free-cta">Agendar</span>
                  </button>
                </li>
              )
            }
            if (e.kind === 'apt') {
              return (
                <li key={e.key} className="agenda-row">
                  <span className="agenda-row-time">{formatSlotTime(e.startsAt, timezone)}</span>
                  <AptCard item={e.item} professionals={professionals} timezone={timezone} onOpen={onOpen} />
                </li>
              )
            }
            const full = e.peak >= e.capacity
            return (
              <li key={e.key} className="agenda-row">
                <span className="agenda-row-time">{formatSlotTime(e.startsAt, timezone)}</span>
                <section
                  className={`agenda-room${full ? ' agenda-room--full' : ''}`}
                  aria-label={`${e.roomName}, ${formatSlotTime(e.startsAt, timezone)} às ${formatSlotTime(e.endsAt, timezone)}, ${e.peak} de ${e.capacity} lugares${full ? ', lotada' : ''}`}
                >
                  <div className="agenda-room-head">
                    <Users aria-hidden size={16} strokeWidth={2} />
                    <strong>{e.roomName}{full ? ' · lotada' : ''}</strong>
                    <span className="agenda-seats" role="img" aria-label={`${e.peak} de ${e.capacity} lugares ocupados`}>
                      {Array.from({ length: Math.min(e.capacity, 8) }, (_, i) => (
                        <span key={i} className={`agenda-seat${i < e.peak ? ' agenda-seat--on' : ''}`} />
                      ))}
                    </span>
                    <span className="agenda-room-count">
                      {e.peak}/{e.capacity}
                    </span>
                  </div>
                  {e.items.map((it) => (
                    <button key={it.id} type="button" className="agenda-room-person" onClick={() => onOpen(it.id)}>
                      <strong>{it.contactLabel || 'Sem nome'}</strong>
                      <span>
                        {it.serviceName} · {formatSlotTime(it.startsAt, timezone)} – {formatSlotTime(it.endsAt, timezone)} · {shortName(it.professionalName)}
                      </span>
                    </button>
                  ))}
                  {!full ? (
                    <button type="button" className="agenda-room-free" onClick={onSchedule}>
                      <span>
                        {e.capacity - e.peak === 1 ? '1 lugar livre' : `${e.capacity - e.peak} lugares livres`}
                      </span>
                      <strong>Agendar</strong>
                    </button>
                  ) : null}
                </section>
              </li>
            )
          })}
        </ol>
      )}
    </div>
  )
}
