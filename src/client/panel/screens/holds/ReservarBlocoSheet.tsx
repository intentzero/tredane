import { useEffect, useMemo, useRef, useState } from 'react'
import { Button, Dialog, Heading, Modal, ModalOverlay } from 'react-aria-components'
import type { ClinicConfigSnapshot, PanelApi, ScheduleHold } from '../../api'
import { friendlyError } from '../../copy/errors'
import { formatLongDate, upcomingCivilDates } from '../agenda/format'
import {
  DURATION_PRESETS,
  PERIOD_PRESETS,
  civilMinuteToEpoch,
  defaultConfirmBy,
  durationLabel,
  firstName,
  holdReservedMessage,
  hourLabel,
  type PeriodPreset,
} from './holdFormat'

type Props = {
  open: boolean
  tenantId: string
  api: PanelApi
  generation: number
  conversationId: string
  contactName: string | null
  windowOpen: boolean
  onClose: () => void
  /** Bloco criado; `message` é o texto a enviar (ou null se não for enviar). */
  onReserved: (hold: ScheduleHold, message: string | null) => Promise<void> | void
}

const HALF_HOURS = Array.from({ length: 33 }, (_, i) => 6 * 60 + i * 30) // 6h–22h

/** Design 02 — «Reservar bloco»: dia + período + profissional + duração. */
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
  const [durationMode, setDurationMode] = useState<'preset' | 'outra'>('preset')
  const [message, setMessage] = useState('')
  const [messageEdited, setMessageEdited] = useState(false)
  const [editing, setEditing] = useState(false)
  const [preview, setPreview] = useState<{ freeMinutes: number; fits: boolean } | null>(null)
  const [busy, setBusy] = useState(false)
  const requestId = useRef(`client:${crypto.randomUUID()}`)

  useEffect(() => {
    if (!open) return
    requestId.current = `client:${crypto.randomUUID()}`
    setError(null)
    setMessageEdited(false)
    setEditing(false)
    let cancelled = false
    api
      .getClinicConfig(tenantId, { generation, expectGeneration: () => generation })
      .then((snap) => {
        if (cancelled) return
        setConfig(snap)
        const svc = snap.services.find((s) => s.active)
        setServiceId((prev) => prev || svc?.id || '')
        setDate((prev) => prev || upcomingCivilDates(snap.settings.timezone, Date.now(), 2)[1]!)
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
    (r) => r.kind === 'professional' && r.active && (!service || service.professionalIds.includes(r.id)),
  )
  const professional = professionals.find((p) => p.id === professionalId)

  useEffect(() => {
    if (professionals.length > 0 && !professionals.some((p) => p.id === professionalId)) {
      setProfessionalId(professionals[0]!.id)
    }
  }, [professionals, professionalId])

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

  const confirmBy = win && date ? defaultConfirmBy(date, win.startsAt, tz, Date.now()) : null
  const durationValid = duration >= 15 && duration % 15 === 0 && (!win || duration <= win.minutes)

  useEffect(() => {
    if (messageEdited || !win || !service || !professional) return
    setMessage(
      holdReservedMessage({
        contactName,
        serviceName: service.name,
        professionalName: professional.name,
        windowStartsAt: win.startsAt,
        windowEndsAt: win.endsAt,
        confirmBy,
        timeZone: tz,
      }),
    )
  }, [messageEdited, win, service, professional, contactName, confirmBy, tz])

  useEffect(() => {
    setPreview(null)
    if (!open || !win || !professionalId || !durationValid) return
    let cancelled = false
    const t = setTimeout(() => {
      api
        .previewHold(
          tenantId,
          { professionalId, windowStartsAt: win.startsAt, windowEndsAt: win.endsAt, durationMinutes: duration },
          { generation, expectGeneration: () => generation },
        )
        .then((p) => {
          if (!cancelled) setPreview(p)
        })
        .catch(() => {
          if (!cancelled) setPreview(null)
        })
    }, 200)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [open, api, tenantId, generation, win, professionalId, duration, durationValid])

  const days = config ? upcomingCivilDates(tz, Date.now(), 21) : []
  const periodWord = period === 'manha' ? 'nessa manhã' : period === 'tarde' ? 'nessa tarde' : 'nesse período'
  const canSubmit = !!win && !!service && !!professional && durationValid && !busy && preview?.fits !== false

  async function submit() {
    if (!win || !service || !professional) return
    setBusy(true)
    setError(null)
    try {
      const res = await api.createHold(
        tenantId,
        {
          clientRequestId: requestId.current,
          conversationId,
          serviceId: service.id,
          professionalId: professional.id,
          windowStartsAt: win.startsAt,
          windowEndsAt: win.endsAt,
          durationMinutes: duration,
          confirmBy,
        },
        { generation, expectGeneration: () => generation },
      )
      await onReserved(res.hold, windowOpen && message.trim() ? message.trim() : null)
      onClose()
    } catch (err) {
      setError(friendlyError(err, 'Não foi possível reservar o bloco.'))
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
        <Dialog className="panel-sheet hold-sheet" style={{ position: 'fixed', left: 0, right: 0, bottom: 0 }} aria-labelledby="hold-sheet-title">
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
            O período fica reservado na agenda da profissional até a hora ser definida.
          </p>

          {!config && !error ? <p className="panel-meta">Carregando…</p> : null}

          {config ? (
            <>
              <label className="clinic-field">
                Dia
                <select value={date} onChange={(e) => setDate(e.target.value)}>
                  {days.map((d) => (
                    <option key={d} value={d}>
                      {formatLongDate(d, tz)}
                    </option>
                  ))}
                </select>
              </label>

              <div className="hold-group" role="group" aria-label="Período">
                <span className="hold-label">Período</span>
                <div className="hold-options">
                  {(['manha', 'tarde', 'outro'] as const).map((p) => (
                    <button
                      key={p}
                      type="button"
                      className="hold-option"
                      aria-pressed={period === p}
                      onClick={() => setPeriod(p)}
                    >
                      {p === 'manha' ? 'Manhã 8–12h' : p === 'tarde' ? 'Tarde 13–18h' : 'Outro…'}
                    </button>
                  ))}
                </div>
                {period === 'outro' ? (
                  <div className="clinic-field-row">
                    <label className="clinic-field">
                      Das
                      <select value={customStart} onChange={(e) => setCustomStart(Number(e.target.value))}>
                        {HALF_HOURS.map((m) => (
                          <option key={m} value={m}>
                            {hourLabel(m)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="clinic-field">
                      Até
                      <select value={customEnd} onChange={(e) => setCustomEnd(Number(e.target.value))}>
                        {HALF_HOURS.filter((m) => m > customStart).map((m) => (
                          <option key={m} value={m}>
                            {hourLabel(m)}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                ) : null}
              </div>

              <div className="clinic-field-row">
                <label className="clinic-field">
                  Procedimento
                  <select value={serviceId} onChange={(e) => setServiceId(e.target.value)}>
                    {services.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="clinic-field">
                  Profissional
                  <select value={professionalId} onChange={(e) => setProfessionalId(e.target.value)}>
                    {professionals.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="hold-group" role="group" aria-label="Duração deste atendimento">
                <span className="hold-label">Duração deste atendimento</span>
                <div className="hold-options">
                  {DURATION_PRESETS.map((m) => (
                    <button
                      key={m}
                      type="button"
                      className="hold-option"
                      aria-pressed={durationMode === 'preset' && duration === m}
                      onClick={() => {
                        setDurationMode('preset')
                        setDuration(m)
                      }}
                    >
                      {durationLabel(m)}
                    </button>
                  ))}
                  <button
                    type="button"
                    className="hold-option"
                    aria-pressed={durationMode === 'outra'}
                    onClick={() => setDurationMode('outra')}
                  >
                    Outra
                  </button>
                </div>
                {durationMode === 'outra' ? (
                  <label className="clinic-field">
                    Minutos (de 15 em 15)
                    <input
                      type="number"
                      min={15}
                      step={15}
                      max={720}
                      value={duration}
                      onChange={(e) => setDuration(Number(e.target.value))}
                    />
                  </label>
                ) : null}
                {!durationValid ? (
                  <span className="hold-warn">A duração precisa ser múltipla de 15 min e caber no período.</span>
                ) : null}
              </div>

              <div className="hold-group">
                <span className="hold-label">Mensagem que a paciente vai receber</span>
                {editing ? (
                  <textarea
                    className="panel-textarea"
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
                    <p>{message}</p>
                    <button type="button" className="hold-link" onClick={() => setEditing(true)}>
                      Editar texto
                    </button>
                  </div>
                )}
                {!windowOpen ? (
                  <span className="hold-warn">
                    Passaram 24 h desde a última mensagem da paciente: o bloco é reservado, mas a mensagem não vai.
                    Copie o texto ou use um modelo aprovado.
                  </span>
                ) : null}
              </div>
            </>
          ) : null}

          {error ? (
            <div className="inbox-notice" role="alert">
              {error}
            </div>
          ) : null}

          <Button className="panel-btn-primary" isDisabled={!canSubmit} onPress={() => void submit()}>
            {busy ? 'Reservando…' : windowOpen ? 'Reservar e avisar paciente' : 'Reservar bloco'}
          </Button>
          {preview && professional ? (
            <p className={`hold-foot${preview.fits ? '' : ' hold-foot--warn'}`} role="status">
              {professional.name} tem {durationLabel(preview.freeMinutes)} livres {periodWord} ·{' '}
              {preview.fits ? `cabe ${durationLabel(duration)}` : `não cabe ${durationLabel(duration)}`}
            </p>
          ) : null}
        </Dialog>
      </Modal>
    </ModalOverlay>
  )
}
