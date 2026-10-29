import { X } from 'lucide-react'
import type { ReactNode } from 'react'
import { Button, Dialog, Heading, Modal, ModalOverlay } from 'react-aria-components'

/**
 * Folha de baixo da Clínica (editor de um dia, folga ou fechamento). No celular sobe da borda
 * inferior; no desktop vira o painel que desliza por cima quando #212 chegar, sem mudar quem usa.
 */
export function ClinicSheet({
  isOpen,
  onOpenChange,
  title,
  children,
}: {
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  title: string
  children: ReactNode
}) {
  return (
    <ModalOverlay isOpen={isOpen} onOpenChange={onOpenChange} isDismissable className="panel-overlay panel-choice-overlay">
      <Modal className="panel-choice-modal">
        <Dialog className="panel-sheet panel-choice-sheet clinic-sheet" data-size="tall" aria-label={title}>
          <span className="panel-sheet-handle" aria-hidden="true" />
          <div className="clinic-sheet-head">
            <Heading slot="title" className="panel-title clinic-sheet-title">
              {title}
            </Heading>
            <Button className="clinic-sheet-x" aria-label="Fechar" onPress={() => onOpenChange(false)}>
              <X aria-hidden size={20} strokeWidth={2} />
            </Button>
          </div>
          <div className="clinic-sheet-body">{children}</div>
        </Dialog>
      </Modal>
    </ModalOverlay>
  )
}
