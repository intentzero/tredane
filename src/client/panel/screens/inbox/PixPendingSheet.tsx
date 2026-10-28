import { Clock } from 'lucide-react'
import { Button, Dialog, Heading, Modal, ModalOverlay } from 'react-aria-components'
import type { PixChargeDetail } from '../../api'
import { getClinicTimezone } from '../../clinicTimezone'

export function formatPixAmount(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

/** «12:10» no fuso da clínica (DEC-008), nunca em UTC. */
export function formatPixDeadline(expiresAt: number | null): string | null {
  if (expiresAt == null) return null
  return new Date(expiresAt).toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: getClinicTimezone(),
  })
}

type BarProps = { charge: PixChargeDetail; onDetails: () => void }

/** Faixa compacta abaixo da faixa de contexto (DEC-065): um aviso só, com «Detalhes». */
export function PixPendingBar({ charge, onDetails }: BarProps) {
  const deadline = formatPixDeadline(charge.expiresAt)
  return (
    <div className="inbox-pix-bar" role="status">
      <Clock aria-hidden size={20} strokeWidth={2} />
      <span className="inbox-pix-bar-text">
        <strong>{deadline ? `Aguardando Pix · vence às ${deadline}` : 'Aguardando Pix'}</strong>
        <span>Horário ainda não reservado</span>
      </span>
      <Button className="inbox-pix-bar-link" onPress={onDetails}>
        Detalhes
      </Button>
    </div>
  )
}

type SheetProps = {
  charge: PixChargeDetail | null
  busy: boolean
  onClose: () => void
  onCopy: (charge: PixChargeDetail) => void
  onCancel: (charge: PixChargeDetail) => void
}

/** Folha com o estado da cobrança e as ações que já existem (copiar Pix, cancelar). */
export function PixPendingSheet({ charge, busy, onClose, onCopy, onCancel }: SheetProps) {
  const deadline = charge ? formatPixDeadline(charge.expiresAt) : null
  return (
    <ModalOverlay
      isOpen={charge != null}
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
          aria-labelledby="pix-pending-title"
        >
          <span className="panel-sheet-handle" aria-hidden="true" />
          {charge ? (
            <>
              <div className="pix-sheet-head">
                <Heading slot="title" id="pix-pending-title" className="pix-sheet-amount">
                  {formatPixAmount(charge.amountCents)}
                </Heading>
                <span className="pix-sheet-pill">Aguardando pagamento</span>
              </div>
              {deadline ? (
                <p className="pix-sheet-row">
                  <span>Pix vence</span>
                  <strong>às {deadline}</strong>
                </p>
              ) : null}
              <p className="pix-sheet-note">
                O horário <strong>ainda não está reservado</strong>. Se estiver livre quando o Pix
                cair, confirmamos sozinhos.
              </p>
              {charge.whatsappSendError ? (
                <p role="alert" className="pix-sheet-error">
                  Não foi possível enviar a cobrança pelo WhatsApp. Copie o Pix e envie na conversa.
                </p>
              ) : null}
              {charge.pixCopyPaste ? (
                <Button className="panel-btn-secondary" onPress={() => onCopy(charge)}>
                  Copiar Pix
                </Button>
              ) : null}
              <Button
                className="panel-btn-secondary pix-sheet-cancel"
                isDisabled={busy}
                onPress={() => {
                  onClose()
                  onCancel(charge)
                }}
              >
                Cancelar cobrança
              </Button>
            </>
          ) : null}
        </Dialog>
      </Modal>
    </ModalOverlay>
  )
}
