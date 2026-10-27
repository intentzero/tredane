import { ChevronLeft, CircleAlert } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button } from 'react-aria-components'
import type { PanelApi, PipelineOpportunityDetail } from '../../api'
import { navigatePanel } from '../../routes'
import { ErrorState, LoadingState } from '../../states/StatusScreens'
import {
  STAGE_LABELS,
  appointmentLine,
  contactLabel,
  relativeTime,
} from './format'
import { MoveSheet } from './MoveSheet'
import type { OpportunityStage } from '../../api'
import { friendlyError } from '../../copy/errors'

type Props = {
  tenantId: string
  opportunityId: string
  api: PanelApi
  generation: number
}

/**
 * Detalhe do contato em andamento — vínculos a conversa, contato e agenda (DEC-040).
 */
export function AcompanhamentoDetail({
  tenantId,
  opportunityId,
  api,
  generation,
}: Props) {
  const [data, setData] = useState<PipelineOpportunityDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [moveOpen, setMoveOpen] = useState(false)
  const [moveBusy, setMoveBusy] = useState(false)
  const [moveError, setMoveError] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const res = await api.getPipelineOpportunity(tenantId, opportunityId, {
        generation,
        expectGeneration: () => generation,
      })
      setData(res.opportunity)
    } catch (err) {
      setError(friendlyError(err, 'Não deu para concluir agora. Tente de novo.'))
      setData(null)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [tenantId, opportunityId, generation])

  async function handleMove(toStage: OpportunityStage) {
    if (!data) return
    setMoveBusy(true)
    setMoveError(null)
    const previous = data
    try {
      const res = await api.movePipelineStage(
        tenantId,
        opportunityId,
        { toStage, expectedUpdatedAt: data.updatedAt },
        { generation, expectGeneration: () => generation },
      )
      setData(res.opportunity)
      setMoveOpen(false)
    } catch (err) {
      setData(previous)
      setMoveError(
        friendlyError(err, 'Não foi possível mover. O contato continua na etapa anterior.'),
      )
    } finally {
      setMoveBusy(false)
    }
  }

  if (loading && !data) return <LoadingState label="Abrindo contato em andamento…" />
  if (error && !data) {
    return (
      <ErrorState
        title="Contato em andamento indisponível"
        description={error}
        actionLabel="Voltar"
        onAction={() =>
          navigatePanel({
            kind: 'area',
            area: 'acompanhamento',
            tenantId,
            section: 'quadro',
          })
        }
      />
    )
  }
  if (!data) return null

  const name = contactLabel(data.contact.displayName, data.contact.waId)

  return (
    <div className="acomp-detail">
      <header className="inbox-thread-header">
        <Button
          className="panel-icon-btn"
          aria-label="Voltar ao Acompanhamento"
          onPress={() =>
            navigatePanel({
              kind: 'area',
              area: 'acompanhamento',
              tenantId,
              section: 'quadro',
            })
          }
        >
          <ChevronLeft aria-hidden size={22} strokeWidth={2} />
        </Button>
        <div className="inbox-thread-title">
          <span className="inbox-thread-name">{name}</span>
          <span className="inbox-thread-sub">Contato em andamento</span>
        </div>
        <Button className="panel-move" onPress={() => setMoveOpen(true)}>
          Mover
        </Button>
      </header>

      {moveError ? (
        <p className="acomp-banner-error" role="alert">
          {moveError}
        </p>
      ) : null}

      <dl className="inbox-contact-dl">
        <div>
          <dt>Etapa</dt>
          <dd>{STAGE_LABELS[data.stage]}</dd>
        </div>
        <div>
          <dt>Responsável</dt>
          <dd>{data.assigneeDisplayName ?? 'Sem responsável'}</dd>
        </div>
        <div>
          <dt>Última interação</dt>
          <dd>{relativeTime(data.lastInteractionAt)}</dd>
        </div>
        <div>
          <dt>Próximo compromisso</dt>
          <dd>
            {appointmentLine(
              data.linkedAppointment?.startsAt,
              data.missingAppointment,
            )}
          </dd>
        </div>
        <div>
          <dt>Ciclo</dt>
          <dd>{data.cycleNumber}</dd>
        </div>
      </dl>

      {data.missingAppointment ? (
        <div className="acomp-alert">
          <CircleAlert aria-hidden size={18} strokeWidth={2.4} />
          <div>
            <strong>Sem compromisso vinculado</strong>
            <p>Pode agendar um horário sem alterar a etapa automaticamente.</p>
            <Button
              className="panel-btn-primary"
              onPress={() =>
                navigatePanel({
                  kind: 'area',
                  area: 'agenda',
                  tenantId,
                  section: 'agendar',
                  conversationId: data.conversationId,
                  contactId: data.contactId,
                  opportunityId: data.id,
                })
              }
            >
              Agendar horário
            </Button>
          </div>
        </div>
      ) : data.linkedAppointment ? (
        <div className="acomp-alert acomp-alert-ok">
          <div>
            <strong>Compromisso vinculado</strong>
            <p>
              {new Date(data.linkedAppointment.startsAt).toLocaleString('pt-BR', {
                dateStyle: 'full',
                timeStyle: 'short',
              })}
            </p>
            <Button
              className="panel-btn-secondary"
              onPress={() =>
                navigatePanel({
                  kind: 'area',
                  area: 'agenda',
                  tenantId,
                  section: 'dia',
                })
              }
            >
              Ver na agenda
            </Button>
          </div>
        </div>
      ) : null}

      <div className="acomp-links">
        <Button
          className="panel-btn-secondary"
          onPress={() =>
            navigatePanel({
              kind: 'area',
              area: 'conversas',
              tenantId,
              section: 'thread',
              conversationId: data.conversationId,
            })
          }
        >
          Abrir conversa
        </Button>
        <Button
          className="panel-btn-secondary"
          onPress={() =>
            navigatePanel({
              kind: 'area',
              area: 'conversas',
              tenantId,
              section: 'contato',
              conversationId: data.conversationId,
              contactId: data.contactId,
            })
          }
        >
          Ver contato
        </Button>
      </div>

      <h2 className="inbox-contact-h">Histórico de etapas</h2>
      <ol className="acomp-history">
        {data.history.map((h) => (
          <li key={h.id}>
            <span className="acomp-history-stage">
              {h.fromStage ? STAGE_LABELS[h.fromStage] : '—'} → {STAGE_LABELS[h.toStage]}
            </span>
            <span className="acomp-history-meta">
              {h.actorDisplayName ?? 'Sistema'} · {relativeTime(h.createdAt)}
              {h.note ? ` · ${h.note}` : ''}
            </span>
          </li>
        ))}
      </ol>

      <MoveSheet
        open={moveOpen}
        contactName={name}
        currentStage={data.stage}
        busy={moveBusy}
        onClose={() => {
          if (!moveBusy) setMoveOpen(false)
        }}
        onMove={(to) => void handleMove(to)}
      />
    </div>
  )
}
