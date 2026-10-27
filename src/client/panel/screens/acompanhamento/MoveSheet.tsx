import {
  Button,
  Dialog,
  Heading,
  Modal,
  ModalOverlay,
} from 'react-aria-components'
import type { OpportunityStage } from '../../api'
import { STAGE_LABELS, STAGE_ORDER } from './format'

type Props = {
  open: boolean
  contactName: string
  currentStage: OpportunityStage
  busy: boolean
  onClose: () => void
  onMove: (toStage: OpportunityStage) => void
}

/**
 * Folha «Mover para…» (M-05 / DEC-048) — alternativa acessível sem arrastar.
 */
export function MoveSheet({
  open,
  contactName,
  currentStage,
  busy,
  onClose,
  onMove,
}: Props) {
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
        <Dialog
          className="panel-sheet"
          style={{ position: 'fixed', left: 0, right: 0, bottom: 0 }}
          aria-labelledby="move-sheet-title"
          aria-describedby="move-sheet-desc"
        >
          {({ close }) => (
            <>
              <span className="panel-sheet-handle" aria-hidden="true" />
              <Heading
                slot="title"
                id="move-sheet-title"
                className="panel-title"
                style={{ margin: '8px 0 2px' }}
              >
                Mover {contactName} para…
              </Heading>
              <p
                id="move-sheet-desc"
                className="panel-subtitle"
                style={{ margin: 0 }}
              >
                Etapa atual: {STAGE_LABELS[currentStage]}
              </p>
              {STAGE_ORDER.filter((s) => s !== currentStage).map((stage) => (
                <Button
                  key={stage}
                  className={`panel-sheet-option${stage === 'perdido' ? ' danger' : ''}`}
                  style={
                    stage === 'horario_proposto'
                      ? { background: 'var(--color-primary-tint)', minHeight: 56 }
                      : stage === 'agendado'
                        ? { minHeight: 56 }
                        : undefined
                  }
                  isDisabled={busy}
                  onPress={() => {
                    onMove(stage)
                  }}
                >
                  <span>{STAGE_LABELS[stage]}</span>
                  {stage === 'horario_proposto' ? (
                    <span className="hint">Não reserva horário na agenda</span>
                  ) : null}
                  {stage === 'a_definir' ? (
                    <span className="hint">Para reservar um bloco, use «Reservar bloco» na conversa</span>
                  ) : null}
                  {stage === 'agendado' ? (
                    <span className="hint-warn">
                      Sem compromisso vinculado — agende depois
                    </span>
                  ) : null}
                </Button>
              ))}
              <Button
                className="panel-btn-secondary"
                style={{ marginTop: 8 }}
                isDisabled={busy}
                onPress={() => {
                  close()
                  onClose()
                }}
              >
                Cancelar
              </Button>
            </>
          )}
        </Dialog>
      </Modal>
    </ModalOverlay>
  )
}
