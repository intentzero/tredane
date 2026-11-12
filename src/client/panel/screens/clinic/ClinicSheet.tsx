import { X } from 'lucide-react'
import { useEffect, useRef, type ReactNode } from 'react'
import { Button, Dialog, Heading, Modal, ModalOverlay } from 'react-aria-components'
import { useMediaQuery } from '../../ui/useMediaQuery'
import { useVisualViewportSheet } from '../../ui/useVisualViewportSheet'

/**
 * Folha de baixo da Clínica (editor de um dia, folga, Tempo, Convidar pessoa).
 * No celular sobe da borda inferior; no desktop (≥ 1280 px) vira o painel que
 * desliza por cima, só por CSS. Em telemóvel, com o teclado iOS aberto, a folha
 * sobe com o visualViewport para o campo focado não ficar tapado.
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
  const titleRef = useRef<HTMLHeadingElement>(null)
  const wide = useMediaQuery('(min-width: 1280px)')
  // Desktop: painel lateral — não aplicar o pin do visualViewport.
  const sheetStyle = useVisualViewportSheet(isOpen && !wide, { mode: 'lift' })
  // Ao abrir, o foco vai para o título (#251); ao fechar, o react-aria devolve a quem abriu.
  useEffect(() => {
    if (isOpen) titleRef.current?.focus()
  }, [isOpen])
  return (
    <ModalOverlay isOpen={isOpen} onOpenChange={onOpenChange} isDismissable className="panel-overlay panel-choice-overlay">
      <Modal className="panel-choice-modal">
        <Dialog
          className="panel-sheet panel-choice-sheet clinic-sheet"
          data-size="tall"
          aria-label={title}
          style={sheetStyle}
        >
          <span className="panel-sheet-handle" aria-hidden="true" />
          <div className="clinic-sheet-head">
            <Heading slot="title" ref={titleRef} tabIndex={-1} className="panel-title clinic-sheet-title">
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
