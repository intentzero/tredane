import { Button, Dialog, Heading, Modal, ModalOverlay } from 'react-aria-components'

type Props = {
  open: boolean
  busy?: boolean
  onSave: () => void
  onDiscard: () => void
  onContinue: () => void
}

/**
 * Diálogo ao fechar ficha com rascunho (DEC-083): gravar, descartar ou continuar a editar.
 * Não fecha em silêncio.
 */
export function UnsavedChangesDialog({ open, busy, onSave, onDiscard, onContinue }: Props) {
  return (
    <ModalOverlay
      isOpen={open}
      onOpenChange={(next) => {
        if (!next) onContinue()
      }}
      isDismissable={!busy}
      className="panel-overlay panel-choice-overlay"
    >
      <Modal className="panel-choice-modal">
        <Dialog
          className="panel-sheet panel-choice-sheet"
          aria-labelledby="unsaved-title"
        >
          <Heading id="unsaved-title" slot="title" className="panel-title">
            Alterações não salvas
          </Heading>
          <p className="clinic-footnote">
            Se sair agora, as alterações desta ficha perdem-se. Pode gravar, descartar ou continuar a
            editar.
          </p>
          <div className="clinic-footer-actions">
            <Button
              className="panel-btn panel-btn-primary"
              isDisabled={busy}
              onPress={onSave}
            >
              {busy ? 'Salvando…' : 'Gravar'}
            </Button>
            <Button
              className="panel-btn panel-btn-ghost"
              isDisabled={busy}
              onPress={onDiscard}
            >
              Descartar
            </Button>
            <Button
              className="panel-btn panel-btn-ghost"
              isDisabled={busy}
              onPress={onContinue}
            >
              Continuar a editar
            </Button>
          </div>
        </Dialog>
      </Modal>
    </ModalOverlay>
  )
}
