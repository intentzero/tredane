import { ChevronDown, Users } from 'lucide-react'
import { useState } from 'react'
import type { AgendaAppointmentItem, ScheduleHold } from '../../api'
import { formatSlotTime } from './format'
import { AttendanceBar } from './AttendanceBar'
import { initialsOf, PROFESSIONAL_TONES, shortName, type DayEntry } from './dayList'

export type AgendaProfessional = { id: string; name: string }

type Props = {
  entries: DayEntry[]
  holds: ScheduleHold[]
  professionals: AgendaProfessional[]
  timezone: string
  now: number
  onOpen: (id: string) => void
  onSchedule?: () => void
  onOpenHold: (hold: ScheduleHold) => void
  /** DEC-205: quem pode marcar chegada; se houver id, só nessa coluna. */
  attendanceForProfessionalId?: string | null
  canMarkAttendance?: boolean
  onSetAttendance?: (id: string, attendance: 'arrived' | 'no_show' | null) => void
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
  canMarkAttendance,
  onSetAttendance,
  now,
}: {
  item: AgendaAppointmentItem
  professionals: AgendaProfessional[]
  timezone: string
  now: number
  onOpen: (id: string) => void
  canMarkAttendance?: boolean
  onSetAttendance?: (id: string, attendance: 'arrived' | 'no_show' | null) => void
}) {
  // DEC-165 (tela 12): duas linhas; a profissional pela cor da margem e pelas iniciais
  // (o nome continua para leitor de tela), a sala no fim da segunda linha.
  const tone = toneOf(professionals, item.professionalId)
  const attendanceLabel = item.attendance === 'arrived' ? 'Chegou' : item.attendance === 'no_show' ? 'Não veio' : null
  return (
    <div className={`agenda-card-wrap agenda-card--tone-${tone}`}>
      <button type="button" className={`agenda-card agenda-card--tone-${tone}`} onClick={() => onOpen(item.id)}>
        <Mini pro={{ id: item.professionalId, name: item.professionalName }} professionals={professionals} />
        <span className="agenda-card-body">
          <span className="agenda-card-title">
            {item.contactLabel || 'Sem nome'}
            {attendanceLabel && !(canMarkAttendance && onSetAttendance) ? (
              <span className="agenda-attendance-badge"> · {attendanceLabel}</span>
            ) : null}
          </span>
          <span className="agenda-card-line">
            {item.serviceName} · até {formatSlotTime(item.endsAt, timezone)}
            {item.roomResourceName ? ` · ${item.roomResourceName}` : ''}
            {item.durationAdjusted ? ' · duração ajustada' : ''}
            {item.bookedByAi ? ' · Marcado pela IA' : ''}
            <span className="panel-sr-only"> · {item.professionalName}</span>
          </span>
        </span>
      </button>
      {canMarkAttendance && onSetAttendance ? <AttendanceBar item={item} now={now} onSet={onSetAttendance} /> : null}
    </div>
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
  onOpenHold,
  attendanceForProfessionalId = null,
  canMarkAttendance = false,
  onSetAttendance,
}: Props) {
  const [showResolved, setShowResolved] = useState(false)
  // Só hoje: o que já passou e já tem presença marcada recolhe numa linha.
  const nowIdx = entries.findIndex((e) => e.kind === 'now')
  const resolved =
    nowIdx < 0
      ? []
      : entries.filter(
          (e, i): e is Extract<DayEntry, { kind: 'apt' }> =>
            i < nowIdx && e.kind === 'apt' && e.item.status === 'confirmed' && e.item.attendance != null,
        )
  const collapse = resolved.length >= 2 && !showResolved
  const resolvedKeys = new Set(resolved.map((e) => e.key))
  const visible = collapse ? entries.filter((e) => !resolvedKeys.has(e.key)) : entries
  const arrivedN = resolved.filter((e) => e.item.attendance === 'arrived').length
  const noShowN = resolved.length - arrivedN
  const resolvedSummary =
    resolved.length < 2
      ? ''
      : `${formatSlotTime(resolved[0]!.startsAt, timezone)}–${formatSlotTime(
          Math.max(...resolved.map((e) => e.item.endsAt)),
          timezone,
        )} · ${resolved.length} anteriores${
          arrivedN > 0 ? ` · ${arrivedN} ${arrivedN === 1 ? 'chegou' : 'chegaram'}` : ''
        }${noShowN > 0 ? `${arrivedN > 0 ? ',' : ' ·'} ${noShowN} não ${noShowN === 1 ? 'veio' : 'vieram'}` : ''}`
  return (
    <div className="agenda-list">
      {holds.length > 0 ? (
        <section className="agenda-holds" aria-label="Hora a definir">
          <h2 className="agenda-list-h">Hora a definir</h2>
          {holds.map((h) => (
            <button key={h.id} type="button" className="agenda-hold" onClick={() => onOpenHold(h)}>
              <span className="agenda-card-title">{h.contactName || 'Sem nome'}</span>
              <span className="agenda-card-line">
                {h.serviceName} · {formatSlotTime(h.windowStartsAt, timezone)}–
                {formatSlotTime(h.windowEndsAt, timezone)} · {h.durationMinutes} min
              </span>
              <span className="agenda-hold-cta">Definir horário</span>
            </button>
          ))}
        </section>
      ) : null}

      {/* Dia vazio / buracos: sem cartão «Livre» nem faixa «Agendar horário» — o FAB cobre (Paulo). */}
      {entries.length === 0 ? null : (
        <ol className="agenda-rows" aria-label="Horários do dia">
          {resolved.length >= 2 ? (
            <li className="agenda-row agenda-row--resolved">
              <button
                type="button"
                className="agenda-resolved"
                aria-expanded={!collapse}
                onClick={() => setShowResolved((v) => !v)}
              >
                <ChevronDown aria-hidden size={18} strokeWidth={2} className="agenda-resolved-chev" />
                <span>{resolvedSummary}</span>
              </button>
            </li>
          ) : null}
          {visible.map((e, i) => {
            // Horários que começam juntos partilham a hora (só a primeira linha a mostra).
            const prev = i > 0 ? visible[i - 1] : undefined
            const sameStart = e.kind === 'apt' && prev?.kind === 'apt' && prev.startsAt === e.startsAt
            if (e.kind === 'now') {
              return (
                <li key={e.key} className="agenda-row agenda-row--now" aria-label="Agora">
                  <span className="agenda-now-line" aria-hidden="true" />
                  <span className="agenda-now-label">Agora {formatSlotTime(now, timezone)}</span>
                </li>
              )
            }
            if (e.kind === 'apt') {
              return (
                <li key={e.key} className={`agenda-row${sameStart ? ' agenda-row--same' : ''}`}>
                  <span className={`agenda-row-time${sameStart ? ' agenda-row-time--same' : ''}`}>
                    {formatSlotTime(e.startsAt, timezone)}
                  </span>
                  <AptCard
                    item={e.item}
                    professionals={professionals}
                    timezone={timezone}
                    now={now}
                    onOpen={onOpen}
                    canMarkAttendance={
                      canMarkAttendance &&
                      (attendanceForProfessionalId == null || e.item.professionalId === attendanceForProfessionalId)
                    }
                    onSetAttendance={onSetAttendance}
                  />
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
                    <strong>
                      {e.roomName}
                      {full ? ' · lotada' : ''}
                    </strong>
                    <span
                      className="agenda-seats"
                      role="img"
                      aria-label={`${e.peak} de ${e.capacity} lugares ocupados`}
                    >
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
                        {it.serviceName} · {formatSlotTime(it.startsAt, timezone)} –{' '}
                        {formatSlotTime(it.endsAt, timezone)} · {shortName(it.professionalName)}
                      </span>
                    </button>
                  ))}
                  {!full && onSchedule ? (
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
