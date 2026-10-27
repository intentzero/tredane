import { useEffect, useRef, useState } from 'react'
import { Button, Dialog, Heading, Modal, ModalOverlay } from 'react-aria-components'
import type { AvailabilitySlot, PanelApi, ScheduleHold } from '../../api'
import { friendlyError } from '../../copy/errors'
import { formatSlotTime } from '../agenda/format'
import {
  durationLabel,
  firstName,
  holdConfirmedMessage,
  holdOptionsMessage,
  periodChip,
  shortDay,
} from './holdFormat'

type Props = {
  open: boolean
  tenantId: string
  api: PanelApi
  generation: number
  hold: ScheduleHold | null
  timezone: string
  onClose: () => void
  /** Depois de confirmar a hora ou enviar opções (para recarregar a tela). */
  onDone: (outcome: { kind: 'resolved' | 'options'; sent: boolean }) => void
}

function civilDate(ms: number, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(
    new Date(ms),
  )
}

/** Design 05 — «Definir hora»: horas livres dentro do bloco reservado. */
export function DefinirHoraSheet({ open, tenantId, api, generation, hold, timezone, onClose, onDone }: Props) {
  const [slots, setSlots] = useState<AvailabilitySlot[] | null>(null)
  const [windowOpen, setWindowOpen] = useState<boolean | null>(null)
  const [mode, setMode] = useState<'confirm' | 'options'>('confirm')
  const [picked, setPicked] = useState<number[]>([])
  const [message, setMessage] = useState('')
  const [edited, setEdited] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const requestId = useRef(`client:${crypto.randomUUID()}`)

  useEffect(() => {
    if (!open || !hold) return
    requestId.current = `client:${crypto.randomUUID()}`
    setSlots(null)
    setPicked([])
    setEdited(false)
    setError(null)
    setCopied(false)
    setMode('confirm')
    let cancelled = false
    const opts = { generation, expectGeneration: () => generation }
    api
      .queryAvailability(
        tenantId,
        {
          serviceId: hold.serviceId,
          date: civilDate(hold.windowStartsAt, timezone),
          professionalId: hold.professionalId,
          excludeHoldId: hold.id,
        },
        opts,
      )
      .then((res) => {
        if (cancelled) return
        setSlots(
          res.slots.filter(
            (s) =>
              s.professionalId === hold.professionalId &&
              s.startsAt >= hold.windowStartsAt &&
              s.startsAt < hold.windowEndsAt,
          ),
        )
      })
      .catch((err) => {
        if (cancelled) return
        setSlots([])
        setError(friendlyError(err, 'Não conseguimos carregar as horas livres.'))
      })
    api
      .getInboxConversation(tenantId, hold.conversationId, { messageLimit: 1 }, opts)
      .then((c) => {
        if (!cancelled) setWindowOpen(c.messagingWindow?.open !== false)
      })
      .catch(() => {
        if (!cancelled) setWindowOpen(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, hold, api, tenantId, generation, timezone])

  const chosen = (slots ?? []).filter((s) => picked.includes(s.startsAt))

  useEffect(() => {
    if (edited || !hold) return
    if (mode === 'confirm') {
      const s = chosen[0]
      setMessage(
        s
          ? holdConfirmedMessage({
              contactName: hold.contactName,
              serviceName: hold.serviceName,
              professionalName: hold.professionalName,
              startsAt: s.startsAt,
              endsAt: s.endsAt,
              roomName: s.roomResourceName,
              timeZone: timezone,
            })
          : '',
      )
    } else {
      setMessage(
        chosen.length > 0
          ? holdOptionsMessage({
              contactName: hold.contactName,
              professionalName: hold.professionalName,
              windowStartsAt: hold.windowStartsAt,
              windowEndsAt: hold.windowEndsAt,
              options: chosen.map((s) => s.startsAt),
              timeZone: timezone,
            })
          : '',
      )
    }
  }, [edited, hold, mode, picked, slots, timezone])

  function toggle(startsAt: number) {
    setEdited(false)
    if (mode === 'confirm') {
      setPicked([startsAt])
      return
    }
    setPicked((prev) =>
      prev.includes(startsAt) ? prev.filter((x) => x !== startsAt) : prev.length >= 3 ? prev : [...prev, startsAt].sort((a, b) => a - b),
    )
  }

  async function sendText(text: string): Promise<boolean> {
    if (!hold || !windowOpen || !text.trim()) return false
    await api.sendInboxMessage(
      tenantId,
      hold.conversationId,
      { body: text.trim(), clientRequestId: `client:${crypto.randomUUID()}` },
      { generation, expectGeneration: () => generation },
    )
    return true
  }

  async function confirm() {
    const s = chosen[0]
    if (!hold || !s) return
    setBusy(true)
    setError(null)
    try {
      await api.resolveHold(
        tenantId,
        hold.id,
        { clientRequestId: requestId.current, startsAt: s.startsAt, roomResourceId: s.roomResourceId },
        { generation, expectGeneration: () => generation },
      )
      let sent = false
      try {
        sent = await sendText(message)
      } catch {
        setError('Horário confirmado, mas a mensagem não foi enviada. Envie pela conversa.')
        onDone({ kind: 'resolved', sent: false })
        return
      }
      onDone({ kind: 'resolved', sent })
      onClose()
    } catch (err) {
      setError(friendlyError(err, 'Não foi possível confirmar este horário. Escolha outro.'))
    } finally {
      setBusy(false)
    }
  }

  async function sendOptions() {
    setBusy(true)
    setError(null)
    try {
      const sent = await sendText(message)
      onDone({ kind: 'options', sent })
      onClose()
    } catch (err) {
      setError(friendlyError(err, 'A mensagem não foi enviada. Tente de novo.'))
    } finally {
      setBusy(false)
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(message)
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }

  if (!hold) return null
  const name = firstName(hold.contactName)
  const canConfirm = mode === 'confirm' && chosen.length === 1 && !busy
  const canSendOptions = mode === 'options' && chosen.length >= 2 && !!windowOpen && !busy

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
        <Dialog className="panel-sheet hold-sheet" style={{ position: 'fixed', left: 0, right: 0, bottom: 0 }} aria-labelledby="hold-time-title">
          <span className="panel-sheet-handle" aria-hidden="true" />
          <div className="hold-sheet-head">
            <Heading slot="title" id="hold-time-title" className="panel-title">
              Definir hora{name ? ` de ${name}` : ''}
            </Heading>
            <Button className="panel-btn-ghost panel-btn-compact" onPress={onClose} isDisabled={busy}>
              Fechar
            </Button>
          </div>
          <p className="panel-subtitle hold-sheet-sub">
            {shortDay(hold.windowStartsAt, timezone)} · {periodChip(hold.windowStartsAt, hold.windowEndsAt, timezone)} ·{' '}
            {hold.serviceName} · {durationLabel(hold.durationMinutes)} · {hold.professionalName}
          </p>

          <div className="hold-options" role="group" aria-label="Como definir">
            <button
              type="button"
              className="hold-option"
              aria-pressed={mode === 'confirm'}
              onClick={() => {
                setMode('confirm')
                setPicked((p) => p.slice(0, 1))
                setEdited(false)
              }}
            >
              Confirmar uma hora
            </button>
            <button
              type="button"
              className="hold-option"
              aria-pressed={mode === 'options'}
              onClick={() => {
                setMode('options')
                setEdited(false)
              }}
            >
              Enviar opções
            </button>
          </div>

          <span className="hold-label">
            {mode === 'confirm' ? 'Horas livres neste bloco' : 'Escolha 2 ou 3 horas para a paciente'}
          </span>
          {slots == null ? <p className="panel-meta">Carregando horas livres…</p> : null}
          {slots != null && slots.length === 0 && !error ? (
            <p className="hold-warn">Nenhuma hora livre dentro do bloco. Fale com a paciente ou cancele o bloco.</p>
          ) : null}
          {slots && slots.length > 0 ? (
            <div className="hold-slots" role="group" aria-label="Horas livres">
              {slots.map((s) => (
                <button
                  key={`${s.startsAt}-${s.roomResourceId ?? ''}`}
                  type="button"
                  className="hold-option hold-slot"
                  aria-pressed={picked.includes(s.startsAt)}
                  onClick={() => toggle(s.startsAt)}
                >
                  {formatSlotTime(s.startsAt, timezone)}
                </button>
              ))}
            </div>
          ) : null}

          {message ? (
            <div className="hold-group">
              <span className="hold-label">Mensagem que a paciente vai receber</span>
              <textarea
                className="panel-textarea"
                aria-label="Mensagem que a paciente vai receber"
                rows={5}
                value={message}
                onChange={(e) => {
                  setMessage(e.target.value)
                  setEdited(true)
                }}
              />
            </div>
          ) : null}

          {windowOpen === false ? (
            <div className="hold-warn" role="status">
              Passaram 24 h desde a última mensagem da paciente: a mensagem não será enviada pelo app.{' '}
              {message ? (
                <button type="button" className="hold-link" onClick={() => void copy()}>
                  {copied ? 'Texto copiado' : 'Copiar texto'}
                </button>
              ) : null}
            </div>
          ) : null}

          {error ? (
            <div className="inbox-notice" role="alert">
              {error}
            </div>
          ) : null}

          {mode === 'confirm' ? (
            <Button className="panel-btn-primary" isDisabled={!canConfirm} onPress={() => void confirm()}>
              {busy ? 'Confirmando…' : windowOpen ? 'Confirmar e avisar paciente' : 'Confirmar horário'}
            </Button>
          ) : (
            <Button className="panel-btn-primary" isDisabled={!canSendOptions} onPress={() => void sendOptions()}>
              {busy ? 'Enviando…' : 'Enviar opções'}
            </Button>
          )}
          <p className="hold-foot">O bloco continua reservado até você confirmar uma hora.</p>
        </Dialog>
      </Modal>
    </ModalOverlay>
  )
}
