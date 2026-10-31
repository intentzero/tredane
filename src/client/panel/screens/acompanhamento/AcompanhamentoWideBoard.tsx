import { CircleAlert, Search } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Button, Input, SearchField } from 'react-aria-components'
import type { OpportunityStage, PanelApi, PipelineOpportunity } from '../../api'
import { useClinicTimezone } from '../../clinicTimezone'
import { friendlyError } from '../../copy/errors'
import { navigatePanel } from '../../routes'
import { useOutsideClose } from '../../ui/useOutsideClose'
import { ErrorState } from '../../states/StatusScreens'
import { ListSkeleton } from '../../states/ListSkeleton'
import { useInboxRealtime } from '../../realtime/InboxRealtime'
import { AcompanhamentoDetail } from './AcompanhamentoDetail'
import {
  STAGE_LABELS,
  appointmentLine,
  contactLabel,
  relativeTime,
} from './format'

/** Etapas com coluna própria; «Perdido» só aparece quando a pessoa pede. */
const MAIN_STAGES: OpportunityStage[] = [
  'novo_contato',
  'em_atendimento',
  'horario_proposto',
  'agendado',
  'concluido',
]

type Filter = 'all' | 'mine' | 'unassigned' | 'stalled'

const FILTER_LABEL: Record<Filter, string> = {
  all: 'Todos',
  mine: 'Minhas',
  unassigned: 'Sem responsável',
  stalled: 'Parados há mais de 2 dias',
}

const DAY = 86_400_000
const STALL_STAGES: OpportunityStage[] = ['novo_contato', 'em_atendimento', 'horario_proposto']

type Props = {
  tenantId: string
  api: PanelApi
  generation: number
  /** Contato aberto no painel (rota `…/acompanhamento/:id`). */
  openId?: string
}

/**
 * Acompanhar no desktop largo (≥ 1280 px): quadro com uma coluna por etapa em largura total,
 * barra de busca e filtros por cima e contato num painel que desliza da direita. Os cartões
 * não se arrastam: a etapa muda pela conversa (DEC-062).
 */
export function AcompanhamentoWideBoard({ tenantId, api, generation, openId }: Props) {
  useClinicTimezone(api, tenantId, generation)
  const [byStage, setByStage] = useState<Partial<Record<OpportunityStage, PipelineOpportunity[]>> | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [viewerId, setViewerId] = useState<string | null>(null)
  const [filter, setFilter] = useState<Filter>('all')
  const [q, setQ] = useState('')
  const [showLost, setShowLost] = useState(false)
  const [professionals, setProfessionals] = useState<Array<{ id: string; name: string }>>([])
  const [profFilter, setProfFilter] = useState<string[]>([])
  const returnFocus = useRef<HTMLElement | null>(null)
  const panelRef = useRef<HTMLElement | null>(null)
  useOutsideClose(panelRef, () => closePanel(), openId != null)

  const stages = useMemo<OpportunityStage[]>(
    () => (showLost ? [...MAIN_STAGES, 'perdido'] : MAIN_STAGES),
    [showLost],
  )

  async function load() {
    setError(null)
    try {
      const results = await Promise.all(
        stages.map((stage) =>
          api.listPipelineOpportunities(
            tenantId,
            // Concluído e Perdido são etapas finais (oportunidade «closed»): sem isto vêm sempre vazias.
            { stage, limit: 100, includeClosed: stage === 'concluido' || stage === 'perdido' },
            { generation, expectGeneration: () => generation },
          ),
        ),
      )
      const next: Partial<Record<OpportunityStage, PipelineOpportunity[]>> = {}
      stages.forEach((stage, i) => {
        next[stage] = results[i]?.opportunities ?? []
      })
      setByStage(next)
    } catch (err) {
      setError(friendlyError(err, 'Não conseguimos carregar. Tente de novo.'))
    }
  }

  useEffect(() => {
    void load()
  }, [tenantId, generation, stages])

  useInboxRealtime((signals) => {
    const touch = signals.some(
      (s) =>
        s.kind === 'resync' ||
        (s.kind === 'event' &&
          (s.event.eventType === 'contact.deleted' ||
            s.event.eventType === 'opportunity.stage_changed')),
    )
    if (touch) void load()
  })

  useEffect(() => {
    let cancelled = false
    void api.getMe({ generation, expectGeneration: () => generation }).then(
      (me) => {
        if (!cancelled) setViewerId(me.clerkUserId)
      },
      () => undefined,
    )
    return () => {
      cancelled = true
    }
  }, [api, generation])

  // Profissionais ativas da clínica para o filtro (pelo compromisso ligado ao cartão).
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const snap = await api.getClinicConfig(tenantId, { generation, expectGeneration: () => generation })
        if (cancelled) return
        setProfessionals(
          snap.resources
            .filter((r) => r.kind === 'professional' && r.active)
            .map((r) => ({ id: r.id, name: r.name })),
        )
      } catch {
        /* sem cadastro legível: o quadro segue sem o filtro por profissional */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [api, tenantId, generation])

  // Esc fecha o painel.
  useEffect(() => {
    if (!openId) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closePanel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [openId])

  // Foco no painel ao abrir.
  useEffect(() => {
    if (openId) panelRef.current?.focus({ preventScroll: true })
  }, [openId])

  function openCard(card: PipelineOpportunity, el: HTMLElement | null) {
    if (openId === card.id) {
      closePanel()
      return
    }
    if (!openId) returnFocus.current = el
    navigatePanel({
      kind: 'area',
      area: 'acompanhamento',
      tenantId,
      section: 'detalhe',
      opportunityId: card.id,
    })
  }

  function closePanel() {
    navigatePanel({ kind: 'area', area: 'acompanhamento', tenantId, section: 'quadro' })
    returnFocus.current?.focus?.({ preventScroll: true })
  }

  const now = Date.now()
  const needle = q.trim().toLowerCase()

  function visible(card: PipelineOpportunity): boolean {
    if (needle) {
      const name = contactLabel(card.contact.displayName, card.contact.waId).toLowerCase()
      if (!name.includes(needle) && !card.contact.waId.includes(needle)) return false
    }
    if (profFilter.length > 0) {
      // Só cartões com compromisso ligado têm profissional (#254).
      if (!card.linkedAppointment || !profFilter.includes(card.linkedAppointment.professionalId)) return false
    }
    if (filter === 'mine') return viewerId != null && card.assigneeClerkUserId === viewerId
    if (filter === 'unassigned') return card.assigneeClerkUserId == null
    if (filter === 'stalled') {
      return (
        STALL_STAGES.includes(card.stage) &&
        card.lastInteractionAt != null &&
        now - card.lastInteractionAt > 2 * DAY
      )
    }
    return true
  }

  if (error && !byStage) {
    return (
      <ErrorState
        title="Não foi possível carregar o Acompanhamento"
        description={error}
        actionLabel="Tentar de novo"
        onAction={() => void load()}
      />
    )
  }
  if (!byStage) return <ListSkeleton label="Carregando acompanhamento…" />

  const all = stages.flatMap((s) => byStage[s] ?? [])
  const total = all.filter((c) => c.stage !== 'concluido' && c.stage !== 'perdido').length
  const proCount = (id: string) => all.filter((c) => c.linkedAppointment?.professionalId === id).length
  const profNames = professionals.filter((p) => profFilter.includes(p.id)).map((p) => p.name)
  const counts: Record<Filter, number> = {
    all: all.length,
    mine: viewerId ? all.filter((c) => c.assigneeClerkUserId === viewerId).length : 0,
    unassigned: all.filter((c) => c.assigneeClerkUserId == null).length,
    stalled: all.filter(
      (c) =>
        STALL_STAGES.includes(c.stage) &&
        c.lastInteractionAt != null &&
        now - c.lastInteractionAt > 2 * DAY,
    ).length,
  }

  return (
    <div className="acomp-wide" data-panel={openId ? 'open' : 'closed'}>
      <div className="acomp-wide-bar">
        <span className="panel-subtitle">{total} contatos em andamento</span>
        <SearchField
          className="acomp-wide-search"
          aria-label="Buscar contato"
          value={q}
          onChange={setQ}
        >
          <Search aria-hidden size={16} strokeWidth={2} className="inbox-search-icon" />
          <Input className="inbox-search-input" placeholder="Buscar contato" autoComplete="off" />
        </SearchField>
        <div className="acomp-wide-filters" role="toolbar" aria-label="Filtros">
          {(Object.keys(FILTER_LABEL) as Filter[]).map((f) => (
            <Button
              key={f}
              className="panel-chip"
              aria-pressed={filter === f}
              onPress={() => setFilter(f)}
            >
              {FILTER_LABEL[f]}
              <span
                className={`panel-chip-count${f === 'stalled' && counts.stalled > 0 ? ' panel-chip-count--warn' : ''}`}
              >
                {counts[f]}
              </span>
            </Button>
          ))}
          <Button
            className="panel-chip"
            aria-pressed={showLost}
            onPress={() => setShowLost((v) => !v)}
          >
            Perdidos
          </Button>
        </div>
        {professionals.length > 1 ? (
          <div className="acomp-wide-filters" role="group" aria-label="Filtrar por profissional">
            {professionals.map((p) => (
              <Button
                key={p.id}
                className="panel-chip"
                aria-pressed={profFilter.includes(p.id)}
                onPress={() =>
                  setProfFilter((cur) => (cur.includes(p.id) ? cur.filter((x) => x !== p.id) : [...cur, p.id]))
                }
              >
                {p.name}
                <span className="panel-chip-count">{proCount(p.id)}</span>
              </Button>
            ))}
          </div>
        ) : null}
      </div>

      {profNames.length > 0 ? (
        <p className="acomp-wide-note" role="status">
          Mostrando só quem já tem horário com {profNames.join(' e ')}.{' '}
          <button type="button" onClick={() => setProfFilter([])}>
            Limpar
          </button>
        </p>
      ) : null}

      {error ? (
        <p className="acomp-banner-error" role="alert">
          {error}
        </p>
      ) : null}

      <div className="acomp-wide-board" role="group" aria-label="Quadro por etapa">
        {stages.map((stage) => {
          const cards = (byStage[stage] ?? []).filter(visible)
          return (
            <section
              key={stage}
              className="acomp-col"
              aria-label={`${STAGE_LABELS[stage]}, ${cards.length}`}
            >
              <h2 className="acomp-col-head">
                {STAGE_LABELS[stage]}
                <span className="acomp-col-count">{cards.length}</span>
              </h2>
              <div className="acomp-col-list">
                {cards.length === 0 ? (
                  <p className="acomp-col-empty">Ninguém aqui</p>
                ) : (
                  cards.map((card) => {
                    const name = contactLabel(card.contact.displayName, card.contact.waId)
                    const stalled =
                      STALL_STAGES.includes(card.stage) &&
                      card.lastInteractionAt != null &&
                      now - card.lastInteractionAt > 2 * DAY
                    return (
                      <button
                        key={card.id}
                        type="button"
                        className={`acomp-card${openId === card.id ? ' acomp-card--open' : ''}`}
                        aria-label={`Abrir ${name}`}
                        aria-expanded={openId === card.id}
                        aria-controls="acomp-panel"
                        onClick={(e) => openCard(card, e.currentTarget)}
                      >
                        <span className="acomp-card-top">
                          <span className="acomp-card-name">{name}</span>
                          <span className="acomp-card-time">{relativeTime(card.lastInteractionAt)}</span>
                        </span>
                        <span className="acomp-card-line">
                          {appointmentLine(card.linkedAppointment?.startsAt, card.missingAppointment)}
                        </span>
                        <span className="acomp-card-foot">
                          <span>{card.assigneeDisplayName ?? 'Sem responsável'}</span>
                          {stalled ? (
                            <span className="acomp-card-late">
                              <CircleAlert aria-hidden size={13} strokeWidth={2.4} />
                              Parado
                            </span>
                          ) : null}
                        </span>
                      </button>
                    )
                  })
                )}
              </div>
            </section>
          )
        })}
      </div>

      {openId ? (
        <aside
          id="acomp-panel"
          ref={panelRef}
          tabIndex={-1}
          className="acomp-panel"
          aria-label="Contato em andamento"
        >
          <AcompanhamentoDetail
            key={openId}
            tenantId={tenantId}
            opportunityId={openId}
            api={api}
            generation={generation}
            onClose={closePanel}
            onChanged={() => void load()}
          />
        </aside>
      ) : null}
    </div>
  )
}
