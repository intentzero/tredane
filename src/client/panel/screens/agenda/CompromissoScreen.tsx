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
 * Comunicação WhatsApp: atalho para a conversa (envio humano #33; falha ≠ agenda).
 */
export function CompromissoScreen({
  tenantId,
  appointmentId,
  api,
  generation,
}: Props) {
  const [detail, setDetail] = useState<AppointmentDetailResponse | null>(null)
  const [reasons, setReasons] = useState<AppointmentReasonOption[]>([])
  const [reason, setReason] = useState<string>('')
  const [mode, setMode] = useState<'view' | 'cancel' | 'reschedule'>('view')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      const [d, r] = await Promise.all([
        api.getAppointment(tenantId, appointmentId, {
          generation,
          expectGeneration: () => generation,
        }),
        api.listAppointmentReasons(tenantId, {
          generation,
          expectGeneration: () => generation,
        }),
      ])
      setDetail(d)
      setReasons(r)
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

  async function handleCancel() {
    if (!reason || !detail) return
    setBusy(true)
    setMessage(null)
    try {
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
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Falha ao cancelar')
      await load()
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

        <dl className="agenda-detail-dl">
          <div>
            <dt>Serviço</dt>
            <dd>{detail.serviceName}</dd>
          </div>
          <div>
            <dt>Quando</dt>
            <dd>
              {formatSlotTime(detail.startsAt, timezone)} –{' '}
              {formatSlotTime(detail.endsAt, timezone)}
            </dd>
          </div>
          <div>
            <dt>Profissional</dt>
            <dd>{detail.professionalName}</dd>
          </div>
          {detail.roomResourceName ? (
            <div>
              <dt>Sala</dt>
              <dd>{detail.roomResourceName}</dd>
            </div>
          ) : null}
          {detail.contactLabel || detail.contactId ? (
            <div>
              <dt>Contacto</dt>
              <dd>{detail.contactLabel ?? detail.contactId}</dd>
            </div>
          ) : null}
          {detail.changeReason ? (
            <div>
              <dt>Motivo</dt>
              <dd>{detail.changeReason}</dd>
            </div>
          ) : null}
        </dl>

        {detail.conversationId ? (
          <div className="clinic-actions" style={{ padding: '0 16px 12px' }}>
            <Button
              className="panel-btn-secondary"
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
              Abrir conversa (enviar mensagem)
            </Button>
          </div>
        ) : (
          <p className="panel-meta" style={{ padding: '0 16px' }}>
            Sem conversa vinculada — confirme a mensagem na caixa de entrada após
            ligar o contacto (REQ-033: falha de envio não altera a reserva).
          </p>
        )}

        {canChange && mode === 'view' ? (
          <div className="clinic-actions" style={{ padding: '12px 16px' }}>
            <Button
              className="panel-btn-secondary"
              onPress={() => {
                setMode('cancel')
                setReason('')
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
                <SelectValue>{reason ? reasons.find((r) => r.code === reason)?.label : 'Escolha um motivo'}</SelectValue>
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
                isDisabled={!reason || busy}
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
