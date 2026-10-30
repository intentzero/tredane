import { CalendarDays, Check, CheckCheck, ChevronLeft, ChevronRight, Clock, TriangleAlert, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Button,
  Dialog,
  Heading,
  Input,
  Label,
  Modal,
  ModalOverlay,
  TextArea,
  TextField,
} from 'react-aria-components'
import {
  PanelApiError,
  type AvailabilityResponse,
  type AvailabilitySlot,
  type ClinicConfigSnapshot,
  type MessagingWindow,
  type PanelApi,
  type PixSnapshot,
} from '../../api'
import { navigatePanel } from '../../routes'
import { variantKindLabels } from '../../../../clinic/catalog/variant-kind'
import { ReservarBlocoSheet } from '../holds/ReservarBlocoSheet'
import { InboxRealtimeProvider, isScheduleEvent, useInboxRealtime } from '../../realtime/InboxRealtime'
import { ListSkeleton } from '../../states/ListSkeleton'
import { ErrorState } from '../../states/StatusScreens'
import { friendlyError } from '../../copy/errors'
import { useVisiblePolling } from '../../ui/useVisiblePolling'
import { formatDayLabel, formatSlotTime, reasonLabel, upcomingCivilDates } from './format'
import {
  CALENDAR_HORIZON_DAYS,
  NEXT_FREE_HORIZON_DAYS,
  WAIVE_REASONS,
  defaultConfirmationMessage,
  defaultNotify,
  formatBrl,
  formatDeadline,
  formatWaId,
  initials,
  nearestAlternatives,
  seatsLabel,
  originLabel,
  originRoute,
  slotKey,
  splitByPeriod,
  uniqueTimes,
  visibleDays,
  type ScheduleContext,
} from './agendarModel'
import './agendar.css'

type Props = {
  tenantId: string
  api: PanelApi
  generation: number
  /**
   * DEC-074: no desktop o Agendar abre como painel ao lado da conversa. O contexto vem da
   * conversa aberta (não da URL) e fechar/«Voltar à conversa» só fecha o painel.
   */
  embedded?: { conversationId: string; contactId?: string; onClose: () => void }
}

type Service = ClinicConfigSnapshot['services'][number]

const ANY = 'any'
const DEFAULT_DEADLINE_SECONDS = 2 * 60 * 60

function readScheduleContext(): ScheduleContext {
  const q = new URLSearchParams(window.location.search)
  return {
    conversationId: q.get('conversationId') || undefined,
    contactId: q.get('contactId') || undefined,
    opportunityId: q.get('opportunityId') || undefined,
    /** Alerta pago sem horário — confirma com sinal já pago (#40). */
    alertId: q.get('alertId') || undefined,
    date: /^\d{4}-\d{2}-\d{2}$/.test(q.get('date') ?? '') ? q.get('date')! : undefined,
  }
}

function signalAmountCents(svc: Service, priceCents: number | null = svc.priceCents): number | null {
  if (!svc.requiresSignal) return null
  if (svc.signalKind === 'fixed' && svc.signalFixedCents != null) return svc.signalFixedCents
  if (svc.signalKind === 'percent' && svc.signalPercent != null && priceCents != null) {
    return Math.trunc((priceCents * svc.signalPercent) / 100)
  }
  return null
}

function variantTitle(svc: Service | undefined) {
  return variantKindLabels(svc ?? {}, 'Variantes').plural
}

function genderLabel(audience: string | undefined) {
  if (audience === 'feminino') return 'Feminino'
  if (audience === 'masculino') return 'Masculino'
  return 'Ambos'
}

function activeZonesOf(svc: Service | undefined) {
  return (svc?.zones ?? []).filter((z) => z.active).slice().sort((a, b) => a.sortOrder - b.sortOrder)
}

function chosenZones(svc: Service | undefined, ids: string[]) {
  const active = activeZonesOf(svc)
  return active.filter((z) => ids.includes(z.id))
}

function visitQuote(svc: Service | undefined, ids: string[]) {
  const active = activeZonesOf(svc)
  if (active.length === 0) {
    return { zoned: false, zones: [], minutes: svc?.durationMinutes ?? null, priceCents: svc?.priceCents ?? null }
  }
  const zones = chosenZones(svc, ids)
  const priced = zones.length > 0 && zones.every((z) => z.priceCents != null)
  return {
    zoned: true,
    zones,
    minutes: zones.reduce((sum, z) => sum + z.durationMinutes, 0) || null,
    priceCents: priced ? zones.reduce((sum, z) => sum + (z.priceCents ?? 0), 0) : null,
  }
}

function isConflictError(err: unknown): boolean {
  if (err instanceof PanelApiError) {
    const code = String(err.code)
    return err.status === 409 || code === 'appointment_conflict' || code === 'slot_occupied'
  }
  return false
}

function shortDate(iso: string, tz: string): string {
  const l = formatDayLabel(iso, tz)
  return `${l.weekday} ${Number(l.day)}`
}

function slashDate(iso: string): string {
  const [, m, d] = iso.split('-')
  return `${d}/${m}`
}

type Contact = { name: string | null; phone: string }

type NoticeStatus = 'sent' | 'failed' | 'off' | 'unavailable'

type Success = {
  kind: 'confirmed' | 'waived' | 'paid' | 'signal'
  appointmentId?: string
  serviceLabel: string
  professionalName: string
  whenLabel: string
  notice: NoticeStatus
  noticeDetail?: string
}

/**
 * TEL-05 / M-04 (+ M-34 sinal) — redesenho mobile (Proposto por Paulo, 27/10/2026).
 * Confirmação atómica (#35/#36), sinal Pix (#38/#40, DEC-047/049), aviso REQ-033.
 * DEC-051–058 Confirmados (card t1868s7504) — docs/product/agendar-em-aberto.md.
 */
export function AgendarScreen(props: Props) {
  // DEC-057 (Confirmado, card t1868s7504): WebSocket invalida a grade; polling fica de reserva.
  return (
    <InboxRealtimeProvider
      tenantId={props.tenantId}
      api={props.api}
      generation={props.generation}
      acceptEvent={isScheduleEvent}
    >
      <AgendarScreenInner {...props} />
    </InboxRealtimeProvider>
  )
}

function AgendarScreenInner({ tenantId, api, generation, embedded }: Props) {
  const ctx = useMemo<ScheduleContext>(
    () =>
      embedded
        ? { conversationId: embedded.conversationId, contactId: embedded.contactId }
        : readScheduleContext(),
    [embedded?.conversationId, embedded?.contactId],
  )
  const fo = useMemo(() => ({ generation, expectGeneration: () => generation }), [generation])
  const [config, setConfig] = useState<ClinicConfigSnapshot | null>(null)
  const [pix, setPix] = useState<PixSnapshot | null>(null)
  const [contact, setContact] = useState<Contact | null>(null)
  const [window24, setWindow24] = useState<MessagingWindow | null>(null)
  /** «Por período» = reserva por bloco (antigo «Reservar bloco»); só com conversa. */
  const [periodOpen, setPeriodOpen] = useState(false)
  const [serviceId, setServiceId] = useState('')
  const [zoneIds, setZoneIds] = useState<string[]>([])
  const [professionalId, setProfessionalId] = useState<string>(ANY)
  const [date, setDate] = useState('')
  const [availability, setAvailability] = useState<AvailabilityResponse | null>(null)
  const [selected, setSelected] = useState<AvailabilitySlot | null>(null)
  const [conflict, setConflict] = useState<{ message: string; lostStartsAt: number | null } | null>(null)
  const [nextFree, setNextFree] = useState<{ date: string; slot: AvailabilitySlot } | null | 'none' | 'searching'>(null)
  const [loadingConfig, setLoadingConfig] = useState(true)
  const [loadingSlots, setLoadingSlots] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reviewOpen, setReviewOpen] = useState(false)
  const [calendarOpen, setCalendarOpen] = useState(false)
  const [success, setSuccess] = useState<Success | null>(null)
  const conflictRef = useRef<HTMLDivElement | null>(null)

  const timezone = config?.settings.timezone ?? 'America/Sao_Paulo'
  const allDays = useMemo(
    () => upcomingCivilDates(timezone, Date.now(), CALENDAR_HORIZON_DAYS),
    [timezone],
  )

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoadingConfig(true)
      setError(null)
      try {
        const [snap, pixSnap] = await Promise.all([
          api.getClinicConfig(tenantId, fo),
          api.getPix(tenantId, fo).catch(() => null),
        ])
        if (cancelled) return
        setConfig(snap)
        setPix(pixSnap)
        const firstSvc = snap.services.find((s) => s.active)
        setServiceId((prev) => prev || firstSvc?.id || '')
        setDate((prev) => prev || ctx.date || upcomingCivilDates(snap.settings.timezone, Date.now(), 1)[0]!)
      } catch (err) {
        if (cancelled) return
        if (err instanceof PanelApiError && err.message === 'stale_tenant_response') return
        setError(friendlyError(err, 'Não conseguimos carregar. Tente de novo.'))
      } finally {
        if (!cancelled) setLoadingConfig(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [api, tenantId, fo])

  // Contato real no cabeçalho (substitui «Contato sintético»).
  useEffect(() => {
    let cancelled = false
    async function loadContact() {
      try {
        if (ctx.conversationId) {
          const conv = await api.getInboxConversation(tenantId, ctx.conversationId, { messageLimit: 1 }, fo)
          if (cancelled) return
          setContact({ name: conv.contact.displayName, phone: formatWaId(conv.contact.waId) })
          setWindow24(conv.messagingWindow)
        } else if (ctx.contactId) {
          const det = await api.getInboxContact(tenantId, ctx.contactId, fo)
          if (cancelled) return
          setContact({ name: det.contact.displayName, phone: formatWaId(det.contact.waId) })
        }
      } catch {
        // Sem contato legível: o cabeçalho mostra só «Agendar horário».
      }
    }
    void loadContact()
    return () => {
      cancelled = true
    }
  }, [api, tenantId, fo, ctx.conversationId, ctx.contactId])

  const reloadSlots = useCallback(async () => {
    if (!serviceId || !date) return
    const svc = config?.services.find((s) => s.id === serviceId)
    const visit = visitQuote(svc, zoneIds)
    if (visit.zoned && visit.zones.length === 0) {
      setAvailability(null)
      setSelected(null)
      return
    }
    setLoadingSlots(true)
    try {
      const res = await api.queryAvailability(
        tenantId,
        {
          serviceId,
          date,
          professionalId: professionalId === ANY ? undefined : professionalId,
          ...(visit.zoned && visit.minutes ? { durationMinutes: visit.minutes } : {}),
        },
        fo,
      )
      setAvailability(res)
      setSelected((prev) => {
        if (!prev) return null
        const still = res.slots.find((s) => slotKey(s) === slotKey(prev))
        if (!still) {
          setConflict({
            message: 'Esse horário acabou de ficar indisponível. Nada foi reservado.',
            lostStartsAt: prev.startsAt,
          })
          return null
        }
        return still
      })
    } catch (err) {
      if (err instanceof PanelApiError && err.message === 'stale_tenant_response') return
      setError(friendlyError(err, 'Não conseguimos ver os horários livres agora.'))
      setAvailability(null)
    } finally {
      setLoadingSlots(false)
    }
  }, [api, tenantId, fo, serviceId, date, professionalId, config, zoneIds])

  useEffect(() => {
    void reloadSlots()
  }, [reloadSlots])

  // DEC-057: evento appointment.*/schedule_hold.* ou (re)ligação → recarrega a grade.
  useInboxRealtime(() => {
    void reloadSlots()
  })

  // Polling de reserva (DEC-057) caso o WebSocket caia.
  useVisiblePolling(() => void reloadSlots(), 15_000)

  // «Próximo livre» (DEC-055 Confirmado): mesma escolha, até 14 dias, no cliente.
  useEffect(() => {
    setNextFree(null)
    if (!availability || availability.slots.length > 0 || availability.date !== date) return
    let cancelled = false
    async function search() {
      setNextFree('searching')
      const idx = allDays.indexOf(date)
      const candidates = allDays.slice(idx + 1, idx + 1 + NEXT_FREE_HORIZON_DAYS)
      for (const d of candidates) {
        try {
          const svc = config?.services.find((s) => s.id === serviceId)
          const visit = visitQuote(svc, zoneIds)
          const res = await api.queryAvailability(
            tenantId,
            {
              serviceId,
              date: d,
              professionalId: professionalId === ANY ? undefined : professionalId,
              ...(visit.zoned && visit.minutes ? { durationMinutes: visit.minutes } : {}),
            },
            fo,
          )
          if (cancelled) return
          const first = uniqueTimes(res.slots)[0]
          if (first) {
            setNextFree({ date: d, slot: first })
            return
          }
        } catch {
          break
        }
      }
      if (!cancelled) setNextFree('none')
    }
    void search()
    return () => {
      cancelled = true
    }
  }, [availability, date, allDays, api, tenantId, fo, serviceId, professionalId, config, zoneIds])

  useEffect(() => {
    if (conflict) conflictRef.current?.focus()
  }, [conflict])

  const service = config?.services.find((s) => s.id === serviceId)
  const visit = visitQuote(service, zoneIds)
  const amountCents = service ? signalAmountCents(service, visit.zoned ? visit.priceCents : service.priceCents) : null
  const percentBlocked = Boolean(
    visit.zoned &&
      visit.zones.length > 0 &&
      visit.priceCents == null &&
      service?.requiresSignal &&
      service.signalKind === 'percent',
  )
  const paidSignalMode = Boolean(ctx.alertId)
  const requiresSignal = !paidSignalMode && Boolean(service?.requiresSignal && amountCents != null)
  const professionals =
    config?.resources.filter(
      (r) =>
        r.kind === 'professional'
        && r.active
        && (!service || service.professionalIds.length === 0 || service.professionalIds.includes(r.id)),
    ) ?? []

  function back() {
    if (embedded) embedded.onClose()
    else navigatePanel(originRoute(tenantId, ctx))
  }

  function pickTime(slot: AvailabilitySlot) {
    setSelected(slot)
    setConflict(null)
  }

  async function onConflict(message: string) {
    const lost = selected?.startsAt ?? null
    setReviewOpen(false)
    setSelected(null)
    setConflict({ message, lostStartsAt: lost })
    await reloadSlots()
  }

  const whenLabel = selected
    ? `${shortDate(date, timezone)}, ${formatSlotTime(selected.startsAt, timezone)}`
    : ''

  if (loadingConfig && !config) return <ListSkeleton label="Carregando agenda…" rows={5} />
  if (error && !config) {
    return <ErrorState title="Agenda indisponível" description={error} actionLabel="Voltar" onAction={back} />
  }
  if (!config) return null

  const header = (
    <header className="panel-header agd-header">
      <Button className="panel-icon-btn" aria-label={embedded ? 'Fechar Agendar' : 'Voltar'} onPress={back}>
        {embedded ? <X aria-hidden size={20} strokeWidth={2} /> : <ChevronLeft aria-hidden size={22} strokeWidth={2} />}
      </Button>
      {contact?.name ? (
        <span className="agd-avatar" aria-hidden="true">
          {initials(contact.name)}
        </span>
      ) : null}
      <div className="agd-header-text">
        <h1 className="panel-title agd-title">
          {contact?.name ? `Agendar · ${contact.name}` : 'Agendar horário'}
        </h1>
        <span className="panel-subtitle">
          {[contact?.phone, originLabel(ctx)].filter(Boolean).join(' · ')}
        </span>
      </div>
    </header>
  )

  if (success) {
    return (
      <AgendarSuccess
        success={success}
        contact={contact}
        hasConversation={Boolean(ctx.conversationId)}
        onConversation={back}
        onAgenda={() =>
          navigatePanel(
            success.appointmentId
              ? { kind: 'area', area: 'agenda', tenantId, section: 'compromisso', appointmentId: success.appointmentId }
              : { kind: 'area', area: 'agenda', tenantId, section: 'dia' },
          )
        }
      />
    )
  }

  if (!config.readiness.schedulingAllowed) {
    return (
      <div className="agd" data-screen="m04-agendar">
        {header}
        <div className="panel-scroll">
          <p className="clinic-banner" role="status">
            A agenda desta clínica ainda não foi configurada. O responsável precisa de serviços,
            profissionais, salas e expediente antes de marcar horários.
          </p>
        </div>
      </div>
    )
  }

  const times = availability && availability.date === date ? uniqueTimes(availability.slots) : []
  const periods = splitByPeriod(times, timezone)
  const alternatives =
    conflict?.lostStartsAt != null ? new Set(nearestAlternatives(times, conflict.lostStartsAt)) : new Set<number>()
  const days = visibleDays(allDays, date)

  const renderTimes = (list: AvailabilitySlot[], title: string) =>
    list.length === 0 && !(conflict?.lostStartsAt != null && title === 'Tarde') ? null : (
      <div className="agd-period" role="group" aria-label={title}>
        <h3 className="agd-period-title">{title}</h3>
        <div className="agd-time-grid">
          {list.map((slot) => {
            const pressed = selected?.startsAt === slot.startsAt
            const alt = alternatives.has(slot.startsAt)
            const seats = seatsLabel(slot)
            return (
              <button
                key={slot.startsAt}
                type="button"
                className="agd-time"
                data-alt={alt || undefined}
                aria-pressed={pressed}
                aria-label={`${formatSlotTime(slot.startsAt, timezone)}${seats ? `, ${seats === 'último lugar' ? 'último lugar livre na sala' : `${seats} lugares livres na sala`}` : ''}${alt ? ', livre mais próximo' : ''}`}
                onClick={() => pickTime(slot)}
              >
                {formatSlotTime(slot.startsAt, timezone)}
                {seats ? (
                  <span className="agd-time-seats" data-last={seats === 'último lugar' || undefined}>
                    {seats}
                  </span>
                ) : null}
              </button>
            )
          })}
        </div>
      </div>
    )

  const lostLabel =
    conflict?.lostStartsAt != null ? formatSlotTime(conflict.lostStartsAt, timezone) : null

  return (
    <div className="agd" data-screen="m04-agendar">
      {header}
      <div className="panel-scroll agd-scroll">
        {ctx.conversationId ? (
          <div className="agd-mode" role="radiogroup" aria-label="Como escolher o horário">
            <button
              type="button"
              role="radio"
              aria-checked={!periodOpen}
              className="agd-mode-btn"
              onClick={() => setPeriodOpen(false)}
            >
              Horário exato
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={periodOpen}
              className="agd-mode-btn"
              onClick={() => setPeriodOpen(true)}
            >
              Por período
            </button>
          </div>
        ) : null}
        {conflict ? (
          <div className="agd-banner" role="alert" tabIndex={-1} ref={conflictRef}>
            <TriangleAlert aria-hidden size={20} strokeWidth={2} />
            <div>
              <strong>{conflict.message.includes('Nada foi reservado') ? conflict.message : `${conflict.message} Nada foi reservado.`}</strong>
              <span>
                Suas escolhas foram mantidas.
                {alternatives.size > 0 ? ' Os horários livres mais próximos estão destacados.' : ''}
                {lostLabel ? ` ${lostLabel} não está mais livre.` : ''}
              </span>
            </div>
          </div>
        ) : null}
        {paidSignalMode ? (
          <p className="agd-note" role="note">
            Sinal já pago — escolha outro horário para confirmar.
          </p>
        ) : null}

        <section aria-labelledby="agd-svc">
          <h2 id="agd-svc" className="agd-label">Serviço</h2>
          <div className="agd-services" role="group" aria-labelledby="agd-svc">
            {config.services
              .filter((s) => s.active)
              .map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className="agd-service"
                  aria-pressed={s.id === serviceId}
                  onClick={() => {
                    setServiceId(s.id)
                    setZoneIds([])
                    setSelected(null)
                    setConflict(null)
                  }}
                >
                  <span className="agd-service-name">{s.name}</span>
                  {activeZonesOf(s).length > 0 ? (
                    <span className="agd-service-meta">
                      {variantKindLabels(s).count(activeZonesOf(s).length)}
                    </span>
                  ) : (
                    <>
                      <span className="agd-service-meta">{s.durationMinutes} min</span>
                      {s.priceCents != null ? (
                        <span className="agd-service-meta">{formatBrl(s.priceCents)}</span>
                      ) : null}
                    </>
                  )}
                </button>
              ))}
          </div>
        </section>

        {visit.zoned ? (
          <section aria-labelledby="agd-zones">
            <h2 id="agd-zones" className="agd-label">{variantTitle(service)}</h2>
            <div className="agd-pills" role="group" aria-labelledby="agd-zones">
              {activeZonesOf(service).map((z) => {
                const on = zoneIds.includes(z.id)
                const chosen = chosenZones(service, zoneIds)
                const opposite = z.audience === 'feminino' ? 'masculino' : z.audience === 'masculino' ? 'feminino' : null
                const blocked = !on && opposite != null && chosen.some((row) => row.audience === opposite)
                return (
                  <button
                    key={z.id}
                    type="button"
                    className="agd-pill"
                    aria-pressed={on}
                    disabled={blocked}
                    onClick={() => {
                      setZoneIds((prev) => {
                        if (prev.includes(z.id)) return prev.filter((id) => id !== z.id)
                        const active = activeZonesOf(service)
                        const kept = opposite
                          ? prev.filter((id) => active.find((row) => row.id === id)?.audience !== opposite)
                          : prev
                        return [...kept, z.id]
                      })
                      setSelected(null)
                      setConflict(null)
                    }}
                  >
                    {z.name} · {genderLabel(z.audience)} · {z.durationMinutes} min
                    {z.priceCents != null ? ` · ${formatBrl(z.priceCents)}` : ' · sem preço'}
                  </button>
                )
              })}
            </div>
            {visit.zones.length === 0 ? (
              <p className="agd-note">Escolha ao menos uma para ver horários.</p>
            ) : (
              <p className="agd-note">
                {visit.minutes} min
                {visit.priceCents != null ? ` · ${formatBrl(visit.priceCents)}` : ' · sem preço somado'}
              </p>
            )}
          </section>
        ) : null}

        <section aria-labelledby="agd-pro">
          <h2 id="agd-pro" className="agd-label">Profissional</h2>
          <div className="agd-pills" role="group" aria-labelledby="agd-pro">
            {[{ id: ANY, name: 'Qualquer' }, ...professionals].map((p) => (
              <button
                key={p.id}
                type="button"
                className="agd-pill"
                aria-pressed={professionalId === p.id}
                onClick={() => {
                  setProfessionalId(p.id)
                  setSelected(null)
                  setConflict(null)
                }}
              >
                {p.name}
              </button>
            ))}
          </div>
        </section>

        <section aria-labelledby="agd-day">
          <div className="agd-row">
            <h2 id="agd-day" className="agd-label">Dia</h2>
            <button type="button" className="agd-link" onClick={() => setCalendarOpen(true)}>
              Ver calendário <ChevronRight aria-hidden size={16} strokeWidth={2} />
            </button>
          </div>
          <div className="agd-day-grid" role="group" aria-labelledby="agd-day">
            {days.map((d) => {
              const l = formatDayLabel(d, timezone)
              return (
                <button
                  key={d}
                  type="button"
                  className="agd-day"
                  aria-pressed={date === d}
                  aria-label={`${l.weekday} ${l.day}`}
                  onClick={() => {
                    setDate(d)
                    setSelected(null)
                  }}
                >
                  <span>{l.weekday}</span>
                  <span>{Number(l.day)}</span>
                </button>
              )
            })}
          </div>
        </section>

        <section aria-labelledby="agd-time" aria-busy={loadingSlots}>
          <h2 id="agd-time" className="agd-label">Horário</h2>
          {loadingSlots && times.length === 0 ? <p className="panel-meta">Carregando horários…</p> : null}
          {availability && availability.date === date && times.length === 0 && !loadingSlots ? (
            <div className="agd-empty" role="status">
              <Clock aria-hidden size={22} strokeWidth={2} />
              <p>Sem horários livres neste dia.</p>
              {nextFree === 'searching' ? <p className="panel-meta">Procurando o próximo livre…</p> : null}
              {nextFree === 'none' ? (
                <p className="panel-meta">Nenhum horário livre nos próximos {NEXT_FREE_HORIZON_DAYS} dias.</p>
              ) : null}
              {nextFree && typeof nextFree === 'object' ? (
                <Button
                  className="panel-btn panel-btn-primary agd-btn"
                  onPress={() => {
                    setDate(nextFree.date)
                    setSelected(nextFree.slot)
                    setConflict(null)
                  }}
                >
                  Próximo livre: {shortDate(nextFree.date, timezone)}, {formatSlotTime(nextFree.slot.startsAt, timezone)}
                </Button>
              ) : null}
            </div>
          ) : null}
          {renderTimes(periods.manha, 'Manhã')}
          {renderTimes(periods.tarde, 'Tarde')}
          {lostLabel && !times.some((t) => t.startsAt === conflict?.lostStartsAt) ? (
            <p className="agd-lost">
              <s>{lostLabel}</s> ocupado
            </p>
          ) : null}
        </section>
      </div>

      <footer className="panel-footer agd-footer">
        <p className="agd-summary" aria-live="polite">
          {percentBlocked ? (
            <span>Sinal em porcentagem precisa de preço em todas as variantes escolhidas. </span>
          ) : null}
          {service ? <strong>{service.name}</strong> : null}
          {selected ? ` · ${selected.professionalName}` : professionalId !== ANY ? ` · ${professionals.find((p) => p.id === professionalId)?.name ?? ''}` : ''}
          {selected
            ? ` · ${whenLabel}${selected.roomResourceName ? ` · ${selected.roomResourceName}` : ''}`
            : ` · ${shortDate(date, timezone)} · escolha um horário`}
        </p>
        <Button
          className="panel-btn panel-btn-primary agd-btn"
          isDisabled={!selected || percentBlocked || (visit.zoned && visit.zones.length === 0)}
          onPress={() => setReviewOpen(true)}
        >
          Revisar e confirmar
        </Button>
      </footer>

      <CalendarSheet
        isOpen={calendarOpen}
        onOpenChange={setCalendarOpen}
        days={allDays}
        value={date}
        timezone={timezone}
        onPick={(d) => {
          setDate(d)
          setSelected(null)
          setCalendarOpen(false)
        }}
      />

      {selected && service ? (
        <ReviewSheet
          isOpen={reviewOpen}
          onOpenChange={setReviewOpen}
          api={api}
          tenantId={tenantId}
          fo={fo}
          ctx={ctx}
          service={service}
          zoneIds={visit.zones.map((z) => z.id)}
          slot={selected}
          date={date}
          timezone={timezone}
          contact={contact}
          window24={window24}
          requiresSignal={requiresSignal}
          paidSignalMode={paidSignalMode}
          amountCents={amountCents}
          canCreateCharge={pix?.account.canCreateCharge === true}
          deadlineSeconds={pix?.signalSettings.deadlineSeconds ?? config.settings.signalDeadlineSeconds ?? DEFAULT_DEADLINE_SECONDS}
          onConflict={onConflict}
          onSuccess={(s) => {
            setReviewOpen(false)
            setSuccess(s)
          }}
        />
      ) : null}
      {ctx.conversationId ? (
        <ReservarBlocoSheet
          open={periodOpen}
          tenantId={tenantId}
          api={api}
          generation={generation}
          conversationId={ctx.conversationId}
          contactName={contact?.name ?? null}
          windowOpen={window24?.open === true}
          onClose={() => setPeriodOpen(false)}
          onReserved={async (message) => {
            if (message && ctx.conversationId) {
              await api.sendInboxMessage(
                tenantId,
                ctx.conversationId,
                { body: message.trim(), clientRequestId: crypto.randomUUID() },
                fo,
              )
            }
            setPeriodOpen(false)
            back()
          }}
        />
      ) : null}
    </div>
  )
}

function CalendarSheet(props: {
  isOpen: boolean
  onOpenChange: (v: boolean) => void
  days: string[]
  value: string
  timezone: string
  onPick: (d: string) => void
}) {
  const byMonth = new Map<string, string[]>()
  for (const d of props.days) {
    const k = d.slice(0, 7)
    byMonth.set(k, [...(byMonth.get(k) ?? []), d])
  }
  const monthName = (k: string) =>
    new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
      new Date(`${k}-15T12:00:00Z`),
    )
  return (
    <ModalOverlay isOpen={props.isOpen} onOpenChange={props.onOpenChange} isDismissable className="panel-overlay">
      <Modal className="panel-choice-modal">
        <Dialog className="panel-sheet agd-sheet" aria-labelledby="agd-cal-title">
          <span className="panel-sheet-handle" aria-hidden="true" />
          <Heading slot="title" id="agd-cal-title" className="panel-title">
            <CalendarDays aria-hidden size={20} strokeWidth={2} /> Escolher dia
          </Heading>
          <div className="agd-sheet-body">
            {[...byMonth.entries()].map(([k, list]) => (
              <section key={k} aria-label={monthName(k)}>
                <h3 className="agd-period-title agd-month">{monthName(k)}</h3>
                <div className="agd-cal-grid">
                  {list.map((d) => {
                    const l = formatDayLabel(d, props.timezone)
                    return (
                      <button
                        key={d}
                        type="button"
                        className="agd-day agd-day-sm"
                        aria-pressed={props.value === d}
                        aria-label={`${l.weekday} ${slashDate(d)}`}
                        onClick={() => props.onPick(d)}
                      >
                        <span>{l.weekday}</span>
                        <span>{Number(l.day)}</span>
                      </button>
                    )
                  })}
                </div>
              </section>
            ))}
          </div>
          <Button className="panel-btn panel-btn-secondary agd-btn" slot="close">
            Fechar
          </Button>
        </Dialog>
      </Modal>
    </ModalOverlay>
  )
}

type ReviewProps = {
  isOpen: boolean
  onOpenChange: (v: boolean) => void
  api: PanelApi
  tenantId: string
  fo: { generation: number; expectGeneration: () => number }
  ctx: ScheduleContext
  service: Service
  zoneIds: string[]
  slot: AvailabilitySlot
  date: string
  timezone: string
  contact: Contact | null
  window24: MessagingWindow | null
  requiresSignal: boolean
  paidSignalMode: boolean
  amountCents: number | null
  canCreateCharge: boolean
  deadlineSeconds: number
  onConflict: (message: string) => Promise<void>
  onSuccess: (s: Success) => void
}

function ReviewSheet(p: ReviewProps) {
  const { api, tenantId, fo, ctx, service, slot, timezone } = p
  const start = formatSlotTime(slot.startsAt, timezone)
  const end = formatSlotTime(slot.endsAt, timezone)
  const dayLabel = formatDayLabel(p.date, timezone)
  const whenLong = `${dayLabel.weekday} ${slashDate(p.date)}, ${start}–${end}`
  const whenShort = `${dayLabel.weekday} ${slashDate(p.date)}, ${start}`
  const canNotify = Boolean(ctx.conversationId) && p.window24?.open === true
  // DEC-053 (Confirmado, card t1868s7504): com conversa, ligado dentro da janela
  // de 24 h; fora dela desligado com explicação.
  const [notify, setNotify] = useState(() => defaultNotify(Boolean(ctx.conversationId), p.window24))
  const notifyTouched = useRef(false)
  useEffect(() => {
    if (!notifyTouched.current) setNotify(defaultNotify(Boolean(ctx.conversationId), p.window24))
  }, [ctx.conversationId, p.window24])
  const setNotifyByUser = (v: boolean) => {
    notifyTouched.current = true
    setNotify(v)
  }
  const [message, setMessage] = useState(() =>
    defaultConfirmationMessage({
      contactName: p.contact?.name ?? null,
      serviceName: service.name,
      professionalName: slot.professionalName,
      whenLabel: `${dayLabel.weekday}, ${slashDate(p.date)}, às ${start}`,
      roomSharedNotice: slot.roomSharedNotice ?? null,
    }),
  )
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [waiveOpen, setWaiveOpen] = useState(false)
  const [waiveChip, setWaiveChip] = useState<string | null>(null)
  const [waiveOther, setWaiveOther] = useState('')
  const [clientRequestId, setClientRequestId] = useState(() => crypto.randomUUID())
  const contactLabel = p.contact?.name || p.contact?.phone || null
  const waiveReason = waiveChip === 'Outro' ? waiveOther.trim() : waiveChip ?? ''

  const base = {
    serviceLabel: `${service.name} · ${Math.round((slot.endsAt - slot.startsAt) / 60000)} min`,
    professionalName: slot.professionalName,
    whenLabel: whenShort,
  }

  async function stillFree(): Promise<boolean> {
    const check = await api.checkAvailabilitySlot(
      tenantId,
      {
        serviceId: service.id,
        professionalId: slot.professionalId,
        roomResourceId: slot.roomResourceId,
        startsAt: slot.startsAt,
        durationMinutes: Math.round((slot.endsAt - slot.startsAt) / 60_000),
      },
      fo,
    )
    if (!check.available) {
      const detail = check.reasons.map(reasonLabel).join(' · ')
      await p.onConflict(`Esse horário acabou de ser ocupado${detail ? ` (${detail})` : ''}. Nada foi reservado.`)
      return false
    }
    return true
  }

  async function sendNotice(): Promise<{ notice: NoticeStatus; noticeDetail?: string }> {
    if (!notify) return { notice: canNotify ? 'off' : 'unavailable' }
    try {
      await api.sendInboxMessage(tenantId, ctx.conversationId!, { body: message.trim(), clientRequestId: crypto.randomUUID() }, fo)
      return { notice: 'sent' }
    } catch (e) {
      // REQ-033: falha do aviso não desfaz o compromisso.
      return { notice: 'failed', noticeDetail: friendlyError(e, 'O WhatsApp não enviou.') }
    }
  }

  async function run(action: () => Promise<void>) {
    setBusy(true)
    setErr(null)
    try {
      await action()
    } catch (e) {
      if (isConflictError(e)) {
        await p.onConflict(
          p.paidSignalMode
            ? 'Esse horário acabou de ser ocupado. Nada foi reservado. O sinal pago continua guardado.'
            : 'Esse horário acabou de ser ocupado. Nada foi reservado.',
        )
      } else {
        setErr(`Não foi possível concluir. Nada foi reservado. ${friendlyError(e, '')}`.trim())
        setClientRequestId(crypto.randomUUID())
      }
    } finally {
      setBusy(false)
    }
  }

  const confirm = () =>
    run(async () => {
      if (!(await stillFree())) return
      if (p.paidSignalMode && ctx.alertId) {
        const r = await api.confirmPixAlertSlot(
          tenantId,
          ctx.alertId,
          { clientRequestId, serviceId: service.id, professionalId: slot.professionalId, roomResourceId: slot.roomResourceId, startsAt: slot.startsAt },
          fo,
        )
        p.onSuccess({ ...base, kind: 'paid', appointmentId: r.appointmentId, ...(await sendNotice()) })
        return
      }
      const created = await api.confirmAppointment(
        tenantId,
        {
          clientRequestId,
          serviceId: service.id,
          professionalId: slot.professionalId,
          roomResourceId: slot.roomResourceId,
          startsAt: slot.startsAt,
          contactLabel,
          conversationId: ctx.conversationId,
          contactId: ctx.contactId,
          opportunityId: ctx.opportunityId,
          zoneIds: p.zoneIds,
        },
        fo,
      )
      p.onSuccess({ ...base, kind: 'confirmed', appointmentId: created.id, ...(await sendNotice()) })
    })

  const confirmWithoutSignal = () =>
    run(async () => {
      if (!waiveReason) {
        setErr('Escolha o motivo para confirmar sem sinal.')
        return
      }
      if (!(await stillFree())) return
      const created = await api.confirmWithoutSignal(
        tenantId,
        {
          clientRequestId,
          serviceId: service.id,
          professionalId: slot.professionalId,
          roomResourceId: slot.roomResourceId,
          startsAt: slot.startsAt,
          contactLabel,
          conversationId: ctx.conversationId,
          contactId: ctx.contactId,
          opportunityId: ctx.opportunityId,
          waiveReason,
          zoneIds: p.zoneIds,
        },
        fo,
      )
      p.onSuccess({ ...base, kind: 'waived', appointmentId: created.appointmentId, ...(await sendNotice()) })
    })

  const sendSignal = () =>
    run(async () => {
      if (!ctx.conversationId || p.amountCents == null) return
      const created = await api.createPixCharge(
        tenantId,
        {
          clientRequestId,
          conversationId: ctx.conversationId,
          contactId: ctx.contactId,
          opportunityId: ctx.opportunityId,
          serviceId: service.id,
          professionalId: slot.professionalId,
          roomResourceId: slot.roomResourceId,
          startsAt: slot.startsAt,
          zoneIds: p.zoneIds,
        },
        fo,
      )
      p.onSuccess({
        ...base,
        kind: 'signal',
        notice: created.whatsappSendError ? 'failed' : 'sent',
        noticeDetail: created.whatsappSendError ?? undefined,
      })
    })

  const signalBlocked = !ctx.conversationId
    ? 'Para enviar o sinal, abra o Agendar a partir da conversa.'
    : !p.canCreateCharge
      ? 'Conta Pix desconectada. A responsável liga o recebimento em Clínica → Recebimento.'
      : null

  const rows: Array<[string, string]> = [
    ['Paciente', p.contact?.name || p.contact?.phone || 'Sem contato vinculado'],
    ['Serviço', base.serviceLabel],
    ['Profissional', slot.professionalName],
    ['Quando', whenLong],
  ]
  if (slot.roomResourceName) rows.push(['Sala', slot.roomResourceName])
  if (service.priceCents != null) rows.push(['Valor', formatBrl(service.priceCents)])

  return (
    <ModalOverlay isOpen={p.isOpen} onOpenChange={(v) => !busy && p.onOpenChange(v)} isDismissable={!busy} className="panel-overlay">
      <Modal className="panel-choice-modal">
        <Dialog className="panel-sheet agd-sheet" aria-labelledby="agd-review-title">
          <span className="panel-sheet-handle" aria-hidden="true" />
          <Heading slot="title" id="agd-review-title" className="panel-title">
            {p.requiresSignal ? 'Sinal por Pix' : 'Revisar agendamento'}
          </Heading>
          <div className="agd-sheet-body">
            {err ? (
              <div className="agd-banner" role="alert">
                <TriangleAlert aria-hidden size={20} strokeWidth={2} />
                <span>{err}</span>
              </div>
            ) : null}

            {p.requiresSignal && p.amountCents != null ? (
              <>
                <div className="agd-signal">
                  <div>
                    <span className="agd-signal-meta">Sinal · {service.name} · {slot.professionalName}</span>
                    <strong className="agd-signal-amount">{formatBrl(p.amountCents)}</strong>
                  </div>
                  <div className="agd-signal-side">
                    <span>{whenShort}</span>
                    <span>prazo {formatDeadline(p.deadlineSeconds)}</span>
                  </div>
                </div>
                <div className="agd-warn" role="note">
                  <Clock aria-hidden size={20} strokeWidth={2} />
                  <div>
                    <strong>Horário só é reservado após o pagamento</strong>
                    <span>Até lá ele continua livre para outras pessoas.</span>
                  </div>
                </div>
                <p className="panel-meta">A mensagem com o código Pix é enviada pelo Tredane na conversa.</p>
                {signalBlocked ? <p className="agd-note" role="note">{signalBlocked}</p> : null}
                <Button className="panel-btn panel-btn-primary agd-btn" isDisabled={busy || Boolean(signalBlocked)} onPress={() => void sendSignal()}>
                  {busy && !waiveOpen ? 'Enviando sinal…' : `Enviar sinal de ${formatBrl(p.amountCents)}`}
                </Button>
                <Button
                  className="panel-btn panel-btn-secondary agd-btn"
                  aria-expanded={waiveOpen}
                  isDisabled={busy}
                  onPress={() => {
                    setWaiveOpen((v) => !v)
                    setClientRequestId(crypto.randomUUID())
                  }}
                >
                  Confirmar sem sinal
                </Button>
                {waiveOpen ? (
                  <div className="agd-waive">
                    <span id="agd-waive-label" className="agd-field-label">Motivo para confirmar sem sinal (obrigatório)</span>
                    <div className="agd-pills" role="group" aria-labelledby="agd-waive-label">
                      {WAIVE_REASONS.map((r) => (
                        <button key={r} type="button" className="agd-pill" aria-pressed={waiveChip === r} onClick={() => setWaiveChip(r)}>
                          {r}
                        </button>
                      ))}
                    </div>
                    {waiveChip === 'Outro' ? (
                      <TextField className="panel-field" value={waiveOther} onChange={setWaiveOther} isRequired autoFocus>
                        <Label>Qual o motivo?</Label>
                        <Input autoComplete="off" />
                      </TextField>
                    ) : null}
                    <NoticeField
                      canNotify={canNotify}
                      hasConversation={Boolean(ctx.conversationId)}
                      notify={notify}
                      setNotify={setNotifyByUser}
                      message={message}
                      setMessage={setMessage}
                    />
                    <Button className="panel-btn panel-btn-primary agd-btn" isDisabled={busy || !waiveReason} onPress={() => void confirmWithoutSignal()}>
                      {busy ? 'Confirmando…' : 'Confirmar sem sinal'}
                    </Button>
                  </div>
                ) : null}
              </>
            ) : (
              <>
                <dl className="agd-table">
                  {rows.map(([k, v]) => (
                    <div key={k} className="agd-table-row">
                      <dt>{k}</dt>
                      <dd>{v}</dd>
                    </div>
                  ))}
                </dl>
                <NoticeField
                  canNotify={canNotify}
                  hasConversation={Boolean(ctx.conversationId)}
                  notify={notify}
                  setNotify={setNotifyByUser}
                  message={message}
                  setMessage={setMessage}
                />
                <Button className="panel-btn panel-btn-primary agd-btn" isDisabled={busy || (notify && !message.trim())} onPress={() => void confirm()}>
                  {busy ? 'Confirmando…' : p.paidSignalMode ? 'Confirmar com sinal pago' : notify ? 'Confirmar e enviar' : 'Confirmar agendamento'}
                </Button>
              </>
            )}
            <Button className="panel-btn panel-btn-ghost agd-btn" slot="close" isDisabled={busy}>
              Voltar e alterar
            </Button>
          </div>
        </Dialog>
      </Modal>
    </ModalOverlay>
  )
}

function NoticeField(p: {
  canNotify: boolean
  hasConversation: boolean
  notify: boolean
  setNotify: (v: boolean) => void
  message: string
  setMessage: (v: string) => void
}) {
  if (!p.canNotify) {
    return (
      <p className="agd-note" role="note">
        {p.hasConversation
          ? 'Aviso pelo WhatsApp indisponível: a janela de 24 h está fechada. Fora dela só um modelo aprovado pode ser enviado.'
          : 'Sem conversa vinculada: o aviso pelo WhatsApp não será enviado.'}
      </p>
    )
  }
  return (
    <div className="agd-notice">
      <label className="agd-check">
        <input type="checkbox" checked={p.notify} onChange={(e) => p.setNotify(e.target.checked)} />
        <span>Enviar confirmação à paciente pelo WhatsApp</span>
      </label>
      {p.notify ? (
        <TextField className="panel-field" value={p.message} onChange={p.setMessage}>
          <Label>Mensagem para a paciente (WhatsApp)</Label>
          <TextArea className="agd-textarea" rows={4} />
          <span className="panel-field-hint">Enviada ao confirmar. Você pode editar o texto.</span>
        </TextField>
      ) : null}
    </div>
  )
}

function AgendarSuccess(props: {
  success: Success
  contact: Contact | null
  hasConversation: boolean
  onConversation: () => void
  onAgenda: () => void
}) {
  const { success } = props
  const ref = useRef<HTMLHeadingElement | null>(null)
  useEffect(() => ref.current?.focus(), [])
  const title =
    success.kind === 'signal'
      ? 'Sinal enviado'
      : success.kind === 'waived'
        ? 'Horário agendado sem sinal'
        : 'Horário agendado'
  const noticeText: Record<NoticeStatus, string> = {
    sent: success.kind === 'signal' ? 'Cobrança enviada' : 'Mensagem enviada',
    failed: 'Não enviada',
    off: 'Não enviada (desligado)',
    unavailable: 'Não enviada',
  }
  return (
    <div className="agd agd-success" data-screen="m04-agendar-sucesso">
      <div className="panel-scroll agd-success-body">
        <span className="agd-success-icon" aria-hidden="true">
          <Check size={32} strokeWidth={2.4} />
        </span>
        <h1 className="panel-title-lg" tabIndex={-1} ref={ref}>
          {title}
        </h1>
        {props.contact ? (
          <p className="panel-subtitle">{[props.contact.name, props.contact.phone].filter(Boolean).join(' · ')}</p>
        ) : null}
        {success.kind === 'signal' ? (
          <p className="agd-note" role="note">O horário só é reservado quando o Pix for pago.</p>
        ) : null}
        <dl className="agd-table">
          <div className="agd-table-row"><dt>Serviço</dt><dd>{success.serviceLabel}</dd></div>
          <div className="agd-table-row"><dt>Profissional</dt><dd>{success.professionalName}</dd></div>
          <div className="agd-table-row"><dt>Quando</dt><dd>{success.whenLabel}</dd></div>
          <div className="agd-table-row">
            <dt>WhatsApp</dt>
            <dd data-notice={success.notice} role={success.notice === 'failed' ? 'alert' : undefined}>
              {success.notice === 'sent' ? <CheckCheck aria-hidden size={16} strokeWidth={2} /> : null}
              {noticeText[success.notice]}
            </dd>
          </div>
        </dl>
        {success.notice === 'failed' && success.noticeDetail ? (
          <p className="panel-meta">{success.noticeDetail} O compromisso continua confirmado.</p>
        ) : null}
      </div>
      <footer className="panel-footer agd-footer">
        {props.hasConversation ? (
          <Button className="panel-btn panel-btn-primary agd-btn" onPress={props.onConversation}>
            Voltar à conversa
          </Button>
        ) : null}
        <Button
          className={`panel-btn ${props.hasConversation ? 'panel-btn-secondary' : 'panel-btn-primary'} agd-btn`}
          onPress={props.onAgenda}
        >
          Ver na agenda
        </Button>
      </footer>
    </div>
  )
}
