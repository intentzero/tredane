import { Button, Dialog, Heading, Modal, ModalOverlay } from 'react-aria-components'

export type ThreadAction = {
  id: string
  label: string
  /** Ação destrutiva: texto vermelho e separador antes. */
  danger?: boolean
}

type Props = {
  open: boolean
  title: string
  actions: ThreadAction[]
  onAction: (id: string) => void
  onClose: () => void
}

/** Folha de ações da conversa no celular (§3.1: escolhas curtas em folha inferior). */
export function ThreadActionsSheet({ open, title, actions, onAction, onClose }: Props) {
  return (
    <ModalOverlay
      isOpen={open}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      className="panel-overlay"
      style={{ position: 'fixed', inset: 0, zIndex: 30 }}
      isDismissable
    >
      <Modal>
        <Dialog
          className="panel-sheet"
          style={{ position: 'fixed', left: 0, right: 0, bottom: 0 }}
          aria-labelledby="thread-actions-title"
        >
          <span className="panel-sheet-handle" aria-hidden="true" />
          <Heading slot="title" id="thread-actions-title" className="thread-actions-title">
            {title}
          </Heading>
          {actions.map((a, i) => (
            <div key={a.id} style={{ display: 'contents' }}>
              {a.danger && i > 0 ? <hr className="thread-actions-sep" /> : null}
              <Button
                className={`thread-actions-item${a.danger ? ' thread-actions-item--danger' : ''}`}
                onPress={() => {
                  onClose()
                  onAction(a.id)
                }}
              >
                {a.label}
              </Button>
            </div>
          ))}
          <Button className="panel-btn-secondary thread-actions-cancel" onPress={onClose}>
            Cancelar
          </Button>
        </Dialog>
      </Modal>
    </ModalOverlay>
  )
}
