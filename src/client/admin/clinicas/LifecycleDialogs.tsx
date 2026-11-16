import { useEffect, useState, type FormEvent } from 'react'
import { Dialog, Heading, Modal, ModalOverlay } from 'react-aria-components'

export type LifecycleKind = 'suspend' | 'reactivate' | 'delete'

export const MIN_REASON = 3
export const MAX_REASON = 300

type CopyEntry = { title: (name: string) => string; effects: string[]; confirm: string; busy: string; danger: boolean }

const COPY: Record<LifecycleKind, CopyEntry> = {
  suspend: {
    title: (n) => `Suspender ${n}?`,
    effects: [
      'A equipe da clínica perde o acesso ao painel e as conexões abertas fecham.',
      'Pedidos e sessões de suporte em aberto são encerrados.',
      'Reativar não restaura membros nem sessões de suporte já revogados.',
    ],
    confirm: 'Suspender clínica',
    busy: 'Suspendendo…',
    danger: false,
  },
  reactivate: {
    title: (n) => `Reativar ${n}?`,
    effects: [
      'A clínica volta a poder atender.',
      'Membros e sessões de suporte já revogados continuam revogados.',
    ],
    confirm: 'Reativar clínica',
    busy: 'Reativando…',
    danger: false,
  },
  delete: {
    title: (n) => `Excluir ${n}?`,
    effects: [
      'A clínica fica bloqueada de imediato e entra na fila de exclusão.',
      'A exclusão definitiva dos dados segue a política de retenção.',
      'Depois de iniciada, a clínica não pode ser reativada por esta tela.',
    ],
    confirm: 'Excluir clínica',
    busy: 'Excluindo…',
    danger: true,
  },
}

type Props = {
  kind: LifecycleKind | null
  tenantName: string
  busy: boolean
  error: string | null
  onClose: () => void
  onConfirm: (reason: string) => void
}

/** Confirmação de mudança de estado (REQ-106): motivo obrigatório; excluir pede o nome da clínica. */
export function LifecycleDialog({ kind, tenantName, busy, error, onClose, onConfirm }: Props) {
  const [reason, setReason] = useState('')
  const [typedName, setTypedName] = useState('')
  const [touched, setTouched] = useState(false)

  useEffect(() => {
    if (kind) {
      setReason('')
      setTypedName('')
      setTouched(false)
    }
  }, [kind])

  if (!kind) return null
  const copy = COPY[kind]
  const trimmed = reason.trim()
  const reasonError =
    trimmed.length < MIN_REASON
      ? `Escreva o motivo (pelo menos ${MIN_REASON} caracteres).`
      : trimmed.length > MAX_REASON
        ? `O motivo pode ter no máximo ${MAX_REASON} caracteres.`
        : null
  const nameMatches = kind !== 'delete' || typedName.trim() === tenantName.trim()
  const nameError = nameMatches ? null : 'O nome não corresponde ao da clínica.'

  const submit = (e: FormEvent) => {
    e.preventDefault()
    setTouched(true)
    if (reasonError || nameError || busy) return
    onConfirm(trimmed)
  }

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
        <Dialog className="admin-dialog" role="alertdialog" aria-labelledby="admin-lifecycle-title">
          <form onSubmit={submit} noValidate>
            <Heading slot="title" id="admin-lifecycle-title" className="admin-dialog-title">
              {copy.title(tenantName)}
            </Heading>
            <ul className="admin-dialog-list">
              {copy.effects.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
            <label className="admin-field">
              Motivo (fica na auditoria)
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={3}
                maxLength={MAX_REASON + 50}
                aria-invalid={touched && reasonError ? true : undefined}
                aria-describedby={touched && reasonError ? 'admin-reason-error' : undefined}
                disabled={busy}
              />
              <span className="admin-field-meta">{trimmed.length}/{MAX_REASON}</span>
              {touched && reasonError ? (
                <span id="admin-reason-error" className="admin-field-error" role="alert">
                  {reasonError}
                </span>
              ) : null}
            </label>
            {kind === 'delete' ? (
              <label className="admin-field">
                Para confirmar, escreva o nome da clínica: <strong>{tenantName}</strong>
                <input
                  type="text"
                  value={typedName}
                  onChange={(e) => setTypedName(e.target.value)}
                  autoComplete="off"
                  aria-invalid={touched && nameError ? true : undefined}
                  disabled={busy}
                />
                {touched && nameError ? (
                  <span className="admin-field-error" role="alert">{nameError}</span>
                ) : null}
              </label>
            ) : null}
            {error ? (
              <p className="admin-dialog-error" role="alert">{error}</p>
            ) : null}
            <div className="admin-dialog-actions">
              <button
                type="submit"
                className={copy.danger ? 'admin-btn admin-btn--danger-fill' : 'admin-btn admin-btn--primary'}
                disabled={busy}
              >
                {busy ? copy.busy : copy.confirm}
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

type EditProps = {
  open: boolean
  initial: { name: string; timezone: string }
  busy: boolean
  error: string | null
  onClose: () => void
  onSave: (patch: { name: string; timezone: string }) => void
}

function timezones(current: string): string[] {
  const intl = Intl as unknown as { supportedValuesOf?: (k: string) => string[] }
  const all = intl.supportedValuesOf?.('timeZone') ?? []
  return all.includes(current) ? all : [current, ...all]
}

export function EditTenantDialog({ open, initial, busy, error, onClose, onSave }: EditProps) {
  const [name, setName] = useState(initial.name)
  const [timezone, setTimezone] = useState(initial.timezone)
  const [touched, setTouched] = useState(false)

  useEffect(() => {
    if (open) {
      setName(initial.name)
      setTimezone(initial.timezone)
      setTouched(false)
    }
  }, [open, initial.name, initial.timezone])

  if (!open) return null
  const nameError = name.trim() ? null : 'Escreva o nome da clínica.'

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
        <Dialog className="admin-dialog" aria-labelledby="admin-edit-title">
          <form
            noValidate
            onSubmit={(e) => {
              e.preventDefault()
              setTouched(true)
              if (nameError || busy) return
              onSave({ name: name.trim(), timezone })
            }}
          >
            <Heading slot="title" id="admin-edit-title" className="admin-dialog-title">
              Editar clínica
            </Heading>
            <label className="admin-field">
              Nome da clínica
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                aria-invalid={touched && nameError ? true : undefined}
                disabled={busy}
              />
              {touched && nameError ? <span className="admin-field-error" role="alert">{nameError}</span> : null}
            </label>
            <label className="admin-field">
              Fuso horário
              <select value={timezone} onChange={(e) => setTimezone(e.target.value)} disabled={busy}>
                {timezones(initial.timezone).map((tz) => (
                  <option key={tz} value={tz}>{tz}</option>
                ))}
              </select>
            </label>
            {error ? <p className="admin-dialog-error" role="alert">{error}</p> : null}
            <div className="admin-dialog-actions">
              <button type="submit" className="admin-btn admin-btn--primary" disabled={busy}>
                {busy ? 'Salvando…' : 'Salvar'}
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
