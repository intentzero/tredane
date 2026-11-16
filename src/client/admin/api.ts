/** Cliente HTTP da Platform Admin (#829): só rotas `/api/platform/*`, Bearer do utilizador atual. */
import { PanelApiError, type ApiErrorCode, type TokenGetter } from '../panel/api'

export type AdminTenantStatus = 'active' | 'suspended' | 'pending_deletion'
export type ChannelStatus = 'not_connected' | 'pending' | 'connected' | 'error' | 'not_configured'

export type AdminTenantRow = {
  id: string
  name: string
  timezone: string
  status: AdminTenantStatus
  createdAt: number
  updatedAt: number
  suspendedAt: number | null
  pendingDeletionAt: number | null
  ownerCount: number
  memberCount: number
  whatsapp: { status: ChannelStatus }
}

export type AdminTenant = Omit<AdminTenantRow, 'ownerCount' | 'memberCount' | 'whatsapp'>

export type AdminMembership = {
  tenantId: string
  clerkUserId: string
  role: 'owner' | 'attendant'
  status: 'active' | 'revoked'
  createdAt: number
  revokedAt: number | null
}

export type AdminInvitation = {
  id: string
  email: string
  role: 'owner' | 'attendant'
  status: 'pending' | 'accepted' | 'cancelled' | 'expired'
  issuedAt: number
  expiresAt: number
  lastResentAt: number | null
  /** Pendente com prazo vencido: o link já não serve; falta emitir um novo. */
  expired: boolean
}

export type InviteResult = { invitation: AdminInvitation; emailSent: boolean }

export type AdminTenantDetail = {
  tenant: AdminTenant
  members: AdminMembership[]
  owners: AdminMembership[]
  integration: {
    whatsapp: { status: ChannelStatus; note: string }
    pix: { status: ChannelStatus; note: string }
  }
  deletionCommand: { id: string; status: string; requestedAt: number } | null
  invitations: AdminInvitation[]
  clinicalAccess: false
}

type FetchOpts = { signal?: AbortSignal }

export function createAdminApi(getToken: TokenGetter) {
  async function request<T>(path: string, init: RequestInit = {}, opts?: FetchOpts): Promise<T> {
    const token = await getToken()
    if (!token) throw new PanelApiError(401, 'unauthenticated')
    const headers = new Headers(init.headers)
    headers.set('Authorization', `Bearer ${token}`)
    headers.set('Accept', 'application/json')
    if (init.body) headers.set('Content-Type', 'application/json')
    let res: Response
    try {
      res = await fetch(path, { ...init, headers, signal: opts?.signal, credentials: 'same-origin' })
    } catch (err) {
      if (opts?.signal?.aborted) throw err
      throw new PanelApiError(0, 'network', err instanceof Error ? err.message : 'network')
    }
    if (!res.ok) {
      let code: ApiErrorCode = 'unknown'
      try {
        const body: unknown = await res.json()
        if (body && typeof body === 'object' && 'error' in body && typeof body.error === 'string') {
          code = body.error as ApiErrorCode
        }
      } catch {
        /* corpo vazio */
      }
      if (res.status === 401 && code === 'unknown') code = 'unauthenticated'
      if (res.status === 403 && code === 'unknown') code = 'permission_denied'
      throw new PanelApiError(res.status, code)
    }
    return (await res.json()) as T
  }

  const tenantPath = (id: string) => `/api/platform/tenants/${encodeURIComponent(id)}`
  const withReason = (reason: string) => ({ method: 'POST', body: JSON.stringify({ reason }) })

  return {
    async listTenants(opts?: FetchOpts): Promise<AdminTenantRow[]> {
      return (await request<{ tenants: AdminTenantRow[] }>('/api/platform/tenants', {}, opts)).tenants
    },
    getTenant(id: string, opts?: FetchOpts): Promise<AdminTenantDetail> {
      return request<AdminTenantDetail>(tenantPath(id), {}, opts)
    },
    async updateTenant(id: string, patch: { name?: string; timezone?: string }): Promise<AdminTenant> {
      return (
        await request<{ tenant: AdminTenant }>(tenantPath(id), { method: 'PATCH', body: JSON.stringify(patch) })
      ).tenant
    },
    /** DEC-194: cria a clínica sem owner ativa e convida a primeira owner por e-mail. */
    createTenantWithOwnerInvite(input: {
      name: string
      timezone: string
      ownerEmail: string
    }): Promise<{ tenant: AdminTenant } & InviteResult> {
      return request('/api/platform/tenants', { method: 'POST', body: JSON.stringify(input) })
    },
    inviteOwner(tenantId: string, email: string): Promise<InviteResult> {
      return request(`${tenantPath(tenantId)}/invitations`, { method: 'POST', body: JSON.stringify({ email }) })
    },
    resendInvitation(tenantId: string, invitationId: string): Promise<InviteResult> {
      return request(`${tenantPath(tenantId)}/invitations/${encodeURIComponent(invitationId)}/resend`, {
        method: 'POST',
      })
    },
    async cancelInvitation(tenantId: string, invitationId: string): Promise<AdminInvitation> {
      return (
        await request<{ invitation: AdminInvitation }>(
          `${tenantPath(tenantId)}/invitations/${encodeURIComponent(invitationId)}/cancel`,
          { method: 'POST' },
        )
      ).invitation
    },
    async suspendTenant(id: string, reason: string): Promise<AdminTenant> {
      return (await request<{ tenant: AdminTenant }>(`${tenantPath(id)}/suspend`, withReason(reason))).tenant
    },
    async reactivateTenant(id: string, reason: string): Promise<AdminTenant> {
      return (await request<{ tenant: AdminTenant }>(`${tenantPath(id)}/reactivate`, withReason(reason))).tenant
    },
    async deleteTenant(id: string, reason: string): Promise<AdminTenant> {
      return (
        await request<{ tenant: AdminTenant }>(tenantPath(id), {
          method: 'DELETE',
          body: JSON.stringify({ reason }),
        })
      ).tenant
    },
  }
}

export type AdminApi = ReturnType<typeof createAdminApi>

/** Frases para o operador; o código técnico nunca é a mensagem (UX do painel, princípio de estado real). */
export function adminErrorMessage(err: unknown): string {
  const code = (err as { code?: string } | null)?.code
  switch (code) {
    case 'network':
      return 'Sem ligação com o servidor. Verifique a internet e tente de novo.'
    case 'tenant_status_conflict':
      return 'O estado da clínica mudou entretanto. Atualize a página e confira.'
    case 'tenant_not_found':
      return 'Esta clínica já não existe.'
    case 'owner_email_invalid':
      return 'Escreva um e-mail completo, como nome@clinica.com.br.'
    case 'invitation_already_pending':
      return 'Já existe um convite pendente para este e-mail.'
    case 'invitation_resend_cooldown':
      return 'Aguarde 10 minutos para reenviar este convite.'
    case 'invitation_resend_quota':
      return 'Limite de reenvios atingido. Tente de novo mais tarde.'
    case 'invitation_expired':
      return 'O convite expirou. Emita um convite novo.'
    case 'invitation_not_pending':
      return 'Este convite já não está pendente. Atualize a página.'
    case 'reason_too_long':
      return 'O motivo tem mais de 300 caracteres.'
    case 'permission_denied':
    case 'superadmin_required':
      return 'Sem permissão para esta ação.'
    default:
      return 'Não foi possível concluir. Tente de novo.'
  }
}
