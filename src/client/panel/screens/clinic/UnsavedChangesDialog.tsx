import { Button, Dialog, Heading, Modal, ModalOverlay } from 'react-aria-components'

type Props = {
  open: boolean
  busy?: boolean
  /** Omitido na ficha do serviço: só continuar ou sair, sem gravar daqui. */
  onSave?: () => void
  onDiscard: () => void
  onContinue: () => void
  discardLabel?: string
  continueLabel?: string
  message?: string
}

/**
 * Diálogo ao fechar ficha com rascunho.
 * Profissional e sala: gravar, descartar ou continuar (DEC-083).
 * Serviço: continuar editando ou sair sem salvar — sem gravar neste diálogo.
 */
export function UnsavedChangesDialog({
  open,
  busy,
  onSave,
  onDiscard,
  onContinue,
  discardLabel = 'Descartar',
  continueLabel = 'Continuar a editar',
  message = 'Se sair agora, as alterações desta ficha perdem-se. Pode gravar, descartar ou continuar a editar.',
}: Props) {
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
          <p className="clinic-footnote">{message}</p>
          <div className="clinic-footer-actions">
            {onSave ? (
              <Button
                className="panel-btn panel-btn-primary"
                isDisabled={busy}
                onPress={onSave}
              >
                {busy ? 'Salvando…' : 'Gravar'}
              </Button>
            ) : (
              <Button
                className="panel-btn panel-btn-primary"
                isDisabled={busy}
                onPress={onContinue}
              >
                {continueLabel}
              </Button>
            )}
            <Button
              className="panel-btn panel-btn-ghost"
              isDisabled={busy}
              onPress={onDiscard}
            >
              {discardLabel}
            </Button>
            {onSave ? (
              <Button
                className="panel-btn panel-btn-ghost"
                isDisabled={busy}
                onPress={onContinue}
              >
                {continueLabel}
              </Button>
            ) : null}
          </div>
        </Dialog>
      </Modal>
    </ModalOverlay>
  )
}
