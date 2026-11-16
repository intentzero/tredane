import { useEffect, useState, type FormEvent } from 'react'
import { Dialog, Heading, Modal, ModalOverlay } from 'react-aria-components'
import { adminErrorMessage, type AdminMember, type AdminTenantRow } from '../api'
import { useAdminApi } from '../useAdminApi'
import { personLabel } from '../format'

const MIN_REASON = 3
const MAX_REASON = 300

type Props = {
  open: boolean
  /** Clínica fixa (aba da clínica) ou lista para escolher (página global). */
  tenant?: { id: string; name: string }
  clinics?: AdminTenantRow[]
  onClose: () => void
  onCreated: (message: string) => void
}

/** Pedido de suporte (DEC-029, JRN-23): sem aprovação de uma owner ativa não há acesso, e a sessão é de leitura. */
export function RequestSupportDialog({ open, tenant, clinics, onClose, onCreated }: Props) {
  const api = useAdminApi()
  const [tenantId, setTenantId] = useState(tenant?.id ?? '')
  const [members, setMembers] = useState<AdminMember[] | null>(null)
  const [membersError, setMembersError] = useState(false)
  const [subject, setSubject] = useState('')
  const [reason, setReason] = useState('')
  const [touched, setTouched] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setTenantId(tenant?.id ?? '')
    setSubject('')
    setReason('')
    setTouched(false)
    setError(null)
  }, [open, tenant?.id])

  useEffect(() => {
    if (!open || !tenantId) {
      setMembers(null)
      return
    }
    const controller = new AbortController()
    setMembers(null)
    setMembersError(false)
    setSubject('')
    api
      .listMembers(tenantId, { signal: controller.signal })
      .then((m) => {
        if (!controller.signal.aborted) setMembers(m.filter((x) => x.status === 'active'))
      })
      .catch(() => {
        if (!controller.signal.aborted) setMembersError(true)
      })
    return () => controller.abort()
  }, [api, open, tenantId])

  if (!open) return null
  const trimmed = reason.trim()
  const tenantError = tenantId ? null : 'Escolha a clínica.'
  const subjectError = subject ? null : 'Escolha a pessoa em cujo contexto vai trabalhar.'
  const reasonError =
    trimmed.length < MIN_REASON
      ? `Escreva o motivo (pelo menos ${MIN_REASON} caracteres).`
      : trimmed.length > MAX_REASON
        ? `O motivo pode ter no máximo ${MAX_REASON} caracteres.`
        : null
  const tenantName = tenant?.name ?? clinics?.find((c) => c.id === tenantId)?.name ?? 'a clínica'

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setTouched(true)
    if (tenantError || subjectError || reasonError || busy) return
    setBusy(true)
    setError(null)
    try {
      await api.createSupportRequest({ tenantId, subjectClerkUserId: subject, reason: trimmed })
      onCreated(`Pedido enviado: uma owner de ${tenantName} tem de aprovar. Sem aprovação não há acesso.`)
    } catch (err) {
      setError(adminErrorMessage(err))
      setBusy(false)
    }
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
        <Dialog className="admin-dialog" aria-labelledby="admin-support-title">
          <form onSubmit={submit} noValidate>
            <Heading slot="title" id="admin-support-title" className="admin-dialog-title">
              Pedir suporte{tenant ? ` · ${tenant.name}` : ''}
            </Heading>
            <ul className="admin-dialog-list">
              <li>As owners da clínica recebem o pedido e decidem em até 24 horas.</li>
              <li>Depois de aprovado, a sessão dura no máximo 30 minutos e é só de leitura e diagnóstico.</li>
              <li>Ficam registados quem pediu, para quem e o motivo.</li>
            </ul>
            {!tenant ? (
              <label className="admin-field">
                Clínica
                <select
                  value={tenantId}
                  onChange={(e) => setTenantId(e.target.value)}
                  aria-invalid={touched && tenantError ? true : undefined}
                  disabled={busy}
                >
                  <option value="">Escolher…</option>
                  {(clinics ?? []).map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                {touched && tenantError ? <span className="admin-field-error" role="alert">{tenantError}</span> : null}
              </label>
            ) : null}
            <label className="admin-field">
              Em nome de
              <select
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                aria-invalid={touched && subjectError ? true : undefined}
                disabled={busy || !tenantId || members === null}
              >
                <option value="">{!tenantId ? 'Escolha primeiro a clínica' : members === null && !membersError ? 'Carregando…' : 'Escolher…'}</option>
                {(members ?? []).map((m) => (
                  <option key={m.clerkUserId} value={m.clerkUserId}>
                    {personLabel({ clerkUserId: m.clerkUserId, displayName: m.displayName, email: m.email })} ·{' '}
                    {m.role === 'owner' ? 'owner' : 'attendant'}
                  </option>
                ))}
              </select>
              {membersError ? <span className="admin-field-error" role="alert">Não foi possível carregar os membros.</span> : null}
              {members !== null && members.length === 0 ? (
                <span className="admin-field-error" role="alert">Esta clínica ainda não tem membros ativos.</span>
              ) : null}
              {touched && subjectError ? <span className="admin-field-error" role="alert">{subjectError}</span> : null}
            </label>
            <label className="admin-field">
              Motivo (fica na auditoria)
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={3}
                maxLength={MAX_REASON + 50}
                aria-invalid={touched && reasonError ? true : undefined}
                disabled={busy}
              />
              <span className="admin-field-meta">{trimmed.length}/{MAX_REASON}</span>
              {touched && reasonError ? <span className="admin-field-error" role="alert">{reasonError}</span> : null}
            </label>
            {error ? <p className="admin-dialog-error" role="alert">{error}</p> : null}
            <div className="admin-dialog-actions">
              <button type="submit" className="admin-btn admin-btn--primary" disabled={busy}>
                {busy ? 'Enviando…' : 'Enviar pedido'}
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
