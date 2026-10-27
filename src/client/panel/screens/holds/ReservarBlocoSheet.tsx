import { Minus, Plus } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Button, Dialog, Heading, Modal, ModalOverlay } from 'react-aria-components'
import type { AvailabilitySlot, ClinicConfigSnapshot, PanelApi } from '../../api'
import { setClinicTimezone } from '../../clinicTimezone'
import { friendlyError } from '../../copy/errors'
import '../agenda/agendar.css'
import { formatDayLabel, formatLongDate, upcomingCivilDates } from '../agenda/format'
import {
  DURATION_PRESETS,
  PERIOD_PRESETS,
  civilMinuteToEpoch,
  durationLabel,
  firstName,
  holdConfirmedMessage,
  hourLabel,
  type PeriodPreset,
} from './holdFormat'
import { HoldSelect } from './HoldSelect'
import { useVisualViewportSheet } from './useVisualViewportSheet'

type Props = {
  open: boolean
  tenantId: string
  api: PanelApi
  generation: number
  conversationId: string
  contactName: string | null
  windowOpen: boolean
  onClose: () => void
  /** Reservado com hora; `message` é o texto a enviar (ou null se não for enviar). */
  onReserved: (message: string | null) => Promise<void> | void
}

const HALF_HOURS = Array.from({ length: 33 }, (_, i) => 6 * 60 + i * 30) // 6h–22h

/**
 * Design 02 — «Reservar bloco»: dia + período + procedimento + profissional +
 * duração e, obrigatoriamente, um horário livre dentro do período. O
 * compromisso ocupa a duração do bloco (decisão de 27/10/2026).
 */
function slotTime(ms: number, timeZone: string): string {
  return new Intl.DateTimeFormat('pt-BR', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(
    new Date(ms),
  )
}

export function ReservarBlocoSheet(props: Props) {
  const { open, tenantId, api, generation, conversationId, contactName, windowOpen, onClose, onReserved } = props
  const [config, setConfig] = useState<ClinicConfigSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [date, setDate] = useState('')
  const [period, setPeriod] = useState<PeriodPreset>('manha')
  const [customStart, setCustomStart] = useState(9 * 60)
  const [customEnd, setCustomEnd] = useState(13 * 60)
  const [serviceId, setServiceId] = useState('')
  const [professionalId, setProfessionalId] = useState('')
  const [duration, setDuration] = useState<number>(60)
  const [message, setMessage] = useState('')
  const [messageEdited, setMessageEdited] = useState(false)
  const [editing, setEditing] = useState(false)
  const [slots, setSlots] = useState<AvailabilitySlot[] | null>(null)
  const [slotStartsAt, setSlotStartsAt] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [editDetails, setEditDetails] = useState(false)
  const [customDuration, setCustomDuration] = useState(false)
  const [notify, setNotify] = useState(true)
  const requestId = useRef(`client:${crypto.randomUUID()}`)
  const sheetStyle = useVisualViewportSheet(open)

  useEffect(() => {
    if (!open) return
    requestId.current = `client:${crypto.randomUUID()}`
    setError(null)
    setMessageEdited(false)
    setEditing(false)
    setEditDetails(false)
    setCustomDuration(false)
    setNotify(true)
    let cancelled = false
    api
      .getClinicConfig(tenantId, { generation, expectGeneration: () => generation })
      .then((snap) => {
        if (cancelled) return
        setConfig(snap)
        setClinicTimezone(tenantId, snap.settings.timezone)
        const svc = snap.services.find((s) => s.active)
        setServiceId((prev) => prev || svc?.id || '')
        // Mesmo começo do Agendar: hoje; depois das 18h já não há o que reservar, vai para amanhã.
        const hour = Number(
          new Intl.DateTimeFormat('en-US', {
            timeZone: snap.settings.timezone,
            hour: '2-digit',
            hourCycle: 'h23',
          }).format(new Date()),
        )
        const dayIdx = hour >= 18 ? 1 : 0
        setDate((prev) => prev || upcomingCivilDates(snap.settings.timezone, Date.now(), 2)[dayIdx]!)
        if (hour >= 12 && hour < 18) setPeriod('tarde')
      })
      .catch((err) => {
        if (!cancelled) setError(friendlyError(err, 'Não conseguimos carregar a agenda da clínica.'))
      })
    return () => {
      cancelled = true
    }
  }, [open, api, tenantId, generation])

  const tz = config?.settings.timezone ?? 'America/Sao_Paulo'
  const services = config?.services.filter((s) => s.active) ?? []
  const service = services.find((s) => s.id === serviceId)
  const professionals = (config?.resources ?? []).filter(
    (r) =>
      r.kind === 'professional' &&
      r.active &&
      // Lista vazia no serviço = qualquer profissional (mesma regra do servidor).
      (!service || service.professionalIds.length === 0 || service.professionalIds.includes(r.id)),
  )
  const professional = professionals.find((p) => p.id === professionalId)

  const professionalKey = professionals.map((p) => p.id).join(',')
  useEffect(() => {
    // Uma só opção: já vem escolhida. Várias: placeholder até a pessoa escolher.
    if (professionals.some((p) => p.id === professionalId)) return
    setProfessionalId(professionals.length === 1 ? professionals[0]!.id : '')
  }, [professionalKey, professionalId])

  const win = useMemo(() => {
    if (!date) return null
    const range = period === 'outro' ? { start: customStart, end: customEnd } : PERIOD_PRESETS[period]
    if (range.end <= range.start) return null
    return {
      startsAt: civilMinuteToEpoch(date, range.start, tz),
      endsAt: civilMinuteToEpoch(date, range.end, tz),
      minutes: range.end - range.start,
    }
  }, [date, period, customStart, customEnd, tz])

  const durationValid = duration >= 15 && duration % 15 === 0 && (!win || duration <= win.minutes)
  const slot = (slots ?? []).find((x) => x.startsAt === slotStartsAt) ?? null

  // Horários livres para a DURAÇÃO DO BLOCO, só da profissional e dentro do período.
  useEffect(() => {
    setSlots(null)
    setSlotStartsAt(null)
    if (!open || !win || !date || !service || !professionalId || !durationValid) return
    let cancelled = false
    const t = setTimeout(() => {
      api
        .queryAvailability(
          tenantId,
          { serviceId: service.id, date, professionalId, durationMinutes: duration },
          { generation, expectGeneration: () => generation },
        )
        .then((res) => {
          if (cancelled) return
          setSlots(
            res.slots.filter(
              (x) => x.professionalId === professionalId && x.startsAt >= win.startsAt && x.endsAt <= win.endsAt,
            ),
          )
        })
        .catch((err) => {
          if (cancelled) return
          setSlots([])
          setError(friendlyError(err, 'Não conseguimos carregar os horários livres.'))
        })
    }, 200)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [open, api, tenantId, generation, win, date, service, professionalId, duration, durationValid])

  useEffect(() => {
    if (messageEdited) return
    if (!slot || !service || !professional) {
      setMessage('')
      return
    }
    setMessage(
      holdConfirmedMessage({
        contactName,
        serviceName: service.name,
        professionalName: professional.name,
        startsAt: slot.startsAt,
        endsAt: slot.endsAt,
        timeZone: tz,
        roomName: slot.roomResourceName,
      }),
    )
  }, [messageEdited, slot, service, professional, contactName, tz])

  const days = config ? upcomingCivilDates(tz, Date.now(), 21) : []
  const canSubmit = !!win && !!service && !!professional && durationValid && !!slot && !busy

  async function submit() {
    if (!win || !service || !professional || !slot) return
    setBusy(true)
    setError(null)
    try {
      await api.createHold(
        tenantId,
        {
          clientRequestId: requestId.current,
          conversationId,
          serviceId: service.id,
          professionalId: professional.id,
          windowStartsAt: win.startsAt,
          windowEndsAt: win.endsAt,
          durationMinutes: duration,
          startsAt: slot.startsAt,
          roomResourceId: slot.roomResourceId,
        },
        { generation, expectGeneration: () => generation },
      )
      await onReserved(windowOpen && notify && message.trim() ? message.trim() : null)
      onClose()
    } catch (err) {
      setError(friendlyError(err, 'Não foi possível reservar. Escolha outro horário.'))
    } finally {
      setBusy(false)
    }
  }

  const name = firstName(contactName)

  return (
    <ModalOverlay
      isOpen={open}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      className="panel-overlay"
      style={{ position: 'fixed', inset: 0, zIndex: 30 }}
      isDismissable={!busy}
    >
      <Modal>
        <Dialog className="panel-sheet hold-sheet" style={sheetStyle} aria-labelledby="hold-sheet-title">
          <span className="panel-sheet-handle" aria-hidden="true" />
          <div className="hold-sheet-head">
            <Heading slot="title" id="hold-sheet-title" className="panel-title">
              Reservar bloco{name ? ` para ${name}` : ''}
            </Heading>
            <Button className="panel-btn-ghost panel-btn-compact" onPress={onClose} isDisabled={busy}>
              Fechar
            </Button>
          </div>
          <p className="panel-subtitle hold-sheet-sub">
            Escolha o período e um horário livre: o atendimento ocupa a duração do bloco na agenda.
          </p>

          {!config && !error ? <p className="panel-meta">Carregando…</p> : null}

          {config ? (
            <>
              <div className="hold-group" role="group" aria-labelledby="hold-day-label">
                <span id="hold-day-label" className="hold-label">Dia</span>
                <div className="agd-day-grid">
                  {days.slice(0, 5).map((d) => {
                    const l = formatDayLabel(d, tz)
                    return (
                      <button
                        key={d}
                        type="button"
                        className="agd-day"
                        aria-pressed={date === d}
                        aria-label={`${l.weekday} ${l.day}`}
                        onClick={() => setDate(d)}
                      >
                        <span>{l.weekday}</span>
                        <span>{Number(l.day)}</span>
                      </button>
                    )
                  })}
                </div>
                <HoldSelect
                  label="Outro dia"
                  placeholder="Escolher outro dia"
                  value={days.slice(0, 5).includes(date) ? '' : date}
                  onChange={setDate}
                  options={days.slice(5).map((d) => ({ id: d, label: formatLongDate(d, tz) }))}
                />
              </div>

              <div className="hold-group" role="group" aria-label="Período">
                <span className="hold-label">Período</span>
                <div className="hold-options hold-grid-3">
                  {(['manha', 'tarde', 'outro'] as const).map((p) => (
                    <button
                      key={p}
                      type="button"
                      className="hold-option hold-option--two"
                      aria-pressed={period === p}
                      onClick={() => setPeriod(p)}
                    >
                      <span className="hold-option-main">
                        {p === 'manha' ? 'Manhã' : p === 'tarde' ? 'Tarde' : 'Outro'}
                      </span>
                      <span className="hold-option-sub">
                        {p === 'manha' ? '8–12h' : p === 'tarde' ? '13–18h' : 'escolher'}
                      </span>
                    </button>
                  ))}
                </div>
                {period === 'outro' ? (
                  <div className="hold-row">
                    <HoldSelect
                      label="Das"
                      placeholder="Início"
                      value={String(customStart)}
                      onChange={(v) => {
                        const start = Number(v)
                        setCustomStart(start)
                        if (customEnd <= start) setCustomEnd(start + 60)
                      }}
                      options={HALF_HOURS.slice(0, -1).map((m) => ({ id: String(m), label: hourLabel(m) }))}
                    />
                    <HoldSelect
                      label="Até"
                      placeholder="Fim"
                      value={String(customEnd)}
                      onChange={(v) => setCustomEnd(Number(v))}
                      options={HALF_HOURS.filter((m) => m > customStart).map((m) => ({ id: String(m), label: hourLabel(m) }))}
                    />
                  </div>
                ) : null}
              </div>

              {service && professional && !editDetails ? (
                <div className="hold-summary">
                  <div className="hold-summary-copy">
                    <span className="hold-label">Atendimento</span>
                    <span>
                      {service.name} · {professional.name}
                    </span>
                  </div>
                  <button type="button" className="hold-link" onClick={() => setEditDetails(true)}>
                    Alterar
                  </button>
                </div>
              ) : (
                <>
                  <HoldSelect
                    label="Procedimento"
                    placeholder="Escolher procedimento"
                    value={serviceId}
                    onChange={setServiceId}
                    options={services.map((sv) => ({ id: sv.id, label: sv.name }))}
                  />
                  <HoldSelect
                    label="Profissional"
                    placeholder={professionals.length === 0 ? 'Nenhuma profissional para este procedimento' : 'Escolher profissional'}
                    value={professionalId}
                    onChange={setProfessionalId}
                    isDisabled={professionals.length === 0}
                    options={professionals.map((p) => ({ id: p.id, label: p.name }))}
                  />
                </>
              )}

              <div className="hold-group" role="group" aria-label="Duração deste atendimento">
                <span className="hold-label">Duração deste atendimento</span>
                <div className="hold-options hold-grid-3">
                  {DURATION_PRESETS.map((m) => (
                    <button
                      key={m}
                      type="button"
                      className="hold-option"
                      aria-pressed={duration === m}
                      onClick={() => {
                        setDuration(m)
                        setCustomDuration(false)
                      }}
                    >
                      {durationLabel(m)}
                    </button>
                  ))}
                  <button
                    type="button"
                    className="hold-option"
                    aria-pressed={customDuration || !(DURATION_PRESETS as readonly number[]).includes(duration)}
                    onClick={() => setCustomDuration(true)}
                  >
                    Outra
                  </button>
                </div>
                {customDuration || !(DURATION_PRESETS as readonly number[]).includes(duration) ? (
                <div className="hold-stepper" role="group" aria-label="Outra duração, de 15 em 15 minutos">
                  <span className="hold-stepper-label">Outra (±15 min)</span>
                  <button
                    type="button"
                    className="hold-stepper-btn"
                    aria-label="Menos 15 minutos"
                    disabled={duration <= 15}
                    onClick={() => setDuration((d) => Math.max(15, d - 15))}
                  >
                    <Minus aria-hidden size={18} strokeWidth={2.2} />
                  </button>
                  <output
                    className={`hold-stepper-value${(DURATION_PRESETS as readonly number[]).includes(duration) ? '' : ' hold-stepper-value--on'}`}
                    aria-live="polite"
                  >
                    {durationLabel(duration)}
                  </output>
                  <button
                    type="button"
                    className="hold-stepper-btn"
                    aria-label="Mais 15 minutos"
                    disabled={duration >= Math.min(720, win?.minutes ?? 720)}
                    onClick={() => setDuration((d) => Math.min(720, d + 15))}
                  >
                    <Plus aria-hidden size={18} strokeWidth={2.2} />
                  </button>
                </div>
                ) : null}
                {!durationValid ? (
                  <span className="hold-warn">A duração precisa ser múltipla de 15 min e caber no período.</span>
                ) : null}
              </div>

              <div className="hold-group" role="group" aria-label="Horário">
                <span className="hold-label">Horário (obrigatório)</span>
                {!professional ? (
                  <p className="panel-meta">Escolha a profissional para ver os horários livres.</p>
                ) : slots == null ? (
                  <p className="panel-meta">Carregando horários livres…</p>
                ) : slots.length === 0 ? (
                  <span className="hold-warn">
                    {professional.name} não tem {durationLabel(duration)} livres neste período. Escolha outro dia ou período.
                  </span>
                ) : (
                  <div className="hold-options hold-grid-4">
                    {slots.map((x) => (
                      <button
                        key={x.startsAt}
                        type="button"
                        className="hold-option"
                        aria-pressed={slotStartsAt === x.startsAt}
                        aria-label={`${slotTime(x.startsAt, tz)} até ${slotTime(x.endsAt, tz)}`}
                        onClick={() => setSlotStartsAt(x.startsAt)}
                      >
                        {slotTime(x.startsAt, tz)}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="hold-group">
                {windowOpen ? (
                  <label className="agd-check">
                    <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} />
                    <span>Avisar a paciente pelo WhatsApp</span>
                  </label>
                ) : null}
                {!windowOpen || notify ? (
                <>
                <span className="hold-label">Mensagem que a paciente vai receber</span>
                {editing ? (
                  <textarea
                    className="panel-textarea"
                    autoComplete="off"
                    aria-label="Mensagem que a paciente vai receber"
                    rows={5}
                    value={message}
                    onChange={(e) => {
                      setMessage(e.target.value)
                      setMessageEdited(true)
                    }}
                  />
                ) : (
                  <div className="hold-message">
                    <p>{message || 'Escolha um horário para ver a mensagem.'}</p>
                    {message ? (
                      <button type="button" className="hold-link" onClick={() => setEditing(true)}>
                        Editar texto
                      </button>
                    ) : null}
                  </div>
                )}
                {!windowOpen ? (
                  <span className="hold-warn">
                    Passaram 24 h desde a última mensagem da paciente: o horário é reservado, mas a mensagem não vai.
                    Copie o texto ou use um modelo aprovado.
                  </span>
                ) : null}
                </>
                ) : (
                  <p className="panel-meta">A paciente não será avisada. O horário fica só na agenda.</p>
                )}
              </div>
            </>
          ) : null}

          <div className="hold-sheet-footer">
          {error ? (
            <div className="inbox-notice" role="alert">
              {error}
            </div>
          ) : null}

          <Button className="panel-btn-primary" isDisabled={!canSubmit} onPress={() => void submit()}>
            {busy ? 'Reservando…' : 'Reservar horário'}
          </Button>
          {slot && professional ? (
            <p className="hold-foot" role="status">
              {slotTime(slot.startsAt, tz)}–{slotTime(slot.endsAt, tz)} · {professional.name} · {durationLabel(duration)}
            </p>
          ) : !slot && professional ? (
            <p className="hold-foot" role="status">Escolha um horário para reservar.</p>
          ) : null}
          </div>
        </Dialog>
      </Modal>
    </ModalOverlay>
  )
}
