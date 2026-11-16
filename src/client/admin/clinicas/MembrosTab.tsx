import { useCallback, useEffect, useMemo, useState } from 'react'
import { adminErrorMessage, type AdminInvitation, type AdminMember, type AdminTenantStatus } from '../api'
import { AdminLoadError, AdminLoading, Pill } from '../AdminUi'
import { formatDate } from '../format'
import { useAdminApi } from '../useAdminApi'
import { OwnerDialog, memberLabel, type OwnerDialogState } from './OwnerDialogs'

type Filter = 'active' | 'revoked' | 'all'
type Load = { phase: 'loading' } | { phase: 'error' } | { phase: 'ready'; members: AdminMember[] }

type Props = {
  tenantId: string
  tenantName: string
  tenantStatus: AdminTenantStatus
  invitations: AdminInvitation[]
  /** Pede ao detalhe para reler (o contador da aba e o Resumo dependem dele). */
  onChanged: () => void
}

/** Aba Membros (PA-08): a Platform Admin só gere owners (DEC-018, DEC-103). */
export function MembrosTab({ tenantId, tenantName, tenantStatus, invitations, onChanged }: Props) {
  const api = useAdminApi()
  const [load, setLoad] = useState<Load>({ phase: 'loading' })
  const [attempt, setAttempt] = useState(0)
  const [filter, setFilter] = useState<Filter>('active')
  const [dialog, setDialog] = useState<OwnerDialogState>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    setLoad((prev) => (prev.phase === 'ready' ? prev : { phase: 'loading' }))
    api
      .listMembers(tenantId, { signal: controller.signal })
      .then((members) => {
        if (!controller.signal.aborted) setLoad({ phase: 'ready', members })
      })
      .catch(() => {
        if (!controller.signal.aborted) setLoad({ phase: 'error' })
      })
    return () => controller.abort()
  }, [api, tenantId, attempt])

  const members = load.phase === 'ready' ? load.members : []
  const active = useMemo(() => members.filter((m) => m.status === 'active'), [members])
  const revoked = useMemo(() => members.filter((m) => m.status === 'revoked'), [members])
  const activeOwners = active.filter((m) => m.role === 'owner')
  const attendants = active.filter((m) => m.role === 'attendant')
  const liveInvites = invitations.filter((i) => i.role === 'owner' && i.status === 'pending')
  const canManage = tenantStatus !== 'pending_deletion'
  const lastOwner = activeOwners.length <= 1

  const visible = filter === 'active' ? active : filter === 'revoked' ? revoked : members

  const run = useCallback(
    async (call: () => Promise<string | void>, message: string) => {
      setBusy(true)
      setError(null)
      try {
        const override = await call()
        setDialog(null)
        setNotice(override || message)
        setAttempt((n) => n + 1)
        onChanged()
      } catch (err) {
        setError(adminErrorMessage(err))
      } finally {
        setBusy(false)
      }
    },
    [onChanged],
  )

  if (load.phase === 'loading') return <AdminLoading label="Carregando os membros…" />
  if (load.phase === 'error') {
    return <AdminLoadError what="os membros" onRetry={() => setAttempt((n) => n + 1)} />
  }

  const close = () => {
    if (!busy) {
      setDialog(null)
      setError(null)
    }
  }

  return (
    <>
      <div className="admin-toolbar">
        <div className="admin-seg" role="group" aria-label="Estado dos membros">
          {(
            [
              ['active', `Ativos ${active.length}`],
              ['revoked', `Revogados ${revoked.length}`],
              ['all', `Todos ${members.length}`],
            ] as const
          ).map(([id, label]) => (
            <button key={id} type="button" aria-pressed={filter === id} onClick={() => setFilter(id)}>
              {label}
            </button>
          ))}
        </div>
        <span className="admin-toolbar-spacer" />
        {tenantStatus === 'active' ? (
          <button type="button" className="admin-btn" onClick={() => setDialog({ kind: 'add' })}>
            Adicionar owner
          </button>
        ) : null}
      </div>

      <div className="admin-card admin-card--flush">
        <div className="admin-table-scroll">
          <table className="admin-table">
            <thead>
              <tr>
                <th scope="col">Pessoa</th>
                <th scope="col">Papel</th>
                <th scope="col">Estado</th>
                <th scope="col">Entrou em</th>
                <th scope="col"><span className="admin-visually-hidden">Ações</span></th>
              </tr>
            </thead>
            <tbody>
              {filter !== 'revoked'
                ? liveInvites.map((inv) => (
                    <tr key={inv.id}>
                      <th scope="row">
                        {inv.email}
                        <span className="admin-muted admin-block">Ainda não aceitou</span>
                      </th>
                      <td><Pill tone="info">Owner</Pill></td>
                      <td>
                        <Pill tone={inv.expired ? 'bad' : 'warn'}>{inv.expired ? 'Convite expirado' : 'Convite enviado'}</Pill>
                      </td>
                      <td>{formatDate(inv.issuedAt)}</td>
                      <td />
                    </tr>
                  ))
                : null}
              {visible.length === 0 && (filter === 'revoked' || liveInvites.length === 0) ? (
                <tr>
                  <td colSpan={5} className="admin-muted">
                    {filter === 'revoked' ? 'Nenhum membro revogado.' : 'Esta clínica ainda não tem membros.'}
                  </td>
                </tr>
              ) : null}
              {visible.map((m) => (
                <tr key={`${m.clerkUserId}-${m.status}-${m.createdAt}`}>
                  <th scope="row">
                    {m.displayName || m.email ? (
                      <>
                        {m.displayName ?? m.email}
                        {m.displayName && m.email ? <span className="admin-muted admin-block">{m.email}</span> : null}
                      </>
                    ) : (
                      <>
                        <code>{m.clerkUserId}</code>
                        <span className="admin-muted admin-block">Nome indisponível</span>
                      </>
                    )}
                  </th>
                  <td><Pill tone={m.role === 'owner' ? 'info' : 'neutral'}>{m.role === 'owner' ? 'Owner' : 'Attendant'}</Pill></td>
                  <td><Pill tone={m.status === 'active' ? 'ok' : 'neutral'}>{m.status === 'active' ? 'Ativo' : 'Revogado'}</Pill></td>
                  <td>{formatDate(m.createdAt)}</td>
                  <td className="admin-actions-cell">
                    {m.role === 'owner' && m.status === 'active' && canManage ? (
                      <>
                        <button
                          type="button"
                          className="admin-btn admin-btn--sm"
                          disabled={attendants.length === 0}
                          title={attendants.length === 0 ? 'Não há attendants para promover' : undefined}
                          onClick={() => setDialog({ kind: 'replace', owner: m })}
                        >
                          Substituir
                        </button>
                        <button
                          type="button"
                          className="admin-btn admin-btn--sm admin-btn--danger"
                          disabled={lastOwner}
                          title={lastOwner ? 'Última owner ativa: não pode ser removida' : undefined}
                          onClick={() => setDialog({ kind: 'remove', owner: m })}
                        >
                          Remover
                        </button>
                      </>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {notice ? <p className="admin-muted" role="status">{notice}</p> : null}
      {!dialog && error ? <p className="admin-dialog-error" role="alert">{error}</p> : null}
      <span className="admin-muted">
        Attendants são geridos pela owner na Equipe da clínica (DEC-103). Remover fica bloqueado quando é a última owner
        ativa.
      </span>

      <OwnerDialog
        state={dialog}
        tenantName={tenantName}
        candidates={attendants}
        busy={busy}
        error={dialog ? error : null}
        onClose={close}
        onAdd={(email) =>
          void run(async () => {
            const r = await api.inviteOwner(tenantId, email)
            // O convite já existe; se o e-mail não saiu, diz-se e reenvia-se no Resumo.
            return r.emailSent
              ? `Convite enviado para ${r.invitation.email}.`
              : 'Convite criado, mas o e-mail não saiu. Reenvie no Resumo.'
          }, 'Convite enviado.')
        }
        onRemove={(owner) => void run(async () => {
            await api.removeOwner(tenantId, owner.clerkUserId)
          }, `${memberLabel(owner)} deixou de ser owner.`)}
        onReplace={(owner, to) =>
          void run(
            async () => {
              await api.replaceOwner(tenantId, owner.clerkUserId, to)
            },
            `${memberLabel(owner)} deixou de ser owner e a nova owner foi promovida.`,
          )
        }
      />
    </>
  )
}
