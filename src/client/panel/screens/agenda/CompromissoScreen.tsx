import { ChevronLeft } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import {
  Button,
  Label,
  ListBox,
  ListBoxItem,
  Popover,
  Select,
  SelectValue,
} from 'react-aria-components'
import {
  PanelApiError,
  type AppointmentDetailResponse,
  type AppointmentReasonOption,
  type PanelApi,
  type PixChargeDetail,
} from '../../api'
import { navigatePanel } from '../../routes'
import { ErrorState, LoadingState } from '../../states/StatusScreens'
import { formatSlotTime } from './format'

type Props = {
  tenantId: string
  appointmentId: string
  api: PanelApi
  generation: number
}

/**
 * TEL-06 — detalhe, cancelar e reagendar com motivo (#36 / REQ-032/033).
 * Com sinal pago: Devolver/Reter + política (#40 / REQ-082 / AC-50).
 */
export function CompromissoScreen({
  tenantId,
  appointmentId,
  api,
  generation,
}: Props) {
  const [detail, setDetail] = useState<AppointmentDetailResponse | null>(null)
  const [reasons, setReasons] = useState<AppointmentReasonOption[]>([])
  const [paidSignal, setPaidSignal] = useState<PixChargeDetail | null>(null)
  const [reason, setReason] = useState<string>('')
  const [disposition, setDisposition] = useState<'refund' | 'retain' | ''>('')
  const [mode, setMode] = useState<'view' | 'cancel' | 'reschedule'>('view')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      const [d, r, signal] = await Promise.all([
        api.getAppointment(tenantId, appointmentId, {
          generation,
          expectGeneration: () => generation,
        }),
        api.listAppointmentReasons(tenantId, {
          generation,
          expectGeneration: () => generation,
        }),
        api.getAppointmentPaidSignal(tenantId, appointmentId, {
          generation,
          expectGeneration: () => generation,
        }),
      ])
      setDetail(d)
      setReasons(r)
      setPaidSignal(signal)
    } catch (err) {
      if (err instanceof PanelApiError && err.message === 'stale_tenant_response') return
      setError(err instanceof Error ? err.message : 'Falha ao carregar')
    }
  }, [api, tenantId, appointmentId, generation])

  useEffect(() => {
    void load()
  }, [load])

  if (!detail && !error) return <LoadingState label="A carregar compromisso…" />
  if (error && !detail) {
    return (
      <ErrorState
        title="Compromisso indisponível"
        description={error}
        actionLabel="Voltar"
        onAction={() =>
          navigatePanel({ kind: 'area', area: 'agenda', tenantId, section: 'dia' })
        }
      />
    )
  }
  if (!detail) return null

  const timezone = 'America/Sao_Paulo'
  const canChange = detail.status === 'confirmed'
  const needsDisposition =
    paidSignal != null &&
    (paidSignal.status === 'paid' ||
      paidSignal.status === 'refund_failed' ||
      paidSignal.status === 'refund_requested')

  async function handleCancel() {
    if (!reason || !detail) return
    if (needsDisposition && !disposition) return
    setBusy(true)
    setMessage(null)
    try {
      if (needsDisposition && disposition) {
        const result = await api.cancelAppointmentWithSignal(
          tenantId,
          appointmentId,
          {
            clientRequestId: crypto.randomUUID(),
            reason,
            signalDisposition: disposition,
            expectedVersion: detail.version,
          },
          { generation, expectGeneration: () => generation },
        )
        setDetail(result.appointment)
        setPaidSignal(result.charge)
        setMode('view')
        if (disposition === 'retain') {
          setMessage('Compromisso cancelado. Sinal retido (decisão registada).')
        } else if (result.refundConfirmed) {
          setMessage('Compromisso cancelado. Sinal devolvido.')
        } else if (result.uncertain) {
          setMessage(
            'Compromisso cancelado. Estorno solicitado — ainda não confirmado como devolvido.',
          )
        } else {
          setMessage(
            'Compromisso cancelado. Estorno em curso (reserva já libertada).',
          )
        }
      } else {
        const updated = await api.cancelAppointment(
          tenantId,
          appointmentId,
          {
            clientRequestId: crypto.randomUUID(),
            reason,
            expectedVersion: detail.version,
          },
          { generation, expectGeneration: () => generation },
        )
        setDetail(updated)
        setMode('view')
        setMessage('Compromisso cancelado. Recursos libertados.')
      }
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Falha ao cancelar')
      await load()
    } finally {
      setBusy(false)
    }
  }

  async function retryRefund() {
    if (!paidSignal) return
    setBusy(true)
    setMessage(null)
    try {
      const result = await api.requestPixRefund(
        tenantId,
        paidSignal.id,
        { clientRequestId: crypto.randomUUID() },
        { generation, expectGeneration: () => generation },
      )
      setPaidSignal(result.charge)
      if (result.refundConfirmed) {
        setMessage('Sinal devolvido.')
      } else if (result.uncertain) {
        setMessage(
          'Estado incerto no provedor — consulte antes de repetir. Ainda não está devolvido.',
        )
      } else {
        setMessage(
          result.charge.status === 'refund_failed'
            ? 'Estorno falhou de novo.'
            : 'Estorno solicitado.',
        )
      }
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Falha no estorno')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="agenda-detail" data-screen="m05-compromisso">
      <header className="panel-header">
        <Button
          className="panel-icon-btn"
          aria-label="Voltar à agenda"
          onPress={() =>
            navigatePanel({ kind: 'area', area: 'agenda', tenantId, section: 'dia' })
          }
        >
          <ChevronLeft aria-hidden size={22} strokeWidth={2} />
        </Button>
        <div>
          <h1 className="panel-title">Compromisso</h1>
          <span className="panel-subtitle">
            {detail.status === 'confirmed' ? 'Confirmado' : 'Cancelado'}
          </span>
        </div>
      </header>

      <div className="panel-scroll">
        {message ? (
          <p className="panel-banner" role="status">
            {message}
          </p>
        ) : null}

        <p className="panel-meta" style={{ padding: '12px 16px' }}>
          {detail.serviceName} · {detail.professionalName}
          {detail.roomResourceName ? ` · ${detail.roomResourceName}` : ''}
          <br />
          {formatSlotTime(detail.startsAt, timezone)}
          {detail.contactLabel ? ` · ${detail.contactLabel}` : ''}
        </p>

        {paidSignal ? (
          <div className="inbox-notice" role="status" style={{ margin: '0 16px' }}>
            <strong>Sinal Pix</strong>
            <p>
              {(paidSignal.amountCents / 100).toLocaleString('pt-BR', {
                style: 'currency',
                currency: 'BRL',
              })}
              {' · '}
              {paidSignal.status === 'refunded'
                ? 'Devolvido'
                : paidSignal.status === 'refund_requested'
                  ? 'Estorno solicitado'
                  : paidSignal.status === 'refund_failed'
                    ? 'Estorno falhou'
                    : paidSignal.signalDisposition === 'retain'
                      ? 'Retido'
                      : 'Pago'}
            </p>
            {paidSignal.cancellationPolicySnapshot ? (
              <p className="panel-field-hint">
                Política: {paidSignal.cancellationPolicySnapshot}
              </p>
            ) : null}
            {paidSignal.status === 'refund_failed' ? (
              <Button
                className="panel-btn-secondary"
                onPress={() => void retryRefund()}
                isDisabled={busy}
              >
                Tentar devolver de novo
              </Button>
            ) : null}
          </div>
        ) : null}

        {canChange && mode === 'view' ? (
          <div className="clinic-actions" style={{ padding: '12px 16px' }}>
            <Button
              className="panel-btn-secondary"
              onPress={() => {
                setMode('cancel')
                setReason('')
                setDisposition('')
              }}
            >
              Cancelar
            </Button>
            <Button
              className="panel-btn-primary"
              onPress={() =>
                navigatePanel({
                  kind: 'area',
                  area: 'agenda',
                  tenantId,
                  section: 'agendar',
                })
              }
            >
              Reagendar
            </Button>
          </div>
        ) : null}

        {mode === 'cancel' ? (
          <div className="agenda-reason" style={{ padding: '0 16px 24px' }}>
            <Select
              className="panel-field"
              selectedKey={reason || null}
              onSelectionChange={(key) => {
                if (typeof key === 'string') setReason(key)
              }}
            >
              <Label>Motivo (obrigatório)</Label>
              <Button className="panel-select-trigger">
                <SelectValue>
                  {reason
                    ? reasons.find((r) => r.code === reason)?.label
                    : 'Escolha um motivo'}
                </SelectValue>
              </Button>
              <Popover className="panel-popover">
                <ListBox className="panel-listbox">
                  {reasons.map((r) => (
                    <ListBoxItem
                      key={r.code}
                      id={r.code}
                      className="panel-select-item"
                      textValue={r.label}
                    >
                      {r.label}
                    </ListBoxItem>
                  ))}
                </ListBox>
              </Popover>
            </Select>

            {needsDisposition ? (
              <>
                {paidSignal?.cancellationPolicySnapshot ? (
                  <p className="panel-field-hint" role="note">
                    Política da clínica: {paidSignal.cancellationPolicySnapshot}
                  </p>
                ) : (
                  <p className="panel-field-hint" role="note">
                    Política de cancelamento da clínica (mostrada à cliente antes
                    de pagar).
                  </p>
                )}
                <Select
                  className="panel-field"
                  selectedKey={disposition || null}
                  onSelectionChange={(key) => {
                    if (key === 'refund' || key === 'retain') setDisposition(key)
                  }}
                >
                  <Label>Sinal pago (obrigatório)</Label>
                  <Button className="panel-select-trigger">
                    <SelectValue>
                      {disposition === 'refund'
                        ? 'Devolver sinal'
                        : disposition === 'retain'
                          ? 'Reter sinal'
                          : 'Escolha Devolver ou Reter'}
                    </SelectValue>
                  </Button>
                  <Popover className="panel-popover">
                    <ListBox className="panel-listbox">
                      <ListBoxItem
                        id="refund"
                        className="panel-select-item"
                        textValue="Devolver sinal"
                      >
                        Devolver sinal
                      </ListBoxItem>
                      <ListBoxItem
                        id="retain"
                        className="panel-select-item"
                        textValue="Reter sinal"
                      >
                        Reter sinal
                      </ListBoxItem>
                    </ListBox>
                  </Popover>
                </Select>
              </>
            ) : null}

            <div className="clinic-actions">
              <Button
                className="panel-btn-secondary"
                onPress={() => setMode('view')}
                isDisabled={busy}
              >
                Voltar
              </Button>
              <Button
                className="panel-btn-primary"
                isDisabled={
                  !reason || busy || (needsDisposition && !disposition)
                }
                onPress={() => void handleCancel()}
              >
                {busy ? 'A cancelar…' : 'Confirmar cancelamento'}
              </Button>
            </div>
          </div>
        ) : null}

        <h2 className="panel-legend" style={{ padding: '0 16px' }}>
          Histórico
        </h2>
        <ul className="acomp-history">
          {detail.events.map((e) => (
            <li key={e.id}>
              <span className="acomp-history-stage">{e.operation}</span>
              <span className="acomp-history-meta">
                {e.reason ? `${e.reason} · ` : ''}
                {new Date(e.occurredAt).toLocaleString('pt-BR')}
                {e.actorId ? ` · ${e.actorId}` : ''}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
