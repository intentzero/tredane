import { ChevronDown, ChevronLeft, ChevronRight, Plus } from 'lucide-react'
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
import { useOutsideClose } from '../../ui/useOutsideClose'
import { navigatePanel } from '../../routes'
import { Badge } from '../../states/Badge'
import { ListSkeleton } from '../../states/ListSkeleton'
import { ErrorState } from '../../states/StatusScreens'
import { useMediaQuery } from '../../ui/useMediaQuery'
import { useVisiblePolling } from '../../ui/useVisiblePolling'
import { isScheduleEvent, useInboxRealtime } from '../../realtime/InboxRealtime'
import { ShellSlot } from '../../shell/ShellSlot'
import { AgendaContext } from './AgendaContext'
import { AgendaDayList } from './AgendaDayList'
import { CompromissoScreen } from './CompromissoScreen'
import { buildDayEntries, initialsOf, shortName } from './dayList'
import { freeSlotsOfDay, occupancyOfDay, type DayOccupancy, type FreeSlot } from './freeSlots'
import {
  HOUR_HEIGHT,
  layoutDay,
  nowOffset,
  visibleHours,
} from './dayGrid'
import {
  civilDateInZone,
  formatDateRange,
  formatDayLabel,
  formatLongDate,
  formatShortDate,
  formatSlotTime,
  isCivilDateParam,
  upcomingCivilDates,
} from './format'

type Props = {
  tenantId: string
  api: PanelApi
  generation: number
  view: 'day' | 'week'
  /** Compromisso aberto no painel por cima (rota `…/agenda/compromisso/:id`, só no desktop). */
  openId?: string
  /** Dia civil AAAA-MM-DD da rota/query — deep link (Acompanhamento / Agendar). */
  focusDate?: string
  /** Responsável: «Permitir os dois» no detalhe (DEC-075 / S5). */
  isOwner?: boolean
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
  return civilDateInZone(ms, timeZone)
}

function detailRoute(tenantId: string, id: string, date?: string) {
  return {
    kind: 'area',
    area: 'agenda',
    tenantId,
    section: 'compromisso',
    appointmentId: id,
    ...(isCivilDateParam(date) ? { date } : {}),
  } as const
}

/**
 * TEL-04 / M-06 / M-13 — visão dia e semana (#36 / REQ-034).
 * A API de semana traz a semana inteira; o dia usa a mesma resposta (e a faixa
 * da semana mostra quais dias têm horário marcado).
 */
export function AgendaDayWeek({
  tenantId,
  api,
  generation,
  view,
  openId,
  focusDate,
  isOwner = false,
}: Props) {
  const [date, setDate] = useState(
    () =>
      (isCivilDateParam(focusDate) ? focusDate : null) ??
      upcomingCivilDates(DEFAULT_TZ, Date.now(), 1)[0]!,
  )
  const [data, setData] = useState<AgendaViewResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [detail, setDetail] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [now, setNow] = useState(() => Date.now())
  const [openDay, setOpenDay] = useState<string | null>(null)
  const narrow = useMediaQuery('(max-width: 767.98px)')
  const [config, setConfig] = useState<ClinicConfigSnapshot | null>(null)
  const [selected, setSelected] = useState<string[]>([])
  const [selectedRooms, setSelectedRooms] = useState<string[]>([])
  // Desktop (DEC-068): coluna de contexto ao lado da grade.
  const wide = useMediaQuery('(min-width: 1280px)')
  const returnFocus = useRef<HTMLElement | null>(null)
  const panelRef = useRef<HTMLElement | null>(null)
  const panelOpen = wide && openId != null
  useOutsideClose(panelRef, () => closePanel(), panelOpen)

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
    navigatePanel({
      kind: 'area',
      area: 'agenda',
      tenantId,
      section: view === 'week' ? 'semana' : 'dia',
      date,
    })
    returnFocus.current?.focus?.({ preventScroll: true })
  }

  function openAppointment(id: string) {
    if (wide && openId === id) {
      closePanel()
      return
    }
    if (wide && !openId) returnFocus.current = document.activeElement as HTMLElement | null
    navigatePanel(detailRoute(tenantId, id, date))
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

  // Deep link: query `date=` e/ou compromisso noutro dia ≠ hoje.
  useEffect(() => {
    if (isCivilDateParam(focusDate)) {
      setDate((cur) => (cur === focusDate ? cur : focusDate))
      return
    }
    if (!openId) return
    let cancelled = false
    const local = data?.appointments.find((a) => a.id === openId)
    if (local) {
      const civil = civilDayOf(local.startsAt, data!.timezone)
      setDate((cur) => (cur === civil ? cur : civil))
      return
    }
    void api
      .getAppointment(tenantId, openId, {
        generation,
        expectGeneration: () => generation,
      })
      .then((apt) => {
        if (cancelled) return
        const tz = data?.timezone ?? config?.settings?.timezone ?? DEFAULT_TZ
        const civil = civilDayOf(apt.startsAt, tz)
        setDate((cur) => (cur === civil ? cur : civil))
      })
      .catch(() => {
        /* mantém o dia actual se o compromisso não carregar */
      })
    return () => {
      cancelled = true
    }
  }, [openId, focusDate, data, api, tenantId, generation, config])

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

  // contact.deleted anonimiza rótulos — refetch imediato (AC-52), sem esperar o poll.
  useInboxRealtime((signals) => {
    const touch = signals.some(
      (s) =>
        s.kind === 'resync' ||
        (s.kind === 'event' && isScheduleEvent(s.event)),
    )
    if (touch) void load()
  })

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
  const freeToday = freeSlotsOfDay(data?.availability, date, selected)
  const listEntries = buildDayEntries(
    (byDay.get(date) ?? []).filter(passesFilters),
    roomCapacity,
    date === today ? now : null,
    freeToday,
  )
  const goScheduleAt = (slot: FreeSlot) =>
    navigatePanel({
      kind: 'area',
      area: 'agenda',
      tenantId,
      section: 'agendar',
      date,
      time: formatSlotTime(slot.startsAt, timezone),
      professionalId: slot.professionalId,
    })
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

  // DEC-169: no desktop, navegação, data, Dia/Semana e Agendar vão para o
  // cabeçalho do shell; no celular, uma linha (data + Dia/Semana) e a faixa
  // de dias com setas de semana.
  const onToday = view === 'day' ? date === today : weekDays.includes(today)
  const offToday = !onToday
  const headTitle =
    view === 'week' ? subtitle : `${date === today ? 'Hoje · ' : ''}${formatShortDate(date, timezone)}`
  const viewToggle = (
    <ToggleButtonGroup
      className="panel-segmented agenda-view-toggle"
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
  )

  const work = (
    <div className="agenda-day" data-screen={view === 'week' ? 'm13-semana' : 'm06-agenda'}>
      {narrow ? (
        <div className="agenda-mhead">
          <h2 className="agenda-mhead-title">{headTitle}</h2>
          {offToday ? (
            <Button className="panel-chip agenda-today" onPress={() => setDate(today)}>
              Hoje
            </Button>
          ) : null}
          {viewToggle}
        </div>
      ) : (
        <ShellSlot>
          <div className="agenda-bar">
            <div className="agenda-bar-nav" role="group" aria-label="Navegação de data">
              <Button
                className="agenda-bar-btn"
                aria-label={view === 'week' ? 'Semana anterior' : 'Dia anterior'}
                onPress={() => setDate((d) => shiftCivil(d, -step))}
              >
                <ChevronLeft aria-hidden size={18} strokeWidth={2} />
              </Button>
              <Button
                className="agenda-bar-btn"
                aria-label={view === 'week' ? 'Próxima semana' : 'Próximo dia'}
                onPress={() => setDate((d) => shiftCivil(d, step))}
              >
                <ChevronRight aria-hidden size={18} strokeWidth={2} />
              </Button>
              <Button className="agenda-bar-btn agenda-bar-today" isDisabled={!offToday} onPress={() => setDate(today)}>
                Hoje
              </Button>
            </div>
            <h2 className="agenda-bar-title">{subtitle}</h2>
            {onToday ? <span className="agenda-bar-badge">Hoje</span> : null}
            <span className="agenda-bar-spacer" />
            {viewToggle}
            <Button className="panel-btn-primary panel-btn-compact agenda-add" onPress={goSchedule}>
              <Plus aria-hidden size={18} strokeWidth={2} />
              Agendar
            </Button>
          </div>
        </ShellSlot>
      )}

      {wide ? null : (
        <div className="agenda-weekstrip" role="group" aria-label="Dias da semana">
          {narrow ? (
            <Button
              className="agenda-weekstrip-arrow"
              aria-label="Semana anterior"
              onPress={() => setDate((d) => shiftCivil(d, -7))}
            >
              <ChevronLeft aria-hidden size={18} strokeWidth={2} />
            </Button>
          ) : null}
          <div className="agenda-weekstrip-days">
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
          {narrow ? (
            <Button
              className="agenda-weekstrip-arrow"
              aria-label="Próxima semana"
              onPress={() => setDate((d) => shiftCivil(d, 7))}
            >
              <ChevronRight aria-hidden size={18} strokeWidth={2} />
            </Button>
          ) : null}
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
            entries={listEntries}
            holds={holds}
            professionals={professionals}
            timezone={timezone}
            now={now}
            onOpen={(id) => openAppointment(id)}
            onSchedule={goSchedule}
            onScheduleAt={goScheduleAt}
            onOpenHold={(h) =>
              navigatePanel({ kind: 'area', area: 'conversas', tenantId, section: 'thread', conversationId: h.conversationId })
            }
          />
        ) : view === 'day' ? (
          <DayGrid
            items={(byDay.get(date) ?? []).filter(passesFilters)}
            professionals={
              selected.length > 0 ? professionals.filter((p) => selected.includes(p.id)) : professionals
            }
            timezone={timezone}
            isToday={date === today}
            now={now}
            onOpen={(id) => openAppointment(id)}
          />
        ) : (
          weekDays.map((day) => {
            const label = formatDayLabel(day, timezone)
            const items = (byDay.get(day) ?? []).filter(
              (a) => !narrow || selected.length === 0 || selected.includes(a.professionalId),
            )
            const occupancy = occupancyOfDay(data?.availability, day, narrow ? selected : [])
            const freeCount = freeSlotsOfDay(data?.availability, day, narrow ? selected : []).length
            if (narrow) {
              const isOpen = (openDay ?? today) === day
              const n = items.length
              const panelId = `agenda-week-${day}`
              return (
                <section
                  key={day}
                  className={`agenda-week-card${day === today ? ' agenda-week-card--today' : ''}${n === 0 ? ' agenda-week-card--empty' : ''}`}
                >
                  <button
                    type="button"
                    className="agenda-week-card-head"
                    aria-expanded={isOpen}
                    aria-controls={panelId}
                    disabled={n === 0}
                    onClick={() => setOpenDay(isOpen ? '' : day)}
                  >
                    <span className="agenda-week-card-date" aria-hidden>
                      <span className="agenda-week-card-wd">{label.weekday}</span>
                      <span className="agenda-week-card-n">{label.day}</span>
                    </span>
                    <span className="agenda-week-card-title">
                      {day === today ? 'Hoje · ' : ''}
                      {n === 0 ? 'Nenhum horário' : `${n} ${n === 1 ? 'horário' : 'horários'}`}
                      {freeCount > 0 ? <span className="agenda-week-card-free"> · {freeCount} livres</span> : null}
                    </span>
                    {n > 0 ? <ChevronDown aria-hidden size={18} className="agenda-week-card-chev" /> : null}
                  </button>
                  <OccupancyBars occupancy={occupancy} />
                  {isOpen && n > 0 ? (
                    <div id={panelId} className="agenda-week-card-body">
                      <ul className="agenda-apt-list">
                        {items.map((apt) => (
                          <li key={apt.id}>
                            <button type="button" className="agenda-apt" onClick={() => openAppointment(apt.id)}>
                              <span className="agenda-apt-time">
                                {formatSlotTime(apt.startsAt, timezone)}
                                {' – '}
                                {formatSlotTime(apt.endsAt, timezone)}
                              </span>
                              <span className="agenda-apt-title">{apt.contactLabel || apt.serviceName}</span>
                              <span className="agenda-apt-meta">
                                {apt.serviceName}
                                {' · '}
                                {apt.professionalName}
                                {apt.roomResourceName ? ` · ${apt.roomResourceName}` : ''}
                              </span>
                            </button>
                          </li>
                        ))}
                      </ul>
                      <button
                        type="button"
                        className="agenda-week-card-open"
                        onClick={() => {
                          setDate(day)
                          navigatePanel({ kind: 'area', area: 'agenda', tenantId, section: 'dia' })
                        }}
                      >
                        Abrir o dia
                      </button>
                    </div>
                  ) : null}
                </section>
              )
            }
            return (
              <section key={day} className="agenda-day-group">
                <h2 className="panel-legend">
                  {label.weekday} {label.day}
                  {day === today ? <Badge tone="new">Hoje</Badge> : null}
                  {freeCount > 0 ? <span className="agenda-week-card-free"> · {freeCount} livres</span> : null}
                </h2>
                <OccupancyBars occupancy={occupancy} />
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
            isOwner={isOwner}
            onClose={closePanel}
            onChanged={() => void load()}
          />
        </aside>
      ) : null}
    </div>
  )
}

/** Barra de ocupação do expediente por profissional (Proposto, TEL-04). */
function OccupancyBars({ occupancy }: { occupancy: DayOccupancy[] }) {
  if (occupancy.length === 0) return null
  return (
    <ul className="agenda-occ" aria-label="Ocupação do expediente">
      {occupancy.map((o) => {
        return (
          <li
            key={o.professionalId}
            className="agenda-occ-row"
            role="img"
            aria-label={`${shortName(o.professionalName)}: ${o.percent}% do expediente ocupado`}
          >
            <span className="agenda-occ-name" aria-hidden>{shortName(o.professionalName)}</span>
            <span className="agenda-occ-track" aria-hidden>
              <span className="agenda-occ-fill" style={{ width: `${o.percent}%` }} />
            </span>
            <span className="agenda-occ-pct" aria-hidden>{o.percent}%</span>
          </li>
        )
      })}
    </ul>
  )
}

function DayGrid({
  items,
  professionals,
  timezone,
  isToday,
  now,
  onOpen,
}: {
  items: AgendaAppointmentItem[]
  professionals: { id: string; name: string }[]
  timezone: string
  isToday: boolean
  now: number
  onOpen: (id: string) => void
}) {
  const { startHour, endHour } = visibleHours(items, timezone)
  const hours = Array.from({ length: endHour - startHour }, (_, i) => startHour + i)
  const nowTop = isToday ? nowOffset(now, timezone, startHour, endHour) : null

  // DEC-165 (tela 16): uma coluna por profissional, cada uma com a sua cor; dentro da
  // coluna, sobreposições continuam lado a lado. Quem aparece no dia sem estar na lista
  // (ex.: profissional inativada) ganha coluna própria no fim.
  const columns = [...professionals]
  for (const it of items) {
    if (!columns.some((c) => c.id === it.professionalId)) {
      columns.push({ id: it.professionalId, name: it.professionalName })
    }
  }
  const nCols = Math.max(1, columns.length)
  const toneOf = (id: string) => {
    const i = professionals.findIndex((p) => p.id === id)
    return (i < 0 ? columns.findIndex((c) => c.id === id) : i) % 4
  }
  const placed = columns.flatMap((col, ci) =>
    layoutDay(
      items.filter((it) => it.professionalId === col.id),
      timezone,
      startHour,
    ).map((p) => ({ ...p, col: ci })),
  )

  return (
    <>
    {nCols > 1 ? (
      <div
        className="agenda-grid-heads"
        style={{ gridTemplateColumns: `repeat(${nCols}, minmax(0, 1fr))` }}
        aria-hidden
      >
        {columns.map((c) => (
          <span key={c.id} className={`agenda-grid-head agenda-card--tone-${toneOf(c.id)}`}>
            <span className={`agenda-mini agenda-tone-${toneOf(c.id)}`}>
              {c.name
                .split(/\s+/)
                .filter((w) => !/^(dra?\.?|dr\.?)$/i.test(w))
                .slice(0, 2)
                .map((w) => w[0]?.toUpperCase() ?? '')
                .join('')}
            </span>
            {c.name}
          </span>
        ))}
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
      {placed.map(({ item, top, height, lane, lanes, col }) => (
        <button
          key={item.id}
          type="button"
          role="listitem"
          className={`agenda-block agenda-card--tone-${toneOf(item.professionalId)}`}
          style={{
            top,
            height,
            left: `calc(var(--agenda-gutter) + (100% - var(--agenda-gutter)) * ${(col + lane / lanes) / nCols})`,
            width: `calc((100% - var(--agenda-gutter)) * ${1 / lanes / nCols} - 4px)`,
          }}
          onClick={() => onOpen(item.id)}
        >
          {/* O bloco começa pela cliente; serviço e sala na linha de baixo. */}
          <span className="agenda-block-title">
            {formatSlotTime(item.startsAt, timezone)} {item.contactLabel ?? 'Sem nome'}
          </span>
          <span className="agenda-block-time">
            {item.serviceName}
            {item.roomResourceName ? ` · ${item.roomResourceName}` : ''}
            <span className="panel-sr-only">
              {' '}
              até {formatSlotTime(item.endsAt, timezone)} · {item.professionalName}
            </span>
          </span>
        </button>
      ))}
    </div>
    </>
  )
}
