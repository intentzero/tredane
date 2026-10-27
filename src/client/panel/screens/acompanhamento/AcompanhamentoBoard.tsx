import { CircleAlert } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button, Tab, TabList, Tabs } from 'react-aria-components'
import type {
  OpportunityStage,
  PanelApi,
  PipelineOpportunity,
  PipelineStageCount,
} from '../../api'
import { PanelApiError } from '../../api'
import { navigatePanel } from '../../routes'
import { EmptyState, ErrorState } from '../../states/StatusScreens'
import { TestOnly } from '../../states/TestOnly'
import {
  STAGE_ORDER,
  STAGE_TAB_LABELS,
  appointmentLine,
  contactLabel,
  relativeTime,
} from './format'
import { MoveSheet } from './MoveSheet'
import { friendlyError } from '../../copy/errors'
import { ListSkeleton } from '../../states/ListSkeleton'

type Props = {
  tenantId: string
  api: PanelApi
  generation: number
}

export function AcompanhamentoBoard({ tenantId, api, generation }: Props) {
  const [stage, setStage] = useState<OpportunityStage>('em_atendimento')
  const [items, setItems] = useState<PipelineOpportunity[] | null>(null)
  const [counts, setCounts] = useState<PipelineStageCount[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [seeding, setSeeding] = useState(false)
  const [movingCard, setMovingCard] = useState<PipelineOpportunity | null>(null)
  const [moveBusy, setMoveBusy] = useState(false)
  const [moveError, setMoveError] = useState<string | null>(null)

  async function load(opts?: { keep?: boolean }) {
    if (!opts?.keep) setLoading(true)
    setError(null)
    try {
      const res = await api.listPipelineOpportunities(
        tenantId,
        { stage, limit: 100 },
        { generation, expectGeneration: () => generation },
      )
      setItems(res.opportunities)
      setCounts(res.counts)
    } catch (err) {
      setError(friendlyError(err, 'Não conseguimos carregar. Tente de novo.'))
      if (!opts?.keep) setItems(null)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [tenantId, generation, stage])

  async function seedDemo() {
    setSeeding(true)
    try {
      await api.seedPipelineDemo(tenantId, {
        generation,
        expectGeneration: () => generation,
      })
      await load()
    } catch (err) {
      setError(friendlyError(err, 'Não foi possível criar os exemplos.'))
    } finally {
      setSeeding(false)
    }
  }

  async function handleMove(toStage: OpportunityStage) {
    if (!movingCard || !items) return
    const card = movingCard
    setMoveBusy(true)
    setMoveError(null)
    // Optimistic: cartão some da lista atual («Movendo…»).
    const previous = items
    setItems(items.filter((o) => o.id !== card.id))
    try {
      await api.movePipelineStage(
        tenantId,
        card.id,
        { toStage, expectedUpdatedAt: card.updatedAt },
        { generation, expectGeneration: () => generation },
      )
      setMovingCard(null)
      await load({ keep: true })
    } catch (err) {
      // Falha preserva estado anterior visível (AC).
      setItems(previous)
      const msg =
        err instanceof PanelApiError && err.status === 409
          ? 'Outra sessão atualizou este contato. Estado anterior restaurado.'
          : friendlyError(err, 'Não foi possível mover. Tente de novo.')
      setMoveError(msg)
    } finally {
      setMoveBusy(false)
    }
  }

  if (loading && !items) {
    return <ListSkeleton label="Carregando acompanhamento…" />
  }

  if (error && !items) {
    return (
      <ErrorState
        title="Não foi possível carregar o Acompanhamento"
        description={error}
        actionLabel="Tentar de novo"
        onAction={() => void load()}
      />
    )
  }

  const list = items ?? []
  const countMap = new Map((counts ?? []).map((c) => [c.stage, c.count]))
  const totalOpen = (counts ?? [])
    .filter((c) => c.stage !== 'concluido' && c.stage !== 'perdido')
    .reduce((n, c) => n + c.count, 0)

  return (
    <div className="acomp-root">
      <header className="panel-header-root acomp-header">
        <span className="panel-subtitle">
          {totalOpen} contato{totalOpen === 1 ? '' : 's'} em andamento
        </span>
        <Tabs
          selectedKey={stage}
          onSelectionChange={(key) => {
            if (typeof key === 'string') setStage(key as OpportunityStage)
          }}
        >
          <TabList className="panel-tabs" aria-label="Etapas">
            {STAGE_ORDER.map((id) => (
              <Tab key={id} id={id} className="panel-chip">
                {STAGE_TAB_LABELS[id]}
                <span className="panel-chip-count">{countMap.get(id) ?? 0}</span>
              </Tab>
            ))}
          </TabList>
        </Tabs>
      </header>

      {moveError ? (
        <p className="acomp-banner-error" role="alert">
          {moveError}
        </p>
      ) : null}

      <div className="panel-scroll-sm acomp-list" role="tabpanel">
        {list.length === 0 ? (
          <>
            <EmptyState
              title="Ninguém nesta etapa agora"
              description="Os contatos aparecem aqui conforme o atendimento avança."
            />
            <TestOnly note="Cria contatos de exemplo nesta clínica de teste.">
              <Button
                className="panel-btn-secondary"
                isDisabled={seeding}
                onPress={() => void seedDemo()}
              >
                {seeding ? 'Criando…' : 'Criar contatos de exemplo'}
              </Button>
            </TestOnly>
          </>
        ) : (
          list.map((card) => {
            const name = contactLabel(card.contact.displayName, card.contact.waId)
            const meta = [
              card.assigneeDisplayName ?? 'Sem responsável',
              relativeTime(card.lastInteractionAt),
              appointmentLine(
                card.linkedAppointment?.startsAt,
                card.missingAppointment,
              ),
            ].join(' · ')
            return (
              <article
                key={card.id}
                className="panel-card-lg"
                aria-label={`${name}. ${meta}`}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <button
                    type="button"
                    className="panel-link acomp-card-name"
                    aria-label={`Abrir ${name}`}
                    onClick={() =>
                      navigatePanel({
                        kind: 'area',
                        area: 'acompanhamento',
                        tenantId,
                        section: 'detalhe',
                        opportunityId: card.id,
                      })
                    }
                  >
                    {name}
                  </button>
                  <Button
                    className="panel-move"
                    aria-label={`Mover ${name}`}
                    onPress={() => {
                      setMoveError(null)
                      setMovingCard(card)
                    }}
                  >
                    Mover
                  </Button>
                </div>
                <span className="panel-meta">{meta}</span>
                {card.missingAppointment ? (
                  <span className="acomp-warn">
                    <CircleAlert aria-hidden size={14} strokeWidth={2.4} />
                    Sem compromisso vinculado
                  </span>
                ) : null}
              </article>
            )
          })
        )}
      </div>

      <MoveSheet
        open={movingCard !== null}
        contactName={
          movingCard
            ? contactLabel(movingCard.contact.displayName, movingCard.contact.waId)
            : 'contato'
        }
        currentStage={movingCard?.stage ?? stage}
        busy={moveBusy}
        onClose={() => {
          if (!moveBusy) setMovingCard(null)
        }}
        onMove={(to) => void handleMove(to)}
      />
    </div>
  )
}
