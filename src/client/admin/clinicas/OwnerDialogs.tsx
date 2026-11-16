import { useEffect, useState, type FormEvent } from 'react'
import { Dialog, Heading, Modal, ModalOverlay } from 'react-aria-components'
import type { AdminMember } from '../api'

export type OwnerDialogState =
  | { kind: 'add' }
  | { kind: 'remove'; owner: AdminMember }
  | { kind: 'replace'; owner: AdminMember }
  | null

export const memberLabel = (m: Pick<AdminMember, 'displayName' | 'email' | 'clerkUserId'>) =>
  m.displayName || m.email || m.clerkUserId

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

type Props = {
  state: OwnerDialogState
  tenantName: string
  /** Attendants ativos: candidatos a substituir uma owner. */
  candidates: AdminMember[]
  busy: boolean
  error: string | null
  onClose: () => void
  onAdd: (email: string) => void
  onRemove: (owner: AdminMember) => void
  onReplace: (owner: AdminMember, toClerkUserId: string) => void
}

/** Ações sobre owners (DEC-018, DEC-103): só o superadmin as faz; attendants são da owner. */
export function OwnerDialog({ state, tenantName, candidates, busy, error, onClose, onAdd, onRemove, onReplace }: Props) {
  const [email, setEmail] = useState('')
  const [to, setTo] = useState('')
  const [touched, setTouched] = useState(false)

  useEffect(() => {
    if (state) {
      setEmail('')
      setTo('')
      setTouched(false)
    }
  }, [state])

  if (!state) return null
  const emailError = EMAIL_RE.test(email.trim()) ? null : 'Escreva um e-mail completo, como nome@clinica.com.br.'
  const toError = to ? null : 'Escolha quem passa a ser owner.'

  const submit = (e: FormEvent) => {
    e.preventDefault()
    setTouched(true)
    if (busy) return
    if (state.kind === 'add') {
      if (!emailError) onAdd(email.trim())
    } else if (state.kind === 'replace') {
      if (!toError) onReplace(state.owner, to)
    } else {
      onRemove(state.owner)
    }
  }

  const title =
    state.kind === 'add'
      ? 'Adicionar owner'
      : state.kind === 'remove'
        ? `Remover ${memberLabel(state.owner)} como owner?`
        : `Substituir ${memberLabel(state.owner)}?`

  return (
    <ModalOverlay
      isOpen
      onOpenChange={(next) => {
        if (!next && !busy) onClose()
      }}
      isDismissable={!busy}
      className="admin-overlay"
    >
      <Modal className="admin-modal">
        <Dialog
          className="admin-dialog"
          role={state.kind === 'add' ? 'dialog' : 'alertdialog'}
          aria-labelledby="admin-owner-title"
        >
          <form onSubmit={submit} noValidate>
            <Heading slot="title" id="admin-owner-title" className="admin-dialog-title">
              {title}
            </Heading>
            {state.kind === 'add' ? (
              <>
                <p className="admin-muted">
                  A pessoa recebe um convite de owner de {tenantName} válido por 7 dias. Fica na auditoria com o seu
                  nome como autor.
                </p>
                <label className="admin-field">
                  E-mail da owner
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    autoComplete="off"
                    aria-invalid={touched && emailError ? true : undefined}
                    disabled={busy}
                  />
                  {touched && emailError ? <span className="admin-field-error" role="alert">{emailError}</span> : null}
                </label>
              </>
            ) : null}
            {state.kind === 'remove' ? (
              <ul className="admin-dialog-list">
                <li>A pessoa perde o acesso de owner e as conexões abertas dela fecham.</li>
                <li>Os acessos dela a outras clínicas não mudam.</li>
                <li>A última owner ativa não pode ser removida.</li>
              </ul>
            ) : null}
            {state.kind === 'replace' ? (
              <>
                <ul className="admin-dialog-list">
                  <li>A nova owner é promovida antes de a atual ser removida: a clínica nunca fica sem owner.</li>
                  <li>Só se pode escolher quem já é attendant desta clínica.</li>
                </ul>
                <label className="admin-field">
                  Substituir por
                  <select
                    value={to}
                    onChange={(e) => setTo(e.target.value)}
                    aria-invalid={touched && toError ? true : undefined}
                    disabled={busy}
                  >
                    <option value="">Escolher…</option>
                    {candidates.map((c) => (
                      <option key={c.clerkUserId} value={c.clerkUserId}>{memberLabel(c)}</option>
                    ))}
                  </select>
                  {touched && toError ? <span className="admin-field-error" role="alert">{toError}</span> : null}
                </label>
              </>
            ) : null}
            {error ? <p className="admin-dialog-error" role="alert">{error}</p> : null}
            <div className="admin-dialog-actions">
              <button
                type="submit"
                className={state.kind === 'remove' ? 'admin-btn admin-btn--danger-fill' : 'admin-btn admin-btn--primary'}
                disabled={busy}
              >
                {state.kind === 'add' ? 'Enviar convite' : state.kind === 'remove' ? 'Remover owner' : 'Substituir owner'}
              </button>
              <button type="button" className="admin-btn" onClick={onClose} disabled={busy}>
                Cancelar
              </button>
            </div>
          </form>
        </Dialog>
      </Modal>
    </ModalOverlay>
  )
}
