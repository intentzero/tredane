import { Calendar, CircleAlert, Kanban, MessageCircle } from 'lucide-react'
import { useState } from 'react'
import {
  Button,
  Dialog,
  Heading,
  Modal,
  ModalOverlay,
  Tab,
  TabList,
  Tabs,
} from 'react-aria-components'
import { moveOptions, pipelineCards, stages, type StageId } from '../data'

/**
 * M-05 Acompanhamento — candidata B (React Aria Components).
 * Folha inferior «Mover para…» via Modal/Dialog. Área de prova; dados fictícios.
 */
export function ReactAriaAcompanhamento() {
  const [stage, setStage] = useState<StageId>('atendimento')
  const [openFor, setOpenFor] = useState<string | null>('beatriz')

  const movingName =
    pipelineCards.find((card) => card.id === openFor)?.name ?? 'contato'

  return (
    <div className="panel-phone" data-prova="react-aria-m05" lang="pt-BR">
      <header className="panel-header-root">
        <div>
          <h1 className="panel-title-lg">Acompanhamento</h1>
          <span className="panel-subtitle">Clínica Aurora · 7 contatos em andamento</span>
        </div>
        <Tabs
          selectedKey={stage}
          onSelectionChange={(key) => {
            if (typeof key === 'string') setStage(key as StageId)
          }}
        >
          <TabList className="panel-tabs" aria-label="Etapas">
            {stages.map((item) => (
              <Tab key={item.id} id={item.id} className="panel-chip">
                {item.label} · {item.count}
              </Tab>
            ))}
          </TabList>
        </Tabs>
      </header>

      <div className="panel-scroll-sm" role="tabpanel" id={`panel-${stage}`}>
        {pipelineCards.map((card) => (
          <article key={card.id} className="panel-card-lg">
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <a className="panel-link" href="/prova">
                {card.name}
              </a>
              <Button className="panel-move" onPress={() => setOpenFor(card.id)}>
                Mover
              </Button>
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
        <a href="/prova/react-aria/m05" aria-current="page">
          <Kanban aria-hidden="true" size={24} strokeWidth={2} />
          Acompanhamento
        </a>
        <a href="/prova">
          <Calendar aria-hidden="true" size={24} strokeWidth={2} />
          Agenda
        </a>
      </nav>

      <ModalOverlay
        isOpen={openFor !== null}
        onOpenChange={(open) => {
          if (!open) setOpenFor(null)
        }}
        className="panel-overlay"
        style={{ position: 'fixed', inset: 0, zIndex: 20 }}
        isDismissable
      >
        <Modal>
          <Dialog className="panel-sheet" style={{ position: 'fixed', left: 0, right: 0, bottom: 0 }}>
            {({ close }) => (
              <>
                <span className="panel-sheet-handle" aria-hidden="true" />
                <Heading slot="title" className="panel-title" style={{ margin: '8px 0 2px' }}>
                  Mover {movingName} para…
                </Heading>
                <p className="panel-subtitle" style={{ margin: 0 }}>
                  Etapa atual: Em atendimento
                </p>
                {moveOptions.map((option) => (
                  <Button
                    key={option.id}
                    className={`panel-sheet-option${option.danger ? ' danger' : ''}`}
                    style={
                      option.highlight
                        ? { background: 'var(--color-primary-tint)', minHeight: 56 }
                        : option.hintWarn
                          ? { minHeight: 56 }
                          : undefined
                    }
                    onPress={close}
                  >
                    <span>{option.label}</span>
                    {option.hint ? <span className="hint">{option.hint}</span> : null}
                    {option.hintWarn ? (
                      <span className="hint-warn">{option.hintWarn}</span>
                    ) : null}
                  </Button>
                ))}
                <Button className="panel-btn-secondary" style={{ marginTop: 8 }} onPress={close}>
                  Cancelar
                </Button>
              </>
            )}
          </Dialog>
        </Modal>
      </ModalOverlay>
    </div>
  )
}
