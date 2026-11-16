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

export type AdminMember = AdminMembership & {
  /** Do Clerk; `null` se o Clerk não respondeu ou a conta não tem nome. */
  displayName: string | null
  email: string | null
}

export type HealthSituation = 'critical' | 'attention' | 'normal' | 'no_data' | 'inactive'

export type HealthAlert = {
  kind: string
  severity: 'info' | 'warning' | 'critical'
  reason: string
  value: number | null
  threshold: number | null
}

export type HealthCounts = {
  pendingOutbox: number | null
  failedOutbox: number | null
  uncertainOutbound: number | null
  llmJobsOpen: number | null
  llmJobsFailed1h: number | null
  schemaVersion: number | null
  schemaReady: boolean | null
}

/** Saúde de uma clínica lida do resumo gravado pelo cron (DEC-193): só contagens e estados. */
export type ClinicHealth = {
  tenantId: string
  name: string
  tenantStatus: AdminTenantStatus
  whatsapp: { status: ChannelStatus }
  situation: HealthSituation
  /** A última leitura falhou: os números são da última leitura boa. */
  stale: boolean
  alerts: HealthAlert[]
  readAt: number | null
  lastOkAt: number | null
  counts: HealthCounts | null
}

export type HealthOverview = {
  summaryAt: number | null
  refreshIntervalMs: number
  totals: {
    activeClinics: number
    critical: number
    attention: number
    normal: number
    noData: number
    unreachable: number
    llmJobsOpen: number
  }
  clinics: ClinicHealth[]
}

export type SupportState =
  | 'awaiting_owner'
  | 'approved'
  | 'active'
  | 'session_expired'
  | 'ended'
  | 'revoked'
  | 'rejected'
  | 'request_expired'
  | 'cancelled'

export type SupportPerson = { clerkUserId: string; displayName: string | null; email: string | null }

/** Pedido de suporte com a sessão, se houve (PA-05/PA-10): só metadados, nunca token nem conteúdo. */
export type SupportItem = {
  requestId: string
  tenantId: string
  tenantName: string
  actor: SupportPerson | null
  subject: SupportPerson | null
  decider: SupportPerson | null
  revokedBy: SupportPerson | null
  reason: string
  scope: string
  state: SupportState
  createdAt: number
  decidedAt: number | null
  expiresAt: number
  sessionId: string | null
  activatedAt: number | null
  endedAt: number | null
  durationMs: number | null
  remainingMs: number | null
}

export type AuditCategory = 'clinic' | 'members' | 'support' | 'email'
export type AuditOutcome = 'success' | 'denied' | 'conflict' | 'error'

export type AuditPerson = { clerkUserId: string; displayName: string | null; email: string | null }

/** Evento de auditoria central: ator, alvo, ação e resultado. Nunca texto de conversa (a auditoria não o guarda). */
export type AuditEvent = {
  id: string
  occurredAt: number
  action: string
  objectType: string
  objectId: string | null
  outcome: AuditOutcome | string
  actor: AuditPerson | null
  subject: AuditPerson | null
  tenantId: string | null
  tenantName: string | null
  supportSessionId: string | null
  metadata: Record<string, string | number | boolean | null>
}

export type AuditPage = { events: AuditEvent[]; nextCursor: string | null }

export type AuditQuery = { category?: AuditCategory; days?: 7 | 30 | 90; cursor?: string | null; limit?: number }

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
    getHealthOverview(opts?: FetchOpts): Promise<HealthOverview> {
      return request<HealthOverview>('/api/platform/health', {}, opts)
    },
    async getTenantHealth(tenantId: string, opts?: FetchOpts): Promise<ClinicHealth> {
      return (await request<{ health: ClinicHealth }>(`${tenantPath(tenantId)}/health`, {}, opts)).health
    },
    /** Relê o Durable Object desta clínica agora e grava o resumo. */
    async refreshTenantHealth(tenantId: string): Promise<ClinicHealth> {
      return (await request<{ health: ClinicHealth }>(`${tenantPath(tenantId)}/health/refresh`, { method: 'POST' })).health
    },
    /** `tenantId` ausente = atividade de toda a plataforma (visão geral). */
    listAudit(tenantId: string | null, query: AuditQuery = {}, opts?: FetchOpts): Promise<AuditPage> {
      const params = new URLSearchParams()
      if (query.category) params.set('category', query.category)
      if (query.days) params.set('days', String(query.days))
      if (query.cursor) params.set('cursor', query.cursor)
      if (query.limit) params.set('limit', String(query.limit))
      const qs = params.toString()
      const base = tenantId ? `${tenantPath(tenantId)}/audit` : '/api/platform/audit'
      return request<AuditPage>(qs ? `${base}?${qs}` : base, {}, opts)
    },
    async listSupport(opts?: FetchOpts): Promise<SupportItem[]> {
      return (await request<{ items: SupportItem[] }>('/api/platform/support', {}, opts)).items
    },
    async listTenantSupport(tenantId: string, opts?: FetchOpts): Promise<SupportItem[]> {
      return (await request<{ items: SupportItem[] }>(`${tenantPath(tenantId)}/support`, {}, opts)).items
    },
    /** DEC-029: cria o pedido `pending`; sem aprovação de uma owner não há acesso. */
    async createSupportRequest(input: { tenantId: string; subjectClerkUserId: string; reason: string }) {
      return request<{ request: { id: string }; emailsSent: number; accessGranted: false }>(
        '/api/platform/support-requests',
        { method: 'POST', body: JSON.stringify({ ...input, scope: 'read_diagnostics' }) },
      )
    },
    async listMembers(tenantId: string, opts?: FetchOpts): Promise<AdminMember[]> {
      return (await request<{ members: AdminMember[] }>(`${tenantPath(tenantId)}/members`, {}, opts)).members
    },
    removeOwner(tenantId: string, clerkUserId: string): Promise<unknown> {
      return request(`${tenantPath(tenantId)}/owners/${encodeURIComponent(clerkUserId)}`, { method: 'DELETE' })
    },
    replaceOwner(tenantId: string, fromClerkUserId: string, toClerkUserId: string): Promise<unknown> {
      return request(`${tenantPath(tenantId)}/owners/replace`, {
        method: 'POST',
        body: JSON.stringify({ fromClerkUserId, toClerkUserId }),
      })
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
    case 'no_active_owner':
      return 'Esta clínica ainda não tem owner ativa: ninguém pode aprovar o acesso.'
    case 'subject_not_member':
      return 'Esta pessoa já não é membro ativo da clínica. Escolha outra.'
    case 'verified_email_reader_unavailable':
      return 'Não foi possível confirmar os e-mails das owners agora. Tente de novo em instantes.'
    case 'invalid_body':
      return 'Faltam dados no pedido. Confira a clínica, a pessoa e o motivo.'
    case 'tenant_not_active':
      return 'A clínica não está ativa: não há leituras novas.'
    case 'last_owner_protected':
      return 'Não é possível remover a última owner ativa. Adicione ou substitua por outra primeiro.'
    case 'owner_not_found':
      return 'Esta pessoa já não é owner ativa. Atualize a página.'
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
