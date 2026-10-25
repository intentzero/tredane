import {
  Button,
  Dialog,
  Heading,
  Modal,
  ModalOverlay,
} from 'react-aria-components'

type Props = {
  open: boolean
  /** Rótulo já mascarado — sem wa_id completo. */
  contactLabel: string
  busy: boolean
  onClose: () => void
  onConfirm: () => void
}

/**
 * Confirmação destrutiva de exclusão de contacto (owner / DEC-048).
 * Exemplos fictícios apenas — sem PII em logs do cliente.
 */
export function DeleteContactDialog({
  open,
  contactLabel,
  busy,
  onClose,
  onConfirm,
}: Props) {
  return (
    <ModalOverlay
      isOpen={open}
      onOpenChange={(next) => {
        if (!next && !busy) onClose()
      }}
      className="panel-overlay"
      style={{ position: 'fixed', inset: 0, zIndex: 30 }}
      isDismissable={!busy}
    >
      <Modal>
        <Dialog
          className="panel-sheet"
          style={{ position: 'fixed', left: 0, right: 0, bottom: 0 }}
          role="alertdialog"
          aria-labelledby="delete-contact-title"
          aria-describedby="delete-contact-desc"
        >
          {({ close }) => (
            <>
              <span className="panel-sheet-handle" aria-hidden="true" />
              <Heading
                slot="title"
                id="delete-contact-title"
                className="panel-title"
                style={{ margin: '8px 0 2px' }}
              >
                Excluir contacto?
              </Heading>
              <p
                id="delete-contact-desc"
                className="panel-subtitle"
                style={{ margin: '0 0 12px' }}
              >
                Remove mensagens e anexos de <strong>{contactLabel}</strong>.
                Compromissos ficam anonimizados. Esta ação não pode ser
                desfeita.
              </p>
              <Button
                className="panel-btn-secondary"
                autoFocus
                isDisabled={busy}
                onPress={() => {
                  close()
                  onClose()
                }}
              >
                Cancelar
              </Button>
              <Button
                className="panel-btn-danger"
                style={{ marginTop: 8 }}
                isDisabled={busy}
                onPress={() => {
                  onConfirm()
                }}
              >
                {busy ? 'A excluir…' : 'Excluir permanentemente'}
              </Button>
            </>
          )}
        </Dialog>
      </Modal>
    </ModalOverlay>
  )
}
