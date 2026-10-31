import { ChevronLeft, X } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { PanelSelect } from '../../ui/PanelSelect'
import {
  Button,
} from 'react-aria-components'
import {
  PanelApiError,
  type AppointmentDetailResponse,
  type AppointmentReasonOption,
  type PanelApi,
  type PixChargeDetail,
} from '../../api'
import { useClinicTimezone } from '../../clinicTimezone'
import { navigatePanel } from '../../routes'
import { ErrorState, LoadingState } from '../../states/StatusScreens'
import { civilDateInZone, formatSlotTime } from './format'
import { friendlyError } from '../../copy/errors'

type Props = {
  tenantId: string
  appointmentId: string
  api: PanelApi
  generation: number
  /** Responsável: vê «Permitir os dois» (DEC-075 / S5). */
  isOwner?: boolean
  /** No desktop o compromisso abre num painel por cima da grade (DEC-069): fecha em vez de voltar. */
  onClose?: () => void
  /** Cancelamento ou devolução concluídos: a grade refaz a leitura. */
  onChanged?: () => void
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
  isOwner = false,
  onClose,
  onChanged,
}: Props) {
  const timezone = useClinicTimezone(api, tenantId, generation)
  const [detail, setDetail] = useState<AppointmentDetailResponse | null>(null)
  const [reasons, setReasons] = useState<AppointmentReasonOption[]>([])
  const [paidSignal, setPaidSignal] = useState<PixChargeDetail | null>(null)
  const [reason, setReason] = useState<string>('')
  const [disposition, setDisposition] = useState<'refund' | 'retain' | ''>('')
  const [mode, setMode] = useState<'view' | 'cancel' | 'reschedule' | 'allow-both'>('view')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [roomSameSex, setRoomSameSex] = useState(false)

  const load = useCallback(async () => {
    setError(null)
    try {
      const [d, r, signal, snap] = await Promise.all([
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
        isOwner
          ? api.getClinicConfig(tenantId, {
              generation,
              expectGeneration: () => generation,
            })
          : Promise.resolve(null),
      ])
      setDetail(d)
      setReasons(r)
      setPaidSignal(signal)
      if (snap && d.roomResourceId) {
        const room = snap.resources.find((x) => x.id === d.roomResourceId)
        setRoomSameSex(Boolean(room?.sameSexInSlot && (room.capacity ?? 1) > 1))
      } else {
        setRoomSameSex(false)
      }
    } catch (err) {
      if (err instanceof PanelApiError && err.message === 'stale_tenant_response') return
      setError(friendlyError(err, 'Não conseguimos carregar. Tente de novo.'))
    }
  }, [api, tenantId, appointmentId, generation, isOwner])

  useEffect(() => {
    void load()
  }, [load])

  if (!detail && !error) return <LoadingState label="Carregando compromisso…" />
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
        onChanged?.()
        const aviso =
          result.cancelNotice === 'sent'
            ? ' A cliente foi avisada no WhatsApp.'
            : result.cancelNotice === 'window_closed'
              ? ' A janela de 24 h está fechada: o aviso não foi enviado.'
              : result.cancelNotice === 'failed'
                ? ' O aviso no WhatsApp não saiu.'
                : ''
        if (disposition === 'retain') {
          setMessage(`Compromisso cancelado. Sinal retido (decisão registrada).${aviso}`)
        } else if (result.refundConfirmed) {
          setMessage(`Compromisso cancelado. Sinal devolvido.${aviso}`)
        } else if (result.uncertain) {
          setMessage(
            `Compromisso cancelado. Pedido de devolução do sinal enviado; o dinheiro ainda não voltou para a cliente.${aviso}`,
          )
        } else {
          setMessage(
            `Compromisso cancelado. Devolução do sinal em andamento. O horário já ficou livre.${aviso}`,
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
        onChanged?.()
        setMessage(
          updated.cancelNotice === 'sent'
            ? 'Compromisso cancelado. A cliente foi avisada no WhatsApp.'
            : updated.cancelNotice === 'window_closed'
              ? 'Compromisso cancelado. A janela de 24 h está fechada: o aviso não foi enviado.'
              : updated.cancelNotice === 'failed'
                ? 'Compromisso cancelado. O aviso no WhatsApp não saiu.'
                : 'Compromisso cancelado. Recursos liberados.',
        )
      }
    } catch (err) {
      setMessage(friendlyError(err, 'Não foi possível cancelar o compromisso.'))
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
            ? 'A devolução não deu certo de novo.'
            : 'Pedido de devolução enviado.',
        )
      }
    } catch (err) {
      setMessage(friendlyError(err, 'Não foi possível devolver o sinal.'))
    } finally {
      setBusy(false)
    }
  }

  async function allowBoth() {
    if (!detail?.roomResourceId) return
    setBusy(true)
    setMessage(null)
    try {
      await api.allowBothSexesInBlock(
        tenantId,
        detail.roomResourceId,
        { startsAt: detail.startsAt, endsAt: detail.endsAt },
        { generation, expectGeneration: () => generation },
      )
      setMode('view')
      onChanged?.()
      setMessage('Neste horário a sala aceita os dois públicos.')
    } catch (err) {
      setMessage(friendlyError(err, 'Não foi possível permitir os dois neste horário.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="agenda-detail" data-screen="m05-compromisso">
      <header className="panel-header">
        {onClose ? null : (
          <Button
            className="panel-icon-btn"
            aria-label="Voltar à agenda"
            onPress={() =>
              navigatePanel({ kind: 'area', area: 'agenda', tenantId, section: 'dia' })
            }
          >
            <ChevronLeft aria-hidden size={22} strokeWidth={2} />
          </Button>
        )}
        <div style={onClose ? { flex: 1 } : undefined}>
          {onClose ? (
            <h2 className="panel-title">Compromisso</h2>
          ) : (
            <h1 className="panel-title">Compromisso</h1>
          )}
          <span className="panel-subtitle">
            {detail.status === 'confirmed' ? 'Confirmado' : 'Cancelado'}
          </span>
        </div>
        {onClose ? (
          <Button className="panel-icon-btn" aria-label="Fechar compromisso" onPress={onClose}>
            <X aria-hidden size={20} strokeWidth={2} />
          </Button>
        ) : null}
      </header>

      <div className="panel-scroll">
        {message ? (
          <p className="panel-alert" role="status">
            {message}
          </p>
        ) : null}

        <p className="panel-meta" style={{ padding: '12px 16px' }}>
          {detail.serviceName} · {detail.professionalName}
          {detail.roomResourceName ? ` · ${detail.roomResourceName}` : ''}
          {detail.appliedDurationMinutes != null &&
          detail.defaultDurationMinutes != null &&
          detail.appliedDurationMinutes !== detail.defaultDurationMinutes
            ? ` · duração ajustada: ${detail.appliedDurationMinutes} min (padrão ${detail.defaultDurationMinutes} min)`
            : ''}
          {detail.confirmedBy === 'system:ai-autobook' ? ' · Marcado pela IA' : ''}
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
                  ? 'Devolução pedida'
                  : paidSignal.status === 'refund_failed'
                    ? 'A devolução não deu certo'
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

        {mode === 'view' && detail.conversationId ? (
          <div style={{ padding: '12px 16px 0' }}>
            <Button
              className="panel-btn-primary agenda-open-chat"
              onPress={() =>
                navigatePanel({
                  kind: 'area',
                  area: 'conversas',
                  tenantId,
                  section: 'thread',
                  conversationId: detail.conversationId!,
                })
              }
            >
              Abrir conversa
            </Button>
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
                  rescheduleAppointmentId: detail.id,
                  conversationId: detail.conversationId ?? undefined,
                  contactId: detail.contactId ?? undefined,
                  opportunityId: detail.opportunityId ?? undefined,
                  date: civilDateInZone(detail.startsAt, timezone),
                })
              }
            >
              Reagendar
            </Button>
            {isOwner && roomSameSex && detail.roomResourceId ? (
              <Button
                className="panel-btn-secondary"
                onPress={() => setMode('allow-both')}
              >
                Permitir os dois
              </Button>
            ) : null}
          </div>
        ) : null}

        {mode === 'allow-both' && detail.roomResourceId ? (
          <div className="agenda-reason" style={{ padding: '0 16px 24px' }}>
            <p className="panel-field-hint" role="note">
              Neste horário a sala passa a aceitar público feminino e masculino, só enquanto houver
              sobreposição. Depois de a sala ficar livre, o bloco seguinte volta à regra «mesmo sexo».
            </p>
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
                isDisabled={busy}
                onPress={() => void allowBoth()}
              >
                {busy ? 'A confirmar…' : 'Confirmar permitir os dois'}
              </Button>
            </div>
          </div>
        ) : null}

        {mode === 'cancel' ? (
          <div className="agenda-reason" style={{ padding: '0 16px 24px' }}>
            <PanelSelect
              label="Motivo (obrigatório)"
              placeholder="Escolha um motivo"
              value={reason || null}
              onChange={(id) => setReason(id)}
              options={reasons.map((r) => ({ id: r.code, label: r.label }))}
            />

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
                <PanelSelect
                  label="Sinal pago (obrigatório)"
                  placeholder="Escolha Devolver ou Reter"
                  value={disposition || null}
                  onChange={(id) => {
                    if (id === 'refund' || id === 'retain') setDisposition(id)
                  }}
                  options={[
                    { id: 'refund', label: 'Devolver sinal' },
                    { id: 'retain', label: 'Reter sinal' },
                  ]}
                />
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
