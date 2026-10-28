import { Ban } from 'lucide-react'
import { useState } from 'react'
import {
  Button,
  Dialog,
  Heading,
  Modal,
  ModalOverlay,
  Radio,
  RadioGroup,
} from 'react-aria-components'

export const BLOCK_REASONS = ['Mensagens ofensivas', 'Spam ou propaganda', 'Outro motivo'] as const

type Props = {
  open: boolean
  /** Nome ou telefone já mascarado. */
  contactLabel: string
  busy: boolean
  error?: string | null
  onClose: () => void
  onConfirm: (reason: string | null) => void
}

/** Confirmação de bloqueio do contato (Proposto, 27/10/2026): diálogo central para ação destrutiva. */
export function BlockContactDialog({ open, contactLabel, busy, error, onClose, onConfirm }: Props) {
  const [reason, setReason] = useState<string | null>(null)
  return (
    <ModalOverlay
      isOpen={open}
      onOpenChange={(next) => {
        if (!next && !busy) onClose()
      }}
      className="panel-overlay panel-overlay--center"
      style={{ position: 'fixed', inset: 0, zIndex: 30 }}
      isDismissable={!busy}
    >
      <Modal className="block-contact-modal">
        <Dialog
          className="block-contact-dialog"
          role="alertdialog"
          aria-labelledby="block-contact-title"
        >
          {({ close }) => (
            <>
              <span className="block-contact-icon" aria-hidden="true">
                <Ban size={22} strokeWidth={2} />
              </span>
              <Heading slot="title" id="block-contact-title" className="block-contact-title">
                Bloquear {contactLabel}?
              </Heading>
              <ul className="block-contact-list">
                <li>Mensagens novas deste número deixam de aparecer no painel.</li>
                <li>Ninguém da clínica consegue responder até desbloquear.</li>
                <li>A conversa é encerrada. O histórico e os horários marcados continuam.</li>
              </ul>
              <RadioGroup
                className="block-contact-reasons"
                aria-label="Motivo (opcional, só a equipe vê)"
                value={reason ?? ''}
                onChange={(v) => setReason(v)}
                isDisabled={busy}
              >
                <span className="block-contact-legend">Motivo (opcional, só a equipe vê)</span>
                {BLOCK_REASONS.map((r) => (
                  <Radio key={r} value={r} className="block-contact-radio">
                    <span className="block-contact-dot" aria-hidden="true" />
                    {r}
                  </Radio>
                ))}
              </RadioGroup>
              {error ? (
                <p className="inbox-notice" role="alert">
                  {error}
                </p>
              ) : null}
              <div className="block-contact-actions">
                <Button
                  className="panel-btn-danger"
                  isDisabled={busy}
                  onPress={() => onConfirm(reason)}
                >
                  {busy ? 'Bloqueando…' : 'Bloquear contato'}
                </Button>
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
              </div>
            </>
          )}
        </Dialog>
      </Modal>
    </ModalOverlay>
  )
}
