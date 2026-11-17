import type { ReactNode } from 'react'
import { Button, Dialog, Heading, Modal, ModalOverlay } from 'react-aria-components'

type Props = {
  open: boolean
  busy: boolean
  title: string
  description: ReactNode
  confirmLabel: string
  confirmBusyLabel: string
  onClose: () => void
  onConfirm: () => void
}

/** Modal Cancelar / Confirmar para ações destrutivas de staging (dono). */
export function StagingDestructiveConfirmDialog({
  open,
  busy,
  title,
  description,
  confirmLabel,
  confirmBusyLabel,
  onClose,
  onConfirm,
}: Props) {
  const titleId = 'staging-destructive-title'
  const descId = 'staging-destructive-desc'

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
          aria-labelledby={titleId}
          aria-describedby={descId}
        >
          {({ close }) => (
            <>
              <span className="panel-sheet-handle" aria-hidden="true" />
              <Heading slot="title" id={titleId} className="panel-title" style={{ margin: '8px 0 2px' }}>
                {title}
              </Heading>
              <div id={descId} className="panel-subtitle" style={{ margin: '0 0 12px' }}>
                {description}
              </div>
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
                onPress={() => onConfirm()}
              >
                {busy ? confirmBusyLabel : confirmLabel}
              </Button>
            </>
          )}
        </Dialog>
      </Modal>
    </ModalOverlay>
  )
}