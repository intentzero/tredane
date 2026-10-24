import * as Dialog from '@radix-ui/react-dialog'
import * as Tabs from '@radix-ui/react-tabs'
import { Calendar, CircleAlert, Kanban, MessageCircle } from 'lucide-react'
import { useState } from 'react'
import { moveOptions, pipelineCards, stages, type StageId } from '../data'

/**
 * M-05 Acompanhamento — candidata A (Radix UI Primitives).
 * Folha inferior «Mover para…» via Dialog. Área de prova; dados fictícios.
 */
export function RadixAcompanhamento() {
  const [stage, setStage] = useState<StageId>('atendimento')
  const [openFor, setOpenFor] = useState<string | null>('beatriz')

  const movingName =
    pipelineCards.find((card) => card.id === openFor)?.name ?? 'contato'

  return (
    <div className="panel-phone" data-prova="radix-m05">
      <header className="panel-header-root">
        <div>
          <h1 className="panel-title-lg">Acompanhamento</h1>
          <span className="panel-subtitle">Clínica Aurora · 7 contatos em andamento</span>
        </div>
        <Tabs.Root value={stage} onValueChange={(value) => setStage(value as StageId)}>
          <Tabs.List className="panel-tabs" aria-label="Etapas">
            {stages.map((item) => (
              <Tabs.Trigger key={item.id} className="panel-chip" value={item.id}>
                {item.label} · {item.count}
              </Tabs.Trigger>
            ))}
          </Tabs.List>
        </Tabs.Root>
      </header>

      <div className="panel-scroll-sm" role="tabpanel">
        {pipelineCards.map((card) => (
          <article key={card.id} className="panel-card-lg">
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <a className="panel-link" href="/prova">
                {card.name}
              </a>
              <button
                type="button"
                className="panel-move"
                aria-haspopup="dialog"
                onClick={() => setOpenFor(card.id)}
              >
                Mover
              </button>
            </div>
            <span className="panel-meta">{card.meta}</span>
            {card.fail ? (
              <span className="panel-fail">
                <CircleAlert aria-hidden="true" size={14} strokeWidth={2.4} />
                Resposta não enviada
              </span>
            ) : null}
          </article>
        ))}
      </div>

      <nav className="panel-nav" aria-label="Áreas">
        <a href="/prova">
          <MessageCircle aria-hidden="true" size={24} strokeWidth={2} />
          Conversas
        </a>
        <a href="/prova/radix/m05" aria-current="page">
          <Kanban aria-hidden="true" size={24} strokeWidth={2} />
          Acompanhamento
        </a>
        <a href="/prova">
          <Calendar aria-hidden="true" size={24} strokeWidth={2} />
          Agenda
        </a>
      </nav>

      <Dialog.Root
        open={openFor !== null}
        onOpenChange={(open) => {
          if (!open) setOpenFor(null)
        }}
      >
        <Dialog.Portal container={typeof document !== 'undefined' ? document.querySelector('[data-prova="radix-m05"]') ?? undefined : undefined}>
          <Dialog.Overlay className="panel-overlay" />
          <Dialog.Content className="panel-sheet" aria-describedby={undefined}>
            <span className="panel-sheet-handle" aria-hidden="true" />
            <Dialog.Title className="panel-title" style={{ margin: '8px 0 2px' }}>
              Mover {movingName} para…
            </Dialog.Title>
            <Dialog.Description className="panel-subtitle">
              Etapa atual: Em atendimento
            </Dialog.Description>
            {moveOptions.map((option) => (
              <button
                key={option.id}
                type="button"
                className={`panel-sheet-option${option.danger ? ' danger' : ''}`}
                style={
                  option.highlight
                    ? { background: 'var(--color-primary-tint)', minHeight: 56 }
                    : option.hintWarn
                      ? { minHeight: 56 }
                      : undefined
                }
                onClick={() => setOpenFor(null)}
              >
                <span>{option.label}</span>
                {option.hint ? <span className="hint">{option.hint}</span> : null}
                {option.hintWarn ? <span className="hint-warn">{option.hintWarn}</span> : null}
              </button>
            ))}
            <Dialog.Close asChild>
              <button type="button" className="panel-btn-secondary" style={{ marginTop: 8 }}>
                Cancelar
              </button>
            </Dialog.Close>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  )
}
