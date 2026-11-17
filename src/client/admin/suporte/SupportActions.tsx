import { useState } from 'react'
import { Dialog, Heading, Modal, ModalOverlay } from 'react-aria-components'
import { adminErrorMessage, type SupportItem } from '../api'
import { useAdminApi } from '../useAdminApi'
import { openClinicApp } from './openClinic'

type Kind = 'enter' | 'end' | 'cancel'

type Props = {
  item: SupportItem
  /** Mensagem para a página e pedido para reler a lista. */
  onChanged: (message: string) => void
}

const COPY: Record<Kind, { title: string; body: string[]; confirm: string; busy: string; danger: boolean }> = {
  enter: {
    title: 'Entrar na clínica',
    body: [
      'A sessão começa agora e dura 30 minutos, sem prorrogação (DEC-033).',
      'É só de leitura: vê as conversas, com os telefones cortados nos 4 últimos dígitos. Cada leitura fica registada.',
      'A owner e a pessoa representada são avisadas e podem encerrar a sessão.',
    ],
    confirm: 'Entrar agora',
    busy: 'A abrir…',
    danger: false,
  },
  end: {
    title: 'Encerrar a sessão',
    body: ['O acesso termina já e não se pode retomar: para voltar a ler é preciso novo pedido e nova aprovação.'],
    confirm: 'Encerrar sessão',
    busy: 'Encerrando…',
    danger: true,
  },
  cancel: {
    title: 'Cancelar o pedido',
    body: ['O pedido deixa de poder ser aprovado. Se ainda for preciso, faça um novo pedido.'],
    confirm: 'Cancelar pedido',
    busy: 'Cancelando…',
    danger: true,
  },
}

/** Ações da linha (PA-05 / PA-10): Entrar e Cancelar pedido enquanto aberto; Abrir e Encerrar com a sessão ativa. */
export function SupportActions({ item, onChanged }: Props) {
  const api = useAdminApi()
  const [kind, setKind] = useState<Kind | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const buttons: Array<{ kind: Kind | 'open'; label: string; danger?: boolean }> = []
  if (item.state === 'approved') buttons.push({ kind: 'enter', label: 'Entrar' })
  if (item.state === 'awaiting_owner' || item.state === 'approved') buttons.push({ kind: 'cancel', label: 'Cancelar pedido', danger: true })
  if (item.state === 'active') {
    buttons.push({ kind: 'open', label: 'Abrir' })
    if (item.sessionId) buttons.push({ kind: 'end', label: 'Encerrar', danger: true })
  }
  if (buttons.length === 0) return <span className="admin-muted">—</span>

  const close = () => {
    if (busy) return
    setKind(null)
    setError(null)
  }

  const run = async () => {
    if (!kind || busy) return
    setBusy(true)
    setError(null)
    try {
      if (kind === 'cancel') {
        await api.cancelSupportRequest(item.requestId)
        onChanged(`Pedido para ${item.tenantName} cancelado.`)
      } else if (kind === 'end') {
        await api.endSupportSession(item.sessionId as string)
        onChanged(`Sessão em ${item.tenantName} encerrada.`)
      } else {
        const activated = await api.activateSupportSession(item.requestId)
        try {
          await api.exchangeSupportHandoff(activated.handoffCode)
        } catch (err) {
          // A sessão já começou mas este navegador não ficou com ela: a linha passa a «ativa» e pode ser encerrada.
          onChanged(`A sessão em ${item.tenantName} começou, mas não abriu neste navegador. Encerre-a e faça novo pedido.`)
          setError(adminErrorMessage(err))
          setBusy(false)
          return
        }
        openClinicApp(item.tenantId)
        return
      }
      setKind(null)
      setBusy(false)
    } catch (err) {
      setError(adminErrorMessage(err))
      setBusy(false)
    }
  }

  const copy = kind ? COPY[kind] : null
  return (
    <>
      <div className="admin-row-actions">
        {buttons.map((b) => (
          <button
            key={b.kind}
            type="button"
            className={`admin-btn admin-btn--sm${b.danger ? ' admin-btn--danger' : ''}`}
            aria-label={`${b.label} · ${item.tenantName}`}
            onClick={() => (b.kind === 'open' ? openClinicApp(item.tenantId) : (setError(null), setKind(b.kind)))}
          >
            {b.label}
          </button>
        ))}
      </div>
      {kind && copy ? (
        <ModalOverlay isOpen onOpenChange={(next) => !next && close()} isDismissable={!busy} className="admin-overlay">
          <Modal className="admin-modal">
            <Dialog className="admin-dialog" aria-labelledby={`admin-support-act-${item.requestId}`}>
              <Heading slot="title" id={`admin-support-act-${item.requestId}`} className="admin-dialog-title">
                {copy.title} · {item.tenantName}
              </Heading>
              <ul className="admin-dialog-list">
                {copy.body.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
              {error ? <p className="admin-dialog-error" role="alert">{error}</p> : null}
              <div className="admin-dialog-actions">
                <button
                  type="button"
                  className={`admin-btn ${copy.danger ? 'admin-btn--danger-fill' : 'admin-btn--primary'}`}
                  onClick={run}
                  disabled={busy}
                >
                  {busy ? copy.busy : copy.confirm}
                </button>
                <button type="button" className="admin-btn" onClick={close} disabled={busy}>
                  Voltar
                </button>
              </div>
            </Dialog>
          </Modal>
        </ModalOverlay>
      ) : null}
    </>
  )
}
