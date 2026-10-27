import { ChevronLeft, ChevronRight, Plus } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Button, ToggleButton, ToggleButtonGroup } from 'react-aria-components'
import {
  PanelApiError,
  type AgendaViewResponse,
  type PanelApi,
} from '../../api'
import { navigatePanel } from '../../routes'
import { ErrorState, LoadingState } from '../../states/StatusScreens'
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

function shiftCivil(date: string, delta: number): string {
  const [y, m, d] = date.split('-').map(Number)
  const dt = new Date(Date.UTC(y!, m! - 1, d! + delta))
  const yy = dt.getUTCFullYear()
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(dt.getUTCDate()).padStart(2, '0')
  return `${yy}-${mm}-${dd}`
}

/**
 * TEL-04 / M-06 / M-13 — visão dia e semana (#36 / REQ-034).
 */
export function AgendaDayWeek({ tenantId, api, generation, view }: Props) {
  const [date, setDate] = useState(() =>
    upcomingCivilDates('America/Sao_Paulo', Date.now(), 1)[0]!,
  )
  const [data, setData] = useState<AgendaViewResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await api.queryAgenda(
        tenantId,
        { date, view },
        { generation, expectGeneration: () => generation },
      )
      setData(res)
    } catch (err) {
      if (err instanceof PanelApiError && err.message === 'stale_tenant_response') return
      setError(err instanceof Error ? err.message : 'Falha ao carregar agenda')
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [api, tenantId, generation, date, view])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    const id = window.setInterval(() => void load(), 15_000)
    return () => window.clearInterval(id)
  }, [load])

  const timezone = data?.timezone ?? 'America/Sao_Paulo'
  const step = view === 'week' ? 7 : 1
  const title = view === 'week' ? 'Agenda da semana' : 'Agenda do dia'

  if (loading && !data) return <LoadingState label="Carregando agenda…" />
  if (error && !data) {
    return (
      <ErrorState
        title="Agenda indisponível"
        description={error}
        actionLabel="Tentar de novo"
        onAction={() => void load()}
      />
    )
  }

  const appointments = data?.appointments ?? []
  const byDay = new Map<string, typeof appointments>()
  for (const apt of appointments) {
    const civil = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date(apt.startsAt))
    const list = byDay.get(civil) ?? []
    list.push(apt)
    byDay.set(civil, list)
  }

  const days =
    view === 'week'
      ? Array.from({ length: 7 }, (_, i) => {
          // data âncora → segunda da semana já resolvida no servidor via range;
          // listar dias civis a partir do rangeStartsAt.
          const start = data
            ? new Intl.DateTimeFormat('en-CA', {
                timeZone: timezone,
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
              }).format(new Date(data.rangeStartsAt))
            : date
          return shiftCivil(start, i)
        })
      : [date]

  const subtitle =
    view === 'week'
      ? formatDateRange(days[0]!, days[days.length - 1]!, timezone)
      : formatLongDate(date, timezone)

  return (
    <div className="agenda-day" data-screen={view === 'week' ? 'm13-semana' : 'm06-agenda'}>
      <header className="panel-header">
        <div>
          <h1 className="panel-title">{title}</h1>
          <span className="panel-subtitle">{subtitle}</span>
        </div>
        <Button
          className="panel-icon-btn"
          aria-label="Agendar horário"
          onPress={() =>
            navigatePanel({
              kind: 'area',
              area: 'agenda',
              tenantId,
              section: 'agendar',
            })
          }
        >
          <Plus aria-hidden size={22} strokeWidth={2} />
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

      <div className="agenda-date-nav" role="group" aria-label="Navegação de data">
        <Button
          className="panel-icon-btn"
          aria-label="Anterior"
          onPress={() => setDate((d) => shiftCivil(d, -step))}
        >
          <ChevronLeft aria-hidden size={20} strokeWidth={2} />
        </Button>
        <Button
          className="panel-chip agenda-today"
          onPress={() =>
            setDate(upcomingCivilDates(timezone, Date.now(), 1)[0]!)
          }
        >
          Hoje
        </Button>
        <Button
          className="panel-icon-btn"
          aria-label="Seguinte"
          onPress={() => setDate((d) => shiftCivil(d, step))}
        >
          <ChevronRight aria-hidden size={20} strokeWidth={2} />
        </Button>
      </div>

      <div className="panel-scroll">
        {days.map((day) => {
          const label = formatDayLabel(day, timezone)
          const items = byDay.get(day) ?? []
          return (
            <section key={day} className="agenda-day-group">
              <h2 className="panel-legend">
                {label.weekday} {label.day}
              </h2>
              {items.length === 0 ? (
                <p className="panel-meta">
                  Sem compromissos.{' '}
                  <button
                    type="button"
                    className="panel-link"
                    onClick={() =>
                      navigatePanel({
                        kind: 'area',
                        area: 'agenda',
                        tenantId,
                        section: 'agendar',
                      })
                    }
                  >
                    Agendar
                  </button>
                </p>
              ) : (
                <ul className="agenda-apt-list">
                  {items.map((apt) => (
                    <li key={apt.id}>
                      <button
                        type="button"
                        className="agenda-apt"
                        onClick={() =>
                          navigatePanel({
                            kind: 'area',
                            area: 'agenda',
                            tenantId,
                            section: 'compromisso',
                            appointmentId: apt.id,
                          })
                        }
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
                          {apt.professionalName}
                          {apt.roomResourceName
                            ? ` · ${apt.roomResourceName}`
                            : ''}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )
        })}
      </div>
    </div>
  )
}
