import { useCallback, useEffect, useState } from 'react'
import { adminErrorMessage, type AdminInvitation, type AdminTenantDetail, type InviteResult } from '../api'
import { AdminLoadError, AdminLoading, Pill } from '../AdminUi'
import {
  CHANNEL_LABEL,
  CHANNEL_TONE,
  STATE_LABEL,
  STATE_TONE,
  formatDate,
  tenantDisplayState,
} from '../format'
import { CLINICA_TABS, clinicaHref, navigateAdmin, type ClinicaTab } from '../routes'
import { useAdminApi } from '../useAdminApi'
import { EmptyState } from '../../panel/states/StatusScreens'
import { SaudeTab } from '../saude/SaudeTab'
import { MembrosTab } from './MembrosTab'
import { EditTenantDialog, LifecycleDialog, type LifecycleKind } from './LifecycleDialogs'

type Load =
  | { phase: 'loading' }
  | { phase: 'error' }
  | { phase: 'not-found' }
  | { phase: 'ready'; detail: AdminTenantDetail }

/** Cada aba chega com a sua issue do épico #827; até lá diz o que vem, sem dados inventados. */
const TAB_PENDING: Record<Exclude<ClinicaTab, 'resumo' | 'membros' | 'saude'>, { issue: string; text: string }> = {
  suporte: { issue: '#831', text: 'Pedidos e sessões de suporte desta clínica.' },
  auditoria: { issue: '#832', text: 'Eventos de auditoria desta clínica.' },
}

export function ClinicaDetalhe({ tenantId, tab }: { tenantId: string; tab: ClinicaTab }) {
  const api = useAdminApi()
  const [load, setLoad] = useState<Load>({ phase: 'loading' })
  const [attempt, setAttempt] = useState(0)
  const [dialog, setDialog] = useState<LifecycleKind | null>(null)
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [inviteEmail, setInviteEmail] = useState('')

  const reload = useCallback(() => setAttempt((n) => n + 1), [])

  useEffect(() => {
    const controller = new AbortController()
    setLoad((prev) => (prev.phase === 'ready' ? prev : { phase: 'loading' }))
    api
      .getTenant(tenantId, { signal: controller.signal })
      .then((detail) => {
        if (!controller.signal.aborted) setLoad({ phase: 'ready', detail })
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return
        const code = (err as { code?: string } | null)?.code
        setLoad({ phase: code === 'tenant_not_found' ? 'not-found' : 'error' })
      })
    return () => controller.abort()
  }, [api, tenantId, attempt])

  const run = useCallback(
    async (action: () => Promise<unknown>, done: () => void) => {
      setBusy(true)
      setActionError(null)
      try {
        await action()
        // O estado só muda na tela depois de a API responder (princípio 1): relê do servidor.
        done()
        reload()
      } catch (err) {
        setActionError(adminErrorMessage(err))
      } finally {
        setBusy(false)
      }
    },
    [reload],
  )

  if (load.phase === 'loading') return <AdminLoading label="Carregando a clínica…" />
  if (load.phase === 'error') return <AdminLoadError what="a clínica" onRetry={reload} />
  if (load.phase === 'not-found') {
    return (
      <EmptyState
        title="Clínica não encontrada"
        description="Ela não existe ou foi removida."
        actionLabel="Ver clínicas"
        onAction={() => navigateAdmin('/admin/clinicas')}
      />
    )
  }

  const { detail } = load
  const { tenant } = detail
  const activeOwners = detail.owners
  const activeMembers = detail.members.filter((m) => m.status === 'active')
  const state = tenantDisplayState({ status: tenant.status, ownerCount: activeOwners.length })
  const closeDialog = () => {
    if (!busy) {
      setDialog(null)
      setEditing(false)
      setActionError(null)
    }
  }
  const pendingInvites = detail.invitations.filter((i) => i.role === 'owner' && i.status === 'pending')
  const hasLiveInvite = pendingInvites.some((i) => !i.expired)
  const canInvite = tenant.status === 'active' && activeOwners.length === 0 && !hasLiveInvite
  const sentNotice = (r: InviteResult, verb: string) =>
    setNotice(
      r.emailSent
        ? `${verb} para ${r.invitation.email}.`
        : `${verb}, mas o e-mail não saiu. Tente reenviar em instantes.`,
    )
  const inviteAction = (call: () => Promise<InviteResult>, verb: string) =>
    void run(async () => {
      sentNotice(await call(), verb)
    }, () => setInviteEmail(''))
  const cancelInvite = (inv: AdminInvitation) =>
    void run(
      async () => {
        await api.cancelInvitation(tenant.id, inv.id)
        setNotice(`Convite para ${inv.email} cancelado.`)
      },
      () => undefined,
    )
  const confirm = (reason: string) => {
    if (!dialog) return
    const call =
      dialog === 'suspend'
        ? () => api.suspendTenant(tenant.id, reason)
        : dialog === 'reactivate'
          ? () => api.reactivateTenant(tenant.id, reason)
          : () => api.deleteTenant(tenant.id, reason)
    void run(call, () => setDialog(null))
  }

  return (
    <>
      <a
        className="admin-back"
        href="/admin/clinicas"
        onClick={(e) => {
          if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return
          e.preventDefault()
          navigateAdmin('/admin/clinicas')
        }}
      >
        ‹ Clínicas
      </a>
      <div className="admin-page-header">
        <div className="admin-page-title">
          <div className="admin-title-row">
            <h1>{tenant.name}</h1>
            <Pill tone={STATE_TONE[state]}>{STATE_LABEL[state]}</Pill>
          </div>
          <span className="admin-muted">
            Criada em {formatDate(tenant.createdAt)} · {tenant.timezone} · id {tenant.id}
          </span>
        </div>
        <div className="admin-page-actions">
          {tenant.status === 'active' ? (
            <button type="button" className="admin-btn" onClick={() => setDialog('suspend')}>
              Suspender
            </button>
          ) : null}
          {tenant.status === 'suspended' ? (
            <button type="button" className="admin-btn" onClick={() => setDialog('reactivate')}>
              Reativar
            </button>
          ) : null}
          {tenant.status !== 'pending_deletion' ? (
            <button type="button" className="admin-btn admin-btn--danger" onClick={() => setDialog('delete')}>
              Excluir
            </button>
          ) : null}
        </div>
      </div>

      <nav className="admin-tabs" aria-label="Seções da clínica">
        {CLINICA_TABS.map(({ tab: t, label }) => {
          const href = clinicaHref(tenant.id, t)
          return (
            <a
              key={t}
              href={href}
              aria-current={t === tab ? 'page' : undefined}
              onClick={(e) => {
                if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return
                e.preventDefault()
                navigateAdmin(href)
              }}
            >
              {label}
              {t === 'membros' ? ` ${activeMembers.length}` : ''}
            </a>
          )
        })}
      </nav>

      {tenant.status === 'pending_deletion' ? (
        <div className="admin-note admin-note--bad" role="status">
          <span>
            <strong>Exclusão pendente</strong>
            {tenant.pendingDeletionAt ? ` desde ${formatDate(tenant.pendingDeletionAt)}` : ''}. A clínica está
            bloqueada e aguarda a retenção.
          </span>
        </div>
      ) : null}

      {tab === 'resumo' ? (
        <div className="admin-grid">
          <section className="admin-card" aria-labelledby="adm-dados">
            <h2 id="adm-dados" className="admin-card-title">Dados</h2>
            <dl className="admin-kv">
              <dt>Nome</dt>
              <dd>{tenant.name}</dd>
              <dt>Fuso</dt>
              <dd>{tenant.timezone}</dd>
              <dt>Estado</dt>
              <dd><Pill tone={STATE_TONE[state]}>{STATE_LABEL[state]}</Pill></dd>
            </dl>
            {tenant.status !== 'pending_deletion' ? (
              <div>
                <button type="button" className="admin-btn admin-btn--sm" onClick={() => setEditing(true)}>
                  Editar
                </button>
              </div>
            ) : null}
          </section>

          <section className="admin-card" aria-labelledby="adm-integr">
            <h2 id="adm-integr" className="admin-card-title">Integrações</h2>
            <dl className="admin-kv">
              <dt>WhatsApp</dt>
              <dd>
                <Pill tone={CHANNEL_TONE[detail.integration.whatsapp.status]}>
                  {CHANNEL_LABEL[detail.integration.whatsapp.status]}
                </Pill>
                <span className="admin-muted admin-block">{detail.integration.whatsapp.note}</span>
              </dd>
              <dt>Pix (Woovi)</dt>
              <dd>
                <Pill tone={CHANNEL_TONE[detail.integration.pix.status]}>
                  {CHANNEL_LABEL[detail.integration.pix.status]}
                </Pill>
              </dd>
            </dl>
          </section>

          <section className="admin-card admin-card--wide" aria-labelledby="adm-owners">
            <h2 id="adm-owners" className="admin-card-title">Owners</h2>
            {activeOwners.length === 0 ? (
              <p className="admin-muted">
                Esta clínica ainda não tem owner ativa{pendingInvites.length ? ' (convite em curso)' : ''}.
              </p>
            ) : (
              <div className="admin-table-scroll">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th scope="col">Conta</th>
                      <th scope="col">Papel</th>
                      <th scope="col">Desde</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activeOwners.map((o) => (
                      <tr key={o.clerkUserId}>
                        <th scope="row"><code>{o.clerkUserId}</code></th>
                        <td><Pill tone="info">Owner</Pill></td>
                        <td>{formatDate(o.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {pendingInvites.map((inv) => (
              <div key={inv.id} className="admin-invite-row">
                <span className="admin-invite-info">
                  <strong>{inv.email}</strong>
                  <span className="admin-muted">
                    {inv.expired
                      ? `Convite expirado em ${formatDate(inv.expiresAt)}`
                      : `Convite pendente · expira em ${formatDate(inv.expiresAt)}`}
                  </span>
                </span>
                <Pill tone={inv.expired ? 'bad' : 'warn'}>{inv.expired ? 'Expirado' : 'Pendente'}</Pill>
                {inv.expired ? (
                  <button
                    type="button"
                    className="admin-btn admin-btn--sm"
                    disabled={busy}
                    onClick={() => inviteAction(() => api.inviteOwner(tenant.id, inv.email), 'Novo convite enviado')}
                  >
                    Emitir novo convite
                  </button>
                ) : (
                  <>
                    <button
                      type="button"
                      className="admin-btn admin-btn--sm"
                      disabled={busy}
                      onClick={() => inviteAction(() => api.resendInvitation(tenant.id, inv.id), 'Convite reenviado')}
                    >
                      Reenviar
                    </button>
                    <button
                      type="button"
                      className="admin-btn admin-btn--sm admin-btn--danger"
                      disabled={busy}
                      onClick={() => cancelInvite(inv)}
                    >
                      Cancelar convite
                    </button>
                  </>
                )}
              </div>
            ))}
            {canInvite ? (
              <form
                className="admin-invite-row"
                onSubmit={(e) => {
                  e.preventDefault()
                  if (!inviteEmail.trim() || busy) return
                  inviteAction(() => api.inviteOwner(tenant.id, inviteEmail.trim()), 'Convite enviado')
                }}
              >
                <label className="admin-field admin-invite-info">
                  E-mail da owner
                  <input
                    type="email"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    autoComplete="off"
                    disabled={busy}
                  />
                </label>
                <button type="submit" className="admin-btn admin-btn--sm admin-btn--primary" disabled={busy}>
                  Convidar owner
                </button>
              </form>
            ) : null}
            {notice ? <p className="admin-muted" role="status">{notice}</p> : null}
            {actionError && !dialog && !editing ? (
              <p className="admin-dialog-error" role="alert">{actionError}</p>
            ) : null}
            <span className="admin-muted">
              Nomes e a gestão de owners estão na aba Membros. Attendants são geridos pela owner na Equipe da clínica.
            </span>
          </section>
        </div>
      ) : tab === 'membros' ? (
        <MembrosTab
          tenantId={tenant.id}
          tenantName={tenant.name}
          tenantStatus={tenant.status}
          invitations={detail.invitations}
          onChanged={reload}
        />
      ) : tab === 'saude' ? (
        <SaudeTab tenantId={tenant.id} tenantStatus={tenant.status} whatsapp={detail.integration.whatsapp} />
      ) : (
        <section className="admin-card" aria-labelledby="adm-tab-pending">
          <h2 id="adm-tab-pending" className="admin-card-title">
            {CLINICA_TABS.find((x) => x.tab === tab)?.label}
          </h2>
          <p>{TAB_PENDING[tab as Exclude<ClinicaTab, 'resumo' | 'membros' | 'saude'>].text}</p>
          <p className="admin-muted">
            Esta aba chega com a issue {TAB_PENDING[tab as Exclude<ClinicaTab, 'resumo' | 'membros' | 'saude'>].issue} do épico #827.
          </p>
        </section>
      )}

      <LifecycleDialog
        kind={dialog}
        tenantName={tenant.name}
        busy={busy}
        error={dialog ? actionError : null}
        onClose={closeDialog}
        onConfirm={confirm}
      />
      <EditTenantDialog
        open={editing}
        initial={{ name: tenant.name, timezone: tenant.timezone }}
        busy={busy}
        error={editing ? actionError : null}
        onClose={closeDialog}
        onSave={(patch) => void run(() => api.updateTenant(tenant.id, patch), () => setEditing(false))}
      />
    </>
  )
}
