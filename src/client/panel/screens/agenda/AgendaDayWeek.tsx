import { ChevronLeft, ChevronRight, Plus } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Button, ToggleButton, ToggleButtonGroup } from 'react-aria-components'
import {
  PanelApiError,
  type AgendaAppointmentItem,
  type AgendaViewResponse,
  type PanelApi,
} from '../../api'
import { errorDetail, friendlyError } from '../../copy/errors'
import { navigatePanel } from '../../routes'
import { Badge } from '../../states/Badge'
import { ErrorState, LoadingState } from '../../states/StatusScreens'
import {
  HOUR_HEIGHT,
  layoutDay,
  nowOffset,
  visibleHours,
} from './dayGrid'
import {
  formatDateRange,
  formatDayLabel,
  formatLongDate,
  formatSlotTime,
  upcomingCivilDates,
} from './format'

type Props = {
  tenantId: string
  api: PanelApi
  generation: number
  view: 'day' | 'week'
}

const DEFAULT_TZ = 'America/Sao_Paulo'

function shiftCivil(date: string, delta: number): string {
  const [y, m, d] = date.split('-').map(Number)
  const dt = new Date(Date.UTC(y!, m! - 1, d! + delta))
  const yy = dt.getUTCFullYear()
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(dt.getUTCDate()).padStart(2, '0')
  return `${yy}-${mm}-${dd}`
}

function civilDayOf(ms: number, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(ms))
}

function detailRoute(tenantId: string, id: string) {
  return {
    kind: 'area',
    area: 'agenda',
    tenantId,
    section: 'compromisso',
    appointmentId: id,
  } as const
}

/**
 * TEL-04 / M-06 / M-13 — visão dia e semana (#36 / REQ-034).
 * A API de semana traz a semana inteira; o dia usa a mesma resposta (e a faixa
 * da semana mostra quais dias têm horário marcado).
 */
export function AgendaDayWeek({ tenantId, api, generation, view }: Props) {
  const [date, setDate] = useState(() => upcomingCivilDates(DEFAULT_TZ, Date.now(), 1)[0]!)
  const [data, setData] = useState<AgendaViewResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [detail, setDetail] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [now, setNow] = useState(() => Date.now())

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    setDetail(null)
    try {
      const res = await api.queryAgenda(
        tenantId,
        { date, view: 'week' },
        { generation, expectGeneration: () => generation },
      )
      setData(res)
    } catch (err) {
      if (err instanceof PanelApiError && err.message === 'stale_tenant_response') return
      setError(friendlyError(err, 'Não conseguimos carregar a agenda.'))
      setDetail(errorDetail(err))
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [api, tenantId, generation, date])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    const id = window.setInterval(() => {
      setNow(Date.now())
      void load()
    }, 15_000)
    return () => window.clearInterval(id)
  }, [load])

  const timezone = data?.timezone ?? DEFAULT_TZ
  const today = upcomingCivilDates(timezone, now, 1)[0]!
  const step = view === 'week' ? 7 : 1

  if (loading && !data) return <LoadingState label="Carregando agenda…" />
  if (error && !data) {
    return (
      <ErrorState
        title="Agenda indisponível"
        description={error}
        detail={detail}
        actionLabel="Tentar de novo"
        onAction={() => void load()}
      />
    )
  }

  const appointments = (data?.appointments ?? []).filter((a) => a.status !== 'cancelled')
  const byDay = new Map<string, AgendaAppointmentItem[]>()
  for (const apt of appointments) {
    const civil = civilDayOf(apt.startsAt, timezone)
    const list = byDay.get(civil) ?? []
    list.push(apt)
    byDay.set(civil, list)
  }

  const weekStart = data ? civilDayOf(data.rangeStartsAt, timezone) : date
  const weekDays = Array.from({ length: 7 }, (_, i) => shiftCivil(weekStart, i))
  const subtitle =
    view === 'week'
      ? formatDateRange(weekDays[0]!, weekDays[6]!, timezone)
      : formatLongDate(date, timezone)

  const goSchedule = () =>
    navigatePanel({ kind: 'area', area: 'agenda', tenantId, section: 'agendar' })

  return (
    <div className="agenda-day" data-screen={view === 'week' ? 'm13-semana' : 'm06-agenda'}>
      <header className="agenda-head">
        <div className="agenda-head-text">
          <h1 className="panel-title">{subtitle}</h1>
          <span className="panel-subtitle">
            {view === 'week' ? 'Semana' : date === today ? 'Hoje' : 'Dia'}
          </span>
        </div>
        <Button className="panel-btn-primary panel-btn-compact agenda-add" onPress={goSchedule}>
          <Plus aria-hidden size={18} strokeWidth={2} />
          Agendar
        </Button>
      </header>

      <ToggleButtonGroup
        className="panel-segmented"
        aria-label="Visão da agenda"
        selectionMode="single"
        disallowEmptySelection
        selectedKeys={[view]}
        onSelectionChange={(keys) => {
          const next = [...keys][0]
          if (next !== 'day' && next !== 'week') return
          navigatePanel({
            kind: 'area',
            area: 'agenda',
            tenantId,
            section: next === 'day' ? 'dia' : 'semana',
          })
        }}
      >
        <ToggleButton id="day" className="panel-segmented-item">
          Dia
        </ToggleButton>
        <ToggleButton id="week" className="panel-segmented-item">
          Semana
        </ToggleButton>
      </ToggleButtonGroup>

      <div className="agenda-nav" role="group" aria-label="Navegação de data">
        <Button
          className="panel-icon-btn"
          aria-label={view === 'week' ? 'Semana anterior' : 'Dia anterior'}
          onPress={() => setDate((d) => shiftCivil(d, -step))}
        >
          <ChevronLeft aria-hidden size={20} strokeWidth={2} />
        </Button>
        <Button
          className="panel-chip agenda-today"
          isDisabled={view === 'day' ? date === today : weekDays.includes(today)}
          onPress={() => setDate(today)}
        >
          Hoje
        </Button>
        <Button
          className="panel-icon-btn"
          aria-label={view === 'week' ? 'Próxima semana' : 'Próximo dia'}
          onPress={() => setDate((d) => shiftCivil(d, step))}
        >
          <ChevronRight aria-hidden size={20} strokeWidth={2} />
        </Button>
      </div>

      <div className="agenda-weekstrip" role="group" aria-label="Dias da semana">
        {weekDays.map((day) => {
          const label = formatDayLabel(day, timezone)
          const count = byDay.get(day)?.length ?? 0
          const selected = view === 'day' && day === date
          return (
            <button
              key={day}
              type="button"
              className={`agenda-weekday${selected ? ' agenda-weekday--on' : ''}${day === today ? ' agenda-weekday--today' : ''}`}
              aria-pressed={selected}
              aria-label={`${formatLongDate(day, timezone)}${count > 0 ? `, ${count} ${count === 1 ? 'horário' : 'horários'}` : ''}`}
              onClick={() => {
                setDate(day)
                if (view !== 'day') {
                  navigatePanel({ kind: 'area', area: 'agenda', tenantId, section: 'dia' })
                }
              }}
            >
              <span className="agenda-weekday-name">{label.weekday}</span>
              <span className="agenda-weekday-num">{label.day}</span>
              <span
                className={`agenda-weekday-dot${count > 0 ? ' agenda-weekday-dot--on' : ''}`}
                aria-hidden
              />
            </button>
          )
        })}
      </div>

      <div className="panel-scroll agenda-body">
        {view === 'day' ? (
          <DayGrid
            items={byDay.get(date) ?? []}
            timezone={timezone}
            isToday={date === today}
            now={now}
            onOpen={(id) => navigatePanel(detailRoute(tenantId, id))}
            onSchedule={goSchedule}
          />
        ) : (
          weekDays.map((day) => {
            const label = formatDayLabel(day, timezone)
            const items = byDay.get(day) ?? []
            return (
              <section key={day} className="agenda-day-group">
                <h2 className="panel-legend">
                  {label.weekday} {label.day}
                  {day === today ? <Badge tone="new">Hoje</Badge> : null}
                </h2>
                {items.length === 0 ? (
                  <p className="panel-meta">Nenhum horário marcado.</p>
                ) : (
                  <ul className="agenda-apt-list">
                    {items.map((apt) => (
                      <li key={apt.id}>
                        <button
                          type="button"
                          className="agenda-apt"
                          onClick={() => navigatePanel(detailRoute(tenantId, apt.id))}
                        >
                          <span className="agenda-apt-time">
                            {formatSlotTime(apt.startsAt, timezone)}
                            {' – '}
                            {formatSlotTime(apt.endsAt, timezone)}
                          </span>
                          <span className="agenda-apt-title">
                            {apt.contactLabel || apt.serviceName}
                          </span>
                          <span className="agenda-apt-meta">
                            {apt.serviceName}
                            {' · '}
                            {apt.professionalName}
                            {apt.roomResourceName ? ` · ${apt.roomResourceName}` : ''}
                            {apt.durationAdjusted ? ' · duração ajustada' : ''}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )
          })
        )}
      </div>
    </div>
  )
}

function DayGrid({
  items,
  timezone,
  isToday,
  now,
  onOpen,
  onSchedule,
}: {
  items: AgendaAppointmentItem[]
  timezone: string
  isToday: boolean
  now: number
  onOpen: (id: string) => void
  onSchedule: () => void
}) {
  const { startHour, endHour } = visibleHours(items, timezone)
  const placed = layoutDay(items, timezone, startHour)
  const hours = Array.from({ length: endHour - startHour }, (_, i) => startHour + i)
  const nowTop = isToday ? nowOffset(now, timezone, startHour, endHour) : null

  return (
    <>
      {items.length === 0 ? (
        <div className="agenda-empty" role="status">
          <p>Nenhum horário marcado neste dia.</p>
          <Button className="panel-btn-secondary panel-btn-compact" onPress={onSchedule}>
            Agendar horário
          </Button>
        </div>
      ) : null}
      <div
        className="agenda-grid"
        style={{ height: hours.length * HOUR_HEIGHT }}
        role="list"
        aria-label="Horários do dia"
      >
        {hours.map((h, i) => (
          <div key={h} className="agenda-hour" style={{ top: i * HOUR_HEIGHT }} aria-hidden>
            <span className="agenda-hour-label">{h}:00</span>
          </div>
        ))}
        {nowTop != null ? (
          <div className="agenda-now" style={{ top: nowTop }} aria-hidden>
            <span className="agenda-now-dot" />
          </div>
        ) : null}
        {placed.map(({ item, top, height, lane, lanes }) => (
          <button
            key={item.id}
            type="button"
            role="listitem"
            className="agenda-block"
            style={{
              top,
              height,
              left: `calc(var(--agenda-gutter) + (100% - var(--agenda-gutter)) * ${lane / lanes})`,
              width: `calc((100% - var(--agenda-gutter)) * ${1 / lanes} - 4px)`,
            }}
            onClick={() => onOpen(item.id)}
          >
            <span className="agenda-block-title">{item.serviceName}</span>
            <span className="agenda-block-time">
              {formatSlotTime(item.startsAt, timezone)}
              {' – '}
              {formatSlotTime(item.endsAt, timezone)}
            </span>
            {height >= 64 ? (
              <span className="agenda-block-meta">
                {item.contactLabel ?? 'Sem nome'}
                {' · '}
                {item.professionalName}
                {item.roomResourceName ? ` · ${item.roomResourceName}` : ''}
              </span>
            ) : null}
          </button>
        ))}
      </div>
    </>
  )
}
