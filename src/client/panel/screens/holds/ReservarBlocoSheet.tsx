import { Minus, Plus } from 'lucide-react'
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
  const [message, setMessage] = useState('')
  const [messageEdited, setMessageEdited] = useState(false)
  const [editing, setEditing] = useState(false)
  const [preview, setPreview] = useState<{ freeMinutes: number; fits: boolean } | null>(null)
  const [busy, setBusy] = useState(false)
  const requestId = useRef(`client:${crypto.randomUUID()}`)
  const sheetStyle = useVisualViewportSheet(open)

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
            O período fica reservado na agenda da profissional até a hora ser definida.
          </p>

          {!config && !error ? <p className="panel-meta">Carregando…</p> : null}

          {config ? (
            <>
              <HoldSelect
                label="Dia"
                placeholder="Escolher dia"
                value={date}
                onChange={setDate}
                options={days.map((d) => ({ id: d, label: formatLongDate(d, tz) }))}
              />

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

              <div className="hold-group" role="group" aria-label="Duração deste atendimento">
                <span className="hold-label">Duração deste atendimento</span>
                <div className="hold-options hold-grid-3">
                  {DURATION_PRESETS.map((m) => (
                    <button
                      key={m}
                      type="button"
                      className="hold-option"
                      aria-pressed={duration === m}
                      onClick={() => setDuration(m)}
                    >
                      {durationLabel(m)}
                    </button>
                  ))}
                </div>
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
                {!durationValid ? (
                  <span className="hold-warn">A duração precisa ser múltipla de 15 min e caber no período.</span>
                ) : null}
              </div>

              <div className="hold-group">
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

          <div className="hold-sheet-footer">
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
          </div>
        </Dialog>
      </Modal>
    </ModalOverlay>
  )
}
