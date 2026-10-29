import { ChevronLeft, ChevronRight, Plus } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Button, ToggleButton, ToggleButtonGroup } from 'react-aria-components'
import {
  PanelApiError,
  type AgendaAppointmentItem,
  type AgendaViewResponse,
  type ClinicConfigSnapshot,
  type PanelApi,
  type ScheduleHold,
} from '../../api'
import { errorDetail, friendlyError } from '../../copy/errors'
import { navigatePanel } from '../../routes'
import { Badge } from '../../states/Badge'
import { ListSkeleton } from '../../states/ListSkeleton'
import { ErrorState } from '../../states/StatusScreens'
import { useMediaQuery } from '../../ui/useMediaQuery'
import { useVisiblePolling } from '../../ui/useVisiblePolling'
import { AgendaContext } from './AgendaContext'
import { AgendaDayList } from './AgendaDayList'
import { CompromissoScreen } from './CompromissoScreen'
import { buildDayEntries, initialsOf, shortName } from './dayList'
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
  /** Compromisso aberto no painel por cima (rota `…/agenda/compromisso/:id`, só no desktop). */
  openId?: string
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
export function AgendaDayWeek({ tenantId, api, generation, view, openId }: Props) {
  const [date, setDate] = useState(() => upcomingCivilDates(DEFAULT_TZ, Date.now(), 1)[0]!)
  const [data, setData] = useState<AgendaViewResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [detail, setDetail] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [now, setNow] = useState(() => Date.now())
  const narrow = useMediaQuery('(max-width: 767.98px)')
  const [config, setConfig] = useState<ClinicConfigSnapshot | null>(null)
  const [selected, setSelected] = useState<string[]>([])
  const [selectedRooms, setSelectedRooms] = useState<string[]>([])
  // Desktop (DEC-068): coluna de contexto ao lado da grade.
  const wide = useMediaQuery('(min-width: 1280px)')
  const returnFocus = useRef<HTMLElement | null>(null)
  const panelRef = useRef<HTMLElement | null>(null)
  const panelOpen = wide && openId != null

  // Esc fecha o painel; o foco vai ao painel ao abrir e volta ao item ao fechar.
  useEffect(() => {
    if (!panelOpen) return
    panelRef.current?.focus({ preventScroll: true })
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented) closePanel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [panelOpen, openId])

  function closePanel() {
    navigatePanel({ kind: 'area', area: 'agenda', tenantId, section: view === 'week' ? 'semana' : 'dia' })
    returnFocus.current?.focus?.({ preventScroll: true })
  }

  function openAppointment(id: string) {
    if (wide && openId === id) {
      closePanel()
      return
    }
    if (wide && !openId) returnFocus.current = document.activeElement as HTMLElement | null
    navigatePanel(detailRoute(tenantId, id))
  }

  useEffect(() => {
    let cancelled = false
    api
      .getClinicConfig(tenantId, { generation, expectGeneration: () => generation })
      .then((snap) => {
        if (!cancelled) setConfig(snap)
      })
      .catch(() => {
        /* sem cadastro legível: a lista continua, sem filtro por pessoa */
      })
    return () => {
      cancelled = true
    }
  }, [api, tenantId, generation])

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

  useVisiblePolling(() => {
    setNow(Date.now())
    void load()
  }, 15_000)

  const timezone = data?.timezone ?? DEFAULT_TZ
  const today = upcomingCivilDates(timezone, now, 1)[0]!
  const step = view === 'week' ? 7 : 1

  if (loading && !data) return <ListSkeleton label="Carregando agenda…" rows={5} />
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

  const allAppointments = (data?.appointments ?? []).filter((a) => a.status !== 'cancelled')
  const professionals = (config?.resources ?? [])
    .filter((r) => r.kind === 'professional' && r.active)
    .map((r) => ({ id: r.id, name: r.name }))
  const rooms = (config?.resources ?? [])
    .filter((r) => r.kind === 'room' && r.active)
    .map((r) => ({ id: r.id, name: r.name }))
  const roomCapacity = new Map(
    (config?.resources ?? []).filter((r) => r.kind === 'room').map((r) => [r.id, r.capacity ?? 1] as const),
  )
  const byDay = new Map<string, AgendaAppointmentItem[]>()
  for (const apt of allAppointments) {
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
    navigatePanel({ kind: 'area', area: 'agenda', tenantId, section: 'agendar', date })

  const dayLabel = formatDayLabel(date, timezone)
  const passesFilters = (a: AgendaAppointmentItem) =>
    (selected.length === 0 || selected.includes(a.professionalId)) &&
    (selectedRooms.length === 0 || (a.roomResourceId != null && selectedRooms.includes(a.roomResourceId)))
  const entries = buildDayEntries(
    (byDay.get(date) ?? []).filter(passesFilters),
    roomCapacity,
    date === today ? now : null,
  )
  const holds: ScheduleHold[] = (data?.holds ?? []).filter(
    (h) => h.status === 'active' && civilDayOf(h.windowStartsAt, timezone) === date,
  )
  const countOf = (id: string) => (byDay.get(date) ?? []).filter((a) => a.professionalId === id).length
  const dayCount = byDay.get(date)?.length ?? 0
  const summary = (() => {
    if (view !== 'day') return null
    const names = professionals.filter((p) => selected.includes(p.id)).map((p) => shortName(p.name))
    const n = entries.filter((e) => e.kind !== 'now').length
    const base = names.length > 0 ? names.join(' e ') : `Todos os ${professionals.length} profissionais`
    return `${base} · ${dayCount === 0 ? 'nenhum horário' : `${n} ${n === 1 ? 'horário' : 'horários'}`}`
  })()

  const work = (
    <div className="agenda-day" data-screen={view === 'week' ? 'm13-semana' : 'm06-agenda'}>
      <header className="agenda-head">
        <div className="agenda-head-text">
          {narrow ? (
            <>
              <h1 className="panel-title agenda-head-title">Agenda</h1>
              <span className="panel-subtitle">
                {view === 'week' ? subtitle : `${date === today ? 'Hoje · ' : ''}${subtitle}`}
              </span>
            </>
          ) : (
            <>
              <h1 className="panel-title">{subtitle}</h1>
              <span className="panel-subtitle">
                {view === 'week' ? 'Semana' : date === today ? 'Hoje' : 'Dia'}
              </span>
            </>
          )}
        </div>
        {narrow || wide ? null : (
          <Button className="panel-btn-primary panel-btn-compact agenda-add" onPress={goSchedule}>
            <Plus aria-hidden size={18} strokeWidth={2} />
            Agendar
          </Button>
        )}
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

      {wide ? null : (
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
                <span className={`agenda-weekday-count${count > 0 ? ' agenda-weekday-count--on' : ''}`} aria-hidden>
                  {count > 0 ? count : '·'}
                </span>
              </button>
            )
          })}
        </div>
      )}

      {narrow && view === 'day' && professionals.length > 1 ? (
        <>
          <div className="agenda-pros">
            <div className="agenda-pros-list" role="group" aria-label="Filtrar por profissional">
              {professionals.map((p, i) => {
                const on = selected.includes(p.id)
                return (
                  <button
                    key={p.id}
                    type="button"
                    className="agenda-pro"
                    aria-pressed={on}
                    aria-label={`${p.name}, ${countOf(p.id)} ${countOf(p.id) === 1 ? 'horário' : 'horários'}`}
                    data-dim={selected.length > 0 && !on ? '' : undefined}
                    onClick={() =>
                      setSelected((cur) => (cur.includes(p.id) ? cur.filter((x) => x !== p.id) : [...cur, p.id]))
                    }
                  >
                    <span className={`agenda-avatar agenda-tone-${i % 4}`} aria-hidden>
                      {initialsOf(p.name)}
                    </span>
                    <span>
                      {shortName(p.name)} · {countOf(p.id)}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
          <p className="agenda-summary" role="status">
            <span>{summary}</span>
            {selected.length > 0 ? (
              <button type="button" onClick={() => setSelected([])}>
                Ver todos
              </button>
            ) : null}
          </p>
        </>
      ) : null}

      <div className="panel-scroll agenda-body">
        {view === 'day' && narrow ? (
          <AgendaDayList
            entries={entries}
            holds={holds}
            professionals={professionals}
            timezone={timezone}
            now={now}
            onOpen={(id) => openAppointment(id)}
            onSchedule={goSchedule}
            onOpenHold={(h) =>
              navigatePanel({ kind: 'area', area: 'conversas', tenantId, section: 'thread', conversationId: h.conversationId })
            }
            emptyText={
              selected.length > 0 ? 'Nenhum horário para esta seleção.' : `Nenhum horário marcado ${date === today ? 'hoje' : `em ${dayLabel.weekday} ${dayLabel.day}`}.`
            }
          />
        ) : view === 'day' ? (
          <DayGrid
            items={(byDay.get(date) ?? []).filter(passesFilters)}
            timezone={timezone}
            isToday={date === today}
            now={now}
            onOpen={(id) => openAppointment(id)}
            onSchedule={goSchedule}
          />
        ) : (
          weekDays.map((day) => {
            const label = formatDayLabel(day, timezone)
            const items = (byDay.get(day) ?? []).filter(
              (a) => !narrow || selected.length === 0 || selected.includes(a.professionalId),
            )
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
                          onClick={() => openAppointment(apt.id)}
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
                            {apt.bookedByAi ? ' · Marcado pela IA' : ''}
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

      {narrow && view === 'day' ? (
        <Button className="agenda-fab" onPress={goSchedule} aria-label={`Agendar ${dayLabel.weekday} ${dayLabel.day}`}>
          <Plus aria-hidden size={20} strokeWidth={2} />
          Agendar {date === today ? 'hoje' : dayLabel.weekday}
        </Button>
      ) : null}
    </div>
  )

  if (!wide) return work

  const toggle = (set: (fn: (cur: string[]) => string[]) => void, id: string) =>
    set((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]))
  return (
    <div className="agenda-wide">
      <AgendaContext
        date={date}
        today={today}
        timezone={timezone}
        now={now}
        dayTitle={`${date === today ? 'Hoje · ' : ''}${formatLongDate(date, timezone)}`}
        professionals={professionals}
        rooms={rooms}
        selectedPros={selected}
        selectedRooms={selectedRooms}
        countOf={countOf}
        entries={entries}
        holds={holds}
        emptyText={
          selected.length > 0 || selectedRooms.length > 0
            ? 'Nenhum horário para esta seleção.'
            : `Nenhum horário marcado ${date === today ? 'hoje' : `em ${dayLabel.weekday} ${dayLabel.day}`}.`
        }
        onPickDate={setDate}
        onTogglePro={(id) => toggle(setSelected, id)}
        onToggleRoom={(id) => toggle(setSelectedRooms, id)}
        onClearFilters={() => {
          setSelected([])
          setSelectedRooms([])
        }}
        onSchedule={goSchedule}
        onOpen={(id) => openAppointment(id)}
        onOpenHold={(h) =>
          navigatePanel({ kind: 'area', area: 'conversas', tenantId, section: 'thread', conversationId: h.conversationId })
        }
      />
      {work}
      {panelOpen ? (
        <aside
          id="agenda-panel"
          ref={panelRef}
          tabIndex={-1}
          className="agenda-panel"
          aria-label="Compromisso"
        >
          <CompromissoScreen
            key={openId}
            tenantId={tenantId}
            appointmentId={openId!}
            api={api}
            generation={generation}
            onClose={closePanel}
            onChanged={() => void load()}
          />
        </aside>
      ) : null}
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
