/** Cliente HTTP do painel — Bearer + cancelamento por geração de tenant (#22). */
import { parseReplyOutput } from '../../ai/reply-output'

/**
 * Defesa no cliente: sugestões antigas (gravadas antes da correção) podem ter
 * JSON cru do modelo. Extrai só a «mensagem»; sem nada utilizável → «failed»
 * (o painel mostra o erro amigável), nunca chaves nem notas internas.
 */
export function sanitizeAiSuggestion<T extends AiSuggestion | null | undefined>(s: T): T {
  if (!s || s.kind !== 'reply' || !s.suggestedText) return s
  if (!/[{}]|```/.test(s.suggestedText)) return s
  const parsed = parseReplyOutput(s.suggestedText)
  if (!parsed.message) return { ...s, status: 'failed', suggestedText: '' }
  return { ...s, suggestedText: parsed.message }
}

export type AuthMode = 'synthetic' | 'clerk'

export type ClientAuthConfig = {
  authMode: AuthMode
  clerkPublishableKey: string | null
}

export type MeResponse = {
  kind: string
  clerkUserId: string
  sessionId: string
  isSuperadmin: boolean
}

export type TenantSummary = {
  tenantId: string
  name: string
  role: 'owner' | 'attendant'
  status: 'active'
}

export type TenantContextResponse = {
  tenantId: string
  name: string
  status: 'active'
  role: 'owner' | 'attendant'
}

export type ApiErrorCode =
  | 'unauthenticated'
  | 'session_expired'
  | 'tenant_access_denied'
  | 'permission_denied'
  | 'forged_role_rejected'
  | 'tenant_not_active'
  | 'network'
  | 'unknown'

export class PanelApiError extends Error {
  readonly status: number
  readonly code: ApiErrorCode

  constructor(status: number, code: ApiErrorCode, message?: string) {
    super(message ?? code)
    this.name = 'PanelApiError'
    this.status = status
    this.code = code
  }
}

export type TokenGetter = () => Promise<string | null>

type FetchOpts = {
  signal?: AbortSignal
  /** Geração do tenant ativo — resposta tardia de outra clínica é descartada. */
  generation?: number
  expectGeneration?: () => number
}

async function parseError(res: Response): Promise<PanelApiError> {
  let code: ApiErrorCode = 'unknown'
  try {
    const body: unknown = await res.json()
    if (body && typeof body === 'object' && 'error' in body && typeof body.error === 'string') {
      code = body.error as ApiErrorCode
    }
  } catch {
    /* ignore */
  }
  if (res.status === 401 && code === 'unknown') code = 'unauthenticated'
  if (res.status === 403 && code === 'unknown') code = 'permission_denied'
  return new PanelApiError(res.status, code)
}

function assertGeneration(opts?: FetchOpts): void {
  if (
    opts?.generation !== undefined &&
    opts.expectGeneration &&
    opts.expectGeneration() !== opts.generation
  ) {
    throw new PanelApiError(0, 'network', 'stale_tenant_response')
  }
}

export async function fetchClientAuthConfig(signal?: AbortSignal): Promise<ClientAuthConfig> {
  const res = await fetch('/api/auth/client-config', { signal, credentials: 'same-origin' })
  if (!res.ok) throw await parseError(res)
  const data: unknown = await res.json()
  if (
    !data ||
    typeof data !== 'object' ||
    !('authMode' in data) ||
    (data.authMode !== 'synthetic' && data.authMode !== 'clerk')
  ) {
    throw new PanelApiError(500, 'unknown', 'client_config_invalid')
  }
  const key =
    'clerkPublishableKey' in data && typeof data.clerkPublishableKey === 'string'
      ? data.clerkPublishableKey
      : null
  return { authMode: data.authMode, clerkPublishableKey: key }
}

export function createPanelApi(getToken: TokenGetter) {
  async function authFetch(path: string, init: RequestInit = {}, opts?: FetchOpts): Promise<Response> {
    const token = await getToken()
    if (!token) throw new PanelApiError(401, 'unauthenticated')
    const headers = new Headers(init.headers)
    headers.set('Authorization', `Bearer ${token}`)
    headers.set('Accept', 'application/json')
    try {
      const res = await fetch(path, {
        ...init,
        headers,
        signal: opts?.signal,
        credentials: 'same-origin',
      })
      assertGeneration(opts)
      return res
    } catch (err) {
      if (err instanceof PanelApiError) throw err
      if (opts?.signal?.aborted) throw err
      throw new PanelApiError(0, 'network', err instanceof Error ? err.message : 'network')
    }
  }

  async function holdJson<T>(path: string, body: unknown, opts?: FetchOpts): Promise<T> {
    const res = await authFetch(
      path,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
      opts,
    )
    assertGeneration(opts)
    if (!res.ok) throw await parseError(res)
    return (await res.json()) as T
  }

  return {
    async getPushVapidPublicKey(opts?: FetchOpts): Promise<{
      publicKey: string | null
      mode: string
      supported: boolean
    }> {
      const res = await authFetch('/api/push/vapid-public-key', {}, opts)
      assertGeneration(opts)
      if (!res.ok) throw await parseError(res)
      return (await res.json()) as {
        publicKey: string | null
        mode: string
        supported: boolean
      }
    },

    async subscribePush(
      tenantId: string,
      body: {
        subscription: {
          endpoint: string
          expirationTime?: number | null
          keys: { p256dh: string; auth: string }
        }
        notifyNewConversation?: boolean
      },
      opts?: FetchOpts,
    ): Promise<{ subscription: { id: string; endpoint: string; notifyNewConversation: boolean } }> {
      const res = await authFetch(
        `/api/tenants/${encodeURIComponent(tenantId)}/push/subscriptions`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
        opts,
      )
      assertGeneration(opts)
      if (!res.ok) throw await parseError(res)
      return (await res.json()) as {
        subscription: { id: string; endpoint: string; notifyNewConversation: boolean }
      }
    },

    async unsubscribePush(
      tenantId: string,
      endpoint: string,
      opts?: FetchOpts,
    ): Promise<{ removed: boolean }> {
      const res = await authFetch(
        `/api/tenants/${encodeURIComponent(tenantId)}/push/subscriptions`,
        {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint }),
        },
        opts,
      )
      assertGeneration(opts)
      if (!res.ok) throw await parseError(res)
      return (await res.json()) as { removed: boolean }
    },

    /** Bilhete curto (uso único) para o WebSocket do inbox — o browser não envia Authorization no upgrade. */
    async getRealtimeTicket(
      tenantId: string,
      opts?: FetchOpts,
    ): Promise<{ ticket: string; expiresAt: number }> {
      const res = await authFetch(
        `/api/tenants/${encodeURIComponent(tenantId)}/realtime/ticket`,
        { method: 'POST' },
        opts,
      )
      assertGeneration(opts)
      if (!res.ok) throw await parseError(res)
      return (await res.json()) as { ticket: string; expiresAt: number }
    },

    async getMe(opts?: FetchOpts): Promise<MeResponse> {
      const res = await authFetch('/api/me', {}, opts)
      assertGeneration(opts)
      if (!res.ok) throw await parseError(res)
      return (await res.json()) as MeResponse
    },

    async listTenants(opts?: FetchOpts): Promise<TenantSummary[]> {
      const res = await authFetch('/api/me/tenants', {}, opts)
      assertGeneration(opts)
      if (!res.ok) throw await parseError(res)
      const body = (await res.json()) as { tenants: TenantSummary[] }
      assertGeneration(opts)
      return body.tenants
    },

    async getTenantContext(tenantId: string, opts?: FetchOpts): Promise<TenantContextResponse> {
      const res = await authFetch(`/api/tenants/${encodeURIComponent(tenantId)}/context`, {}, opts)
      assertGeneration(opts)
      if (!res.ok) throw await parseError(res)
      const body = (await res.json()) as TenantContextResponse
      assertGeneration(opts)
      return body
    },

    async getClinicConfig(tenantId: string, opts?: FetchOpts): Promise<ClinicConfigSnapshot> {
      const res = await authFetch(
        `/api/tenants/${encodeURIComponent(tenantId)}/config`,
        {},
        opts,
      )
      assertGeneration(opts)
      if (!res.ok) throw await parseError(res)
      const body = (await res.json()) as ClinicConfigSnapshot
      assertGeneration(opts)
      return body
    },

    async getWhatsappConnection(
      tenantId: string,
      opts?: FetchOpts,
    ): Promise<WhatsappConnection> {
      const res = await authFetch(
        `/api/tenants/${encodeURIComponent(tenantId)}/whatsapp`,
        {},
        opts,
      )
      assertGeneration(opts)
      if (!res.ok) throw await parseError(res)
      const body = (await res.json()) as WhatsappConnection
      assertGeneration(opts)
      return body
    },

    async startWhatsappSession(
      tenantId: string,
      purpose: WhatsappSignupPurpose,
      opts?: FetchOpts,
    ): Promise<WhatsappSignupSession> {
      const res = await authFetch(
        `/api/tenants/${encodeURIComponent(tenantId)}/whatsapp/session`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ purpose }),
        },
        opts,
      )
      assertGeneration(opts)
      if (!res.ok) throw await parseError(res)
      return (await res.json()) as WhatsappSignupSession
    },

    async completeWhatsappSignup(
      tenantId: string,
      body: WhatsappCompleteBody,
      opts?: FetchOpts,
    ): Promise<WhatsappConnection> {
      const res = await authFetch(
        `/api/tenants/${encodeURIComponent(tenantId)}/whatsapp/complete`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
        opts,
      )
      assertGeneration(opts)
      if (!res.ok) throw await parseError(res)
      return (await res.json()) as WhatsappConnection
    },

    async disconnectWhatsapp(
      tenantId: string,
      clinicNameConfirmation: string,
      opts?: FetchOpts,
    ): Promise<WhatsappConnection> {
      const res = await authFetch(
        `/api/tenants/${encodeURIComponent(tenantId)}/whatsapp/disconnect`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ clinicNameConfirmation }),
        },
        opts,
      )
      assertGeneration(opts)
      if (!res.ok) throw await parseError(res)
      return (await res.json()) as WhatsappConnection
    },

    /** STAGING-ONLY: devolve status + corpo JSON sem lançar (a tela mostra o resultado). */
    async devSyncExistingWhatsappBinding(
      tenantId: string,
      opts?: FetchOpts,
    ): Promise<{ status: number; body: unknown }> {
      const res = await authFetch(
        `/api/tenants/${encodeURIComponent(tenantId)}/whatsapp/dev/sync-existing-binding`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
        },
        opts,
      )
      assertGeneration(opts)
      const body: unknown = await res.json().catch(() => null)
      return { status: res.status, body }
    },

    /** STAGING-ONLY: apaga dados operacionais da clínica (servidor 404 fora de staging). */
    async resetClinicOperationalData(
      tenantId: string,
      confirmName: string,
      opts?: FetchOpts,
    ): Promise<{ status: number; body: unknown }> {
      const res = await authFetch(
        `/api/tenants/${encodeURIComponent(tenantId)}/staging/reset-operational-data`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ confirmName }),
        },
        opts,
      )
      assertGeneration(opts)
      const body: unknown = await res.json().catch(() => null)
      return { status: res.status, body }
    },

    async interruptWhatsappDev(
      tenantId: string,
      reason?: string,
      opts?: FetchOpts,
    ): Promise<WhatsappConnection> {
      const res = await authFetch(
        `/api/tenants/${encodeURIComponent(tenantId)}/whatsapp/dev/interrupt`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason }),
        },
        opts,
      )
      assertGeneration(opts)
      if (!res.ok) throw await parseError(res)
      return (await res.json()) as WhatsappConnection
    },

    async getPix(
      tenantId: string,
      opts?: FetchOpts,
    ): Promise<PixSnapshot> {
      const res = await authFetch(
        `/api/tenants/${encodeURIComponent(tenantId)}/pix`,
        { method: 'GET' },
        opts,
      )
      assertGeneration(opts)
      if (!res.ok) throw await parseError(res)
      return (await res.json()) as PixSnapshot
    },

    async connectPix(
      tenantId: string,
      appId: string,
      opts?: FetchOpts,
    ): Promise<PixAccountPublic> {
      const res = await authFetch(
        `/api/tenants/${encodeURIComponent(tenantId)}/pix/connect`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ appId }),
        },
        opts,
      )
      assertGeneration(opts)
      if (!res.ok) throw await parseError(res)
      const body = (await res.json()) as { account: PixAccountPublic }
      return body.account
    },

    async disconnectPix(
      tenantId: string,
      opts?: FetchOpts,
    ): Promise<{ account: PixAccountPublic; chargesPreserved: number }> {
      const res = await authFetch(
        `/api/tenants/${encodeURIComponent(tenantId)}/pix/disconnect`,
        { method: 'POST' },
        opts,
      )
      assertGeneration(opts)
      if (!res.ok) throw await parseError(res)
      return (await res.json()) as {
        account: PixAccountPublic
        chargesPreserved: number
      }
    },

    async setClinicAiAssist(
      tenantId: string,
      enabled: boolean,
      opts?: FetchOpts,
    ): Promise<ClinicConfigSnapshot['settings']> {
      const res = await authFetch(
        `/api/tenants/${encodeURIComponent(tenantId)}/config/ai-assist`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enabled }),
        },
        opts,
      )
      assertGeneration(opts)
      if (!res.ok) throw await parseError(res)
      return (await res.json()) as ClinicConfigSnapshot['settings']
    },

    async setClinicAiProfile(
      tenantId: string,
      body: { clinicAddress: string; googleBusinessUrl: string; reschedulePolicy: string },
      opts?: FetchOpts,
    ): Promise<ClinicConfigSnapshot['settings']> {
      const res = await authFetch(
        `/api/tenants/${encodeURIComponent(tenantId)}/config/ai-assist`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
        opts,
      )
      assertGeneration(opts)
      if (!res.ok) throw await parseError(res)
      return (await res.json()) as ClinicConfigSnapshot['settings']
    },

    async updatePixSignalSettings(
      tenantId: string,
      body: { deadlineSeconds?: number; cancellationPolicy?: string },
      opts?: FetchOpts,
    ): Promise<PixSignalSettings> {
      const res = await authFetch(
        `/api/tenants/${encodeURIComponent(tenantId)}/pix/signal-settings`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
        opts,
      )
      assertGeneration(opts)
      if (!res.ok) throw await parseError(res)
      const data = (await res.json()) as { signalSettings: PixSignalSettings }
      return data.signalSettings
    },

    async upsertService(
      tenantId: string,
      body: ServiceUpsertBody,
      opts?: FetchOpts & { serviceId?: string },
    ): Promise<ClinicService> {
      const path = opts?.serviceId
        ? `/api/tenants/${encodeURIComponent(tenantId)}/config/services/${encodeURIComponent(opts.serviceId)}`
        : `/api/tenants/${encodeURIComponent(tenantId)}/config/services`
      const res = await authFetch(
        path,
        {
          method: opts?.serviceId ? 'PUT' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
        opts,
      )
      assertGeneration(opts)
      if (!res.ok) throw await parseError(res)
      return (await res.json()) as ClinicService
    },

    async setServiceActive(
      tenantId: string,
      serviceId: string,
      active: boolean,
      opts?: FetchOpts,
    ): Promise<ClinicService> {
      const res = await authFetch(
        `/api/tenants/${encodeURIComponent(tenantId)}/config/services/${encodeURIComponent(serviceId)}/active`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ active }),
        },
        opts,
      )
      assertGeneration(opts)
      if (!res.ok) throw await parseError(res)
      return (await res.json()) as ClinicService
    },

    async upsertResource(
      tenantId: string,
      body: ResourceUpsertBody,
      opts?: FetchOpts & { resourceId?: string },
    ): Promise<ClinicResource> {
      const path = opts?.resourceId
        ? `/api/tenants/${encodeURIComponent(tenantId)}/config/resources/${encodeURIComponent(opts.resourceId)}`
        : `/api/tenants/${encodeURIComponent(tenantId)}/config/resources`
      const res = await authFetch(
        path,
        {
          method: opts?.resourceId ? 'PUT' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
        opts,
      )
      assertGeneration(opts)
      if (!res.ok) throw await parseError(res)
      return (await res.json()) as ClinicResource
    },

    async setResourceActive(
      tenantId: string,
      resourceId: string,
      active: boolean,
      opts?: FetchOpts,
    ): Promise<ClinicResource> {
      const res = await authFetch(
        `/api/tenants/${encodeURIComponent(tenantId)}/config/resources/${encodeURIComponent(resourceId)}/active`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ active }),
        },
        opts,
      )
      assertGeneration(opts)
      if (!res.ok) throw await parseError(res)
      return (await res.json()) as ClinicResource
    },

    async listResourceFutureAppointments(
      tenantId: string,
      resourceId: string,
      opts?: FetchOpts,
    ): Promise<{ resource: ClinicResource; appointments: ResourceFutureAppointment[] }> {
      const res = await authFetch(
        `/api/tenants/${encodeURIComponent(tenantId)}/config/resources/${encodeURIComponent(resourceId)}/future-appointments`,
        { method: 'GET' },
        opts,
      )
      assertGeneration(opts)
      if (!res.ok) throw await parseError(res)
      return (await res.json()) as {
        resource: ClinicResource
        appointments: ResourceFutureAppointment[]
      }
    },

    async deactivateResource(
      tenantId: string,
      resourceId: string,
      reassignments: ResourceReassignmentInput[],
      opts?: FetchOpts,
    ): Promise<DeactivateResourceResponse> {
      const res = await authFetch(
        `/api/tenants/${encodeURIComponent(tenantId)}/config/resources/${encodeURIComponent(resourceId)}/deactivate`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reassignments }),
        },
        opts,
      )
      assertGeneration(opts)
      if (!res.ok) throw await parseError(res)
      return (await res.json()) as DeactivateResourceResponse
    },

    async deleteService(
      tenantId: string,
      serviceId: string,
      opts?: FetchOpts,
    ): Promise<{ ok: true; id: string }> {
      const res = await authFetch(
        `/api/tenants/${encodeURIComponent(tenantId)}/config/services/${encodeURIComponent(serviceId)}`,
        { method: 'DELETE' },
        opts,
      )
      assertGeneration(opts)
      if (!res.ok) throw await parseError(res)
      return (await res.json()) as { ok: true; id: string }
    },

    async deleteResource(
      tenantId: string,
      resourceId: string,
      opts?: FetchOpts,
    ): Promise<{ ok: true; id: string }> {
      const res = await authFetch(
        `/api/tenants/${encodeURIComponent(tenantId)}/config/resources/${encodeURIComponent(resourceId)}`,
        { method: 'DELETE' },
        opts,
      )
      assertGeneration(opts)
      if (!res.ok) throw await parseError(res)
      return (await res.json()) as { ok: true; id: string }
    },

    async setWeeklyWindows(
      tenantId: string,
      resourceId: string,
      windows: WeeklyWindowInput[],
      opts?: FetchOpts,
    ): Promise<{ windows: ClinicWeeklyWindow[] }> {
      const res = await authFetch(
        `/api/tenants/${encodeURIComponent(tenantId)}/config/resources/${encodeURIComponent(resourceId)}/weekly`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ windows }),
        },
        opts,
      )
      assertGeneration(opts)
      if (!res.ok) throw await parseError(res)
      return (await res.json()) as { windows: ClinicWeeklyWindow[] }
    },

    async createBlock(
      tenantId: string,
      body: CreateBlockBody,
      opts?: FetchOpts,
    ): Promise<CreateBlockResponse> {
      const res = await authFetch(
        `/api/tenants/${encodeURIComponent(tenantId)}/config/blocks`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
        opts,
      )
      assertGeneration(opts)
      if (!res.ok) throw await parseError(res)
      return (await res.json()) as CreateBlockResponse
    },

    async deleteBlock(tenantId: string, blockId: string, opts?: FetchOpts): Promise<void> {
      const res = await authFetch(
        `/api/tenants/${encodeURIComponent(tenantId)}/config/blocks/${encodeURIComponent(blockId)}`,
        { method: 'DELETE' },
        opts,
      )
      assertGeneration(opts)
      if (!res.ok) throw await parseError(res)
    },

    async queryAvailability(
      tenantId: string,
      query: {
        serviceId: string
        date: string
        professionalId?: string
        excludeHoldId?: string
        /** Reserva por bloco: horários livres para a duração do bloco. */
        durationMinutes?: number
      },
      opts?: FetchOpts,
    ): Promise<AvailabilityResponse> {
      const params = new URLSearchParams()
      params.set('serviceId', query.serviceId)
      params.set('date', query.date)
      if (query.professionalId && query.professionalId !== 'any') {
        params.set('professionalId', query.professionalId)
      }
      if (query.excludeHoldId) params.set('excludeHoldId', query.excludeHoldId)
      if (query.durationMinutes) params.set('durationMinutes', String(query.durationMinutes))
      const res = await authFetch(
        `/api/tenants/${encodeURIComponent(tenantId)}/availability?${params}`,
        {},
        opts,
      )
      assertGeneration(opts)
      if (!res.ok) throw await parseError(res)
      return (await res.json()) as AvailabilityResponse
    },

    async checkAvailabilitySlot(
      tenantId: string,
      body: {
        serviceId: string
        professionalId: string
        roomResourceId?: string | null
        startsAt: number
        excludeAppointmentId?: string | null
        durationMinutes?: number | null
      },
      opts?: FetchOpts,
    ): Promise<AvailabilityCheckResponse> {
      const res = await authFetch(
        `/api/tenants/${encodeURIComponent(tenantId)}/availability/check`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
        opts,
      )
      assertGeneration(opts)
      if (!res.ok) throw await parseError(res)
      return (await res.json()) as AvailabilityCheckResponse
    },

    async queryAgenda(
      tenantId: string,
      query: {
        date: string
        view: 'day' | 'week'
        professionalId?: string
        roomResourceId?: string
        includeCancelled?: boolean
      },
      opts?: FetchOpts,
    ): Promise<AgendaViewResponse> {
      const params = new URLSearchParams()
      params.set('date', query.date)
      params.set('view', query.view)
      if (query.professionalId) params.set('professionalId', query.professionalId)
      if (query.roomResourceId) params.set('roomResourceId', query.roomResourceId)
      if (query.includeCancelled) params.set('includeCancelled', '1')
      const res = await authFetch(
        `/api/tenants/${encodeURIComponent(tenantId)}/agenda?${params}`,
        {},
        opts,
      )
      assertGeneration(opts)
      if (!res.ok) throw await parseError(res)
      return (await res.json()) as AgendaViewResponse
    },

    async getAppointment(
      tenantId: string,
      appointmentId: string,
      opts?: FetchOpts,
    ): Promise<AppointmentDetailResponse> {
      const res = await authFetch(
        `/api/tenants/${encodeURIComponent(tenantId)}/appointments/${encodeURIComponent(appointmentId)}`,
        {},
        opts,
      )
      assertGeneration(opts)
      if (!res.ok) throw await parseError(res)
      return (await res.json()) as AppointmentDetailResponse
    },

    async listAppointmentReasons(
      tenantId: string,
      opts?: FetchOpts,
    ): Promise<AppointmentReasonOption[]> {
      const res = await authFetch(
        `/api/tenants/${encodeURIComponent(tenantId)}/appointments/reasons`,
        {},
        opts,
      )
      assertGeneration(opts)
      if (!res.ok) throw await parseError(res)
      const body = (await res.json()) as { reasons: AppointmentReasonOption[] }
      return body.reasons
    },

    async confirmAppointment(
      tenantId: string,
      body: {
        clientRequestId: string
        serviceId: string
        professionalId: string
        roomResourceId?: string | null
        startsAt: number
        contactLabel?: string | null
        contactId?: string | null
        conversationId?: string | null
        opportunityId?: string | null
        /** DEC-051: duração aplicada (só serviços com duração ajustável). */
        durationMinutes?: number | null
      },
      opts?: FetchOpts,
    ): Promise<AppointmentDetailResponse & { createdReservation: true; idempotentReplay: boolean }> {
      const res = await authFetch(
        `/api/tenants/${encodeURIComponent(tenantId)}/appointments`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
        opts,
      )
      assertGeneration(opts)
      if (!res.ok) throw await parseError(res)
      return (await res.json()) as AppointmentDetailResponse & {
        createdReservation: true
        idempotentReplay: boolean
      }
    },

    /** Reserva por bloco — quanto cabe no período (leitura). */
    async previewHold(
      tenantId: string,
      body: { professionalId: string; windowStartsAt: number; windowEndsAt: number; durationMinutes: number },
      opts?: FetchOpts,
    ): Promise<{ freeMinutes: number; fits: boolean; asOf: number }> {
      return holdJson(`/api/tenants/${encodeURIComponent(tenantId)}/holds/preview`, body, opts)
    },

    async createHold(
      tenantId: string,
      body: {
        clientRequestId: string
        conversationId: string
        serviceId: string
        professionalId: string
        windowStartsAt: number
        windowEndsAt: number
        durationMinutes: number
        startsAt: number
        roomResourceId?: string | null
      },
      opts?: FetchOpts,
    ): Promise<{ hold: ScheduleHold; appointment: AppointmentDetailResponse; idempotentReplay: boolean }> {
      return holdJson(`/api/tenants/${encodeURIComponent(tenantId)}/holds`, body, opts)
    },

    async listHolds(
      tenantId: string,
      query: { conversationId?: string; status?: ScheduleHoldStatus[] },
      opts?: FetchOpts,
    ): Promise<ScheduleHold[]> {
      const params = new URLSearchParams()
      if (query.conversationId) params.set('conversationId', query.conversationId)
      if (query.status?.length) params.set('status', query.status.join(','))
      const res = await authFetch(`/api/tenants/${encodeURIComponent(tenantId)}/holds?${params}`, {}, opts)
      assertGeneration(opts)
      if (!res.ok) throw await parseError(res)
      return ((await res.json()) as { holds: ScheduleHold[] }).holds
    },


    /** Cobrança Pix + sinal na conversa sem reservar (#38). */
    async createPixCharge(
      tenantId: string,
      body: {
        clientRequestId: string
        conversationId: string
        contactId?: string | null
        opportunityId?: string | null
        serviceId: string
        professionalId: string
        roomResourceId?: string | null
        startsAt: number
        authorDisplayName?: string | null
      },
      opts?: FetchOpts,
    ): Promise<PixChargeCreateResponse> {
      const res = await authFetch(
        `/api/tenants/${encodeURIComponent(tenantId)}/pix/charges`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
        opts,
      )
      assertGeneration(opts)
      if (!res.ok) throw await parseError(res)
      return (await res.json()) as PixChargeCreateResponse
    },

    async getPixCharge(
      tenantId: string,
      chargeId: string,
      opts?: FetchOpts,
    ): Promise<{ charge: PixChargeDetail; intent: SchedulingIntentView | null }> {
      const res = await authFetch(
        `/api/tenants/${encodeURIComponent(tenantId)}/pix/charges/${encodeURIComponent(chargeId)}`,
        { method: 'GET' },
        opts,
      )
      assertGeneration(opts)
      if (!res.ok) throw await parseError(res)
      return (await res.json()) as {
        charge: PixChargeDetail
        intent: SchedulingIntentView | null
      }
    },

    async listConversationPixCharges(
      tenantId: string,
      conversationId: string,
      opts?: FetchOpts,
    ): Promise<PixChargeDetail[]> {
      const res = await authFetch(
        `/api/tenants/${encodeURIComponent(tenantId)}/conversations/${encodeURIComponent(conversationId)}/pix-charges`,
        { method: 'GET' },
        opts,
      )
      assertGeneration(opts)
      if (!res.ok) throw await parseError(res)
      const body = (await res.json()) as { items: PixChargeDetail[] }
      return body.items
    },

    /** Alertas abertos «Pago sem horário» (M-32 / #39) — reconcilia após reconnect. */
    async listPixPaymentAlerts(
      tenantId: string,
      conversationId?: string,
      opts?: FetchOpts,
    ): Promise<PixPaymentAlert[]> {
      const q = conversationId
        ? `?conversationId=${encodeURIComponent(conversationId)}`
        : ''
      const res = await authFetch(
        `/api/tenants/${encodeURIComponent(tenantId)}/pix/alerts${q}`,
        { method: 'GET' },
        opts,
      )
      assertGeneration(opts)
      if (!res.ok) throw await parseError(res)
      const body = (await res.json()) as { alerts: PixPaymentAlert[] }
      return body.alerts
    },

    /** Confirmar horário alternativo com sinal já pago (#40). */
    async confirmPixAlertSlot(
      tenantId: string,
      alertId: string,
      body: {
        clientRequestId: string
        serviceId: string
        professionalId: string
        roomResourceId?: string | null
        startsAt: number
      },
      opts?: FetchOpts,
    ): Promise<{
      alert: PixPaymentAlert
      charge: PixChargeDetail
      appointmentId: string
      idempotentReplay: boolean
    }> {
      const res = await authFetch(
        `/api/tenants/${encodeURIComponent(tenantId)}/pix/alerts/${encodeURIComponent(alertId)}/confirm-slot`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
        opts,
      )
      assertGeneration(opts)
      if (!res.ok) throw await parseError(res)
      return (await res.json()) as {
        alert: PixPaymentAlert
        charge: PixChargeDetail
        appointmentId: string
        idempotentReplay: boolean
      }
    },

    /** Devolver sinal a partir do alerta (#40). */
    async refundPixAlert(
      tenantId: string,
      alertId: string,
      body: { clientRequestId: string; reason?: string | null },
      opts?: FetchOpts,
    ): Promise<{
      charge: PixChargeDetail
      alert: PixPaymentAlert | null
      refundConfirmed: boolean
      uncertain: boolean
    }> {
      const res = await authFetch(
        `/api/tenants/${encodeURIComponent(tenantId)}/pix/alerts/${encodeURIComponent(alertId)}/refund`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
        opts,
      )
      assertGeneration(opts)
      if (!res.ok) throw await parseError(res)
      return (await res.json()) as {
        charge: PixChargeDetail
        alert: PixPaymentAlert | null
        refundConfirmed: boolean
        uncertain: boolean
      }
    },

    async cancelPixCharge(
      tenantId: string,
      chargeId: string,
      body: { clientRequestId: string },
      opts?: FetchOpts,
    ): Promise<{ charge: PixChargeDetail; idempotentReplay: boolean }> {
      const res = await authFetch(
        `/api/tenants/${encodeURIComponent(tenantId)}/pix/charges/${encodeURIComponent(chargeId)}/cancel`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
        opts,
      )
      assertGeneration(opts)
      if (!res.ok) throw await parseError(res)
      return (await res.json()) as {
        charge: PixChargeDetail
        idempotentReplay: boolean
      }
    },

    async requestPixRefund(
      tenantId: string,
      chargeId: string,
      body: { clientRequestId: string; reason?: string | null },
      opts?: FetchOpts,
    ): Promise<{
      charge: PixChargeDetail
      refundConfirmed: boolean
      uncertain: boolean
    }> {
      const res = await authFetch(
        `/api/tenants/${encodeURIComponent(tenantId)}/pix/charges/${encodeURIComponent(chargeId)}/refund`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
        opts,
      )
      assertGeneration(opts)
      if (!res.ok) throw await parseError(res)
      return (await res.json()) as {
        charge: PixChargeDetail
        refundConfirmed: boolean
        uncertain: boolean
      }
    },

    async getAppointmentPaidSignal(
      tenantId: string,
      appointmentId: string,
      opts?: FetchOpts,
    ): Promise<PixChargeDetail | null> {
      const res = await authFetch(
        `/api/tenants/${encodeURIComponent(tenantId)}/appointments/${encodeURIComponent(appointmentId)}/paid-signal`,
        { method: 'GET' },
        opts,
      )
      assertGeneration(opts)
      if (!res.ok) throw await parseError(res)
      const body = (await res.json()) as { charge: PixChargeDetail | null }
      return body.charge
    },

    async cancelAppointmentWithSignal(
      tenantId: string,
      appointmentId: string,
      body: {
        clientRequestId: string
        reason: string
        signalDisposition: 'refund' | 'retain'
        expectedVersion?: number | null
        note?: string | null
      },
      opts?: FetchOpts,
    ): Promise<{
      appointment: AppointmentDetailResponse
      charge: PixChargeDetail | null
      refundConfirmed: boolean
      uncertain: boolean
    }> {
      const res = await authFetch(
        `/api/tenants/${encodeURIComponent(tenantId)}/appointments/${encodeURIComponent(appointmentId)}/cancel-with-signal`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
        opts,
      )
      assertGeneration(opts)
      if (!res.ok) throw await parseError(res)
      return (await res.json()) as {
        appointment: AppointmentDetailResponse
        charge: PixChargeDetail | null
        refundConfirmed: boolean
        uncertain: boolean
      }
    },

    /** Confirmar sem sinal com motivo (AC-51). */
    async confirmWithoutSignal(
      tenantId: string,
      body: {
        clientRequestId: string
        conversationId?: string | null
        contactId?: string | null
        opportunityId?: string | null
        serviceId: string
        professionalId: string
        roomResourceId?: string | null
        startsAt: number
        contactLabel?: string | null
        waiveReason: string
        supersedeChargeId?: string | null
      },
      opts?: FetchOpts,
    ): Promise<ConfirmWithoutSignalResponse> {
      const res = await authFetch(
        `/api/tenants/${encodeURIComponent(tenantId)}/appointments/confirm-without-signal`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
        opts,
      )
      assertGeneration(opts)
      if (!res.ok) throw await parseError(res)
      return (await res.json()) as ConfirmWithoutSignalResponse
    },

    async cancelAppointment(
      tenantId: string,
      appointmentId: string,
      body: {
        clientRequestId: string
        reason: string
        expectedVersion?: number | null
      },
      opts?: FetchOpts,
    ): Promise<AppointmentDetailResponse & { idempotentReplay: boolean }> {
      const res = await authFetch(
        `/api/tenants/${encodeURIComponent(tenantId)}/appointments/${encodeURIComponent(appointmentId)}/cancel`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
        opts,
      )
      assertGeneration(opts)
      if (!res.ok) throw await parseError(res)
      return (await res.json()) as AppointmentDetailResponse & {
        idempotentReplay: boolean
      }
    },

    async rescheduleAppointment(
      tenantId: string,
      appointmentId: string,
      body: {
        clientRequestId: string
        reason: string
        professionalId: string
        roomResourceId?: string | null
        startsAt: number
        serviceId?: string
        expectedVersion?: number | null
      },
      opts?: FetchOpts,
    ): Promise<AppointmentDetailResponse & { idempotentReplay: boolean }> {
      const res = await authFetch(
        `/api/tenants/${encodeURIComponent(tenantId)}/appointments/${encodeURIComponent(appointmentId)}/reschedule`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
        opts,
      )
      assertGeneration(opts)
      if (!res.ok) throw await parseError(res)
      return (await res.json()) as AppointmentDetailResponse & {
        idempotentReplay: boolean
      }
    },

    async listInboxConversations(
      tenantId: string,
      query: {
        filter?: InboxFilter
        q?: string
        before?: number | null
        limit?: number
      } = {},
      opts?: FetchOpts,
    ): Promise<InboxListResponse> {
      const params = new URLSearchParams()
      if (query.filter && query.filter !== 'all') params.set('filter', query.filter)
      if (query.q) params.set('q', query.q)
      if (query.before != null) params.set('before', String(query.before))
      if (query.limit != null) params.set('limit', String(query.limit))
      const qs = params.toString()
      const res = await authFetch(
        `/api/tenants/${encodeURIComponent(tenantId)}/inbox/conversations${qs ? `?${qs}` : ''}`,
        {},
        opts,
      )
      assertGeneration(opts)
      if (!res.ok) throw await parseError(res)
      return (await res.json()) as InboxListResponse
    },

    async getInboxConversation(
      tenantId: string,
      conversationId: string,
      query: { before?: number | null; messageLimit?: number } = {},
      opts?: FetchOpts,
    ): Promise<InboxConversationDetail> {
      const params = new URLSearchParams()
      if (query.before != null) params.set('before', String(query.before))
      if (query.messageLimit != null) params.set('messageLimit', String(query.messageLimit))
      const qs = params.toString()
      const res = await authFetch(
        `/api/tenants/${encodeURIComponent(tenantId)}/inbox/conversations/${encodeURIComponent(conversationId)}${qs ? `?${qs}` : ''}`,
        {},
        opts,
      )
      assertGeneration(opts)
      if (!res.ok) throw await parseError(res)
      return (await res.json()) as InboxConversationDetail
    },

    async getInboxContact(
      tenantId: string,
      contactId: string,
      opts?: FetchOpts,
    ): Promise<InboxContactDetail> {
      const res = await authFetch(
        `/api/tenants/${encodeURIComponent(tenantId)}/inbox/contacts/${encodeURIComponent(contactId)}`,
        {},
        opts,
      )
      assertGeneration(opts)
      if (!res.ok) throw await parseError(res)
      return (await res.json()) as InboxContactDetail
    },

    /**
     * Exclusão de contato pelo owner (#43 / REQ-071).
     * Resposta sem PII — só contagens e auditId.
     */
    async deleteContact(
      tenantId: string,
      contactId: string,
      opts?: FetchOpts,
    ): Promise<DeleteContactResponse> {
      const res = await authFetch(
        `/api/tenants/${encodeURIComponent(tenantId)}/contacts/${encodeURIComponent(contactId)}`,
        { method: 'DELETE' },
        opts,
      )
      assertGeneration(opts)
      if (!res.ok) throw await parseError(res)
      return (await res.json()) as DeleteContactResponse
    },

    async assignInboxConversation(
      tenantId: string,
      conversationId: string,
      body: {
        assigneeClerkUserId?: string | null
        assigneeDisplayName?: string | null
        expectedAssignmentVersion?: number | null
      },
      opts?: FetchOpts,
    ): Promise<InboxAssignResponse> {
      const res = await authFetch(
        `/api/tenants/${encodeURIComponent(tenantId)}/inbox/conversations/${encodeURIComponent(conversationId)}/assign`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
        opts,
      )
      assertGeneration(opts)
      if (!res.ok && res.status !== 409) throw await parseError(res)
      return (await res.json()) as InboxAssignResponse
    },

    async markInboxRead(
      tenantId: string,
      conversationId: string,
      opts?: FetchOpts,
    ): Promise<{ conversation: InboxConversation }> {
      const res = await authFetch(
        `/api/tenants/${encodeURIComponent(tenantId)}/inbox/conversations/${encodeURIComponent(conversationId)}/read`,
        { method: 'POST' },
        opts,
      )
      assertGeneration(opts)
      if (!res.ok) throw await parseError(res)
      return (await res.json()) as { conversation: InboxConversation }
    },

    async closeInboxConversation(
      tenantId: string,
      conversationId: string,
      opts?: FetchOpts,
    ): Promise<InboxAssignResponse> {
      const res = await authFetch(
        `/api/tenants/${encodeURIComponent(tenantId)}/inbox/conversations/${encodeURIComponent(conversationId)}/close`,
        { method: 'POST' },
        opts,
      )
      assertGeneration(opts)
      if (!res.ok) throw await parseError(res)
      return (await res.json()) as InboxAssignResponse
    },

    async getTeamMembers(tenantId: string, opts?: FetchOpts): Promise<{ members: TeamMemberLite[] }> {
      const res = await authFetch(`/api/tenants/${encodeURIComponent(tenantId)}/team`, {}, opts)
      assertGeneration(opts)
      if (!res.ok) throw await parseError(res)
      const data = (await res.json()) as { members?: TeamMemberLite[] }
      return { members: data.members ?? [] }
    },

    async blockInboxContact(
      tenantId: string,
      contactId: string,
      body: { reason?: string | null },
      opts?: FetchOpts,
    ): Promise<{ contact: InboxContact; closedConversationIds: string[] }> {
      const res = await authFetch(
        `/api/tenants/${encodeURIComponent(tenantId)}/inbox/contacts/${encodeURIComponent(contactId)}/block`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        },
        opts,
      )
      assertGeneration(opts)
      if (!res.ok) throw await parseError(res)
      return (await res.json()) as { contact: InboxContact; closedConversationIds: string[] }
    },

    async unblockInboxContact(
      tenantId: string,
      contactId: string,
      opts?: FetchOpts,
    ): Promise<{ contact: InboxContact }> {
      const res = await authFetch(
        `/api/tenants/${encodeURIComponent(tenantId)}/inbox/contacts/${encodeURIComponent(contactId)}/unblock`,
        { method: 'POST' },
        opts,
      )
      assertGeneration(opts)
      if (!res.ok) throw await parseError(res)
      return (await res.json()) as { contact: InboxContact }
    },

    async sendInboxMessage(
      tenantId: string,
      conversationId: string,
      body: {
        body?: string
        clientRequestId: string
        template?: {
          name: string
          language: string
          params: Record<string, string>
        }
        /** Origem assistiva — só após clique humano em Enviar (#41). */
        aiSuggestionId?: string | null
      },
      opts?: FetchOpts,
    ): Promise<InboxSendResponse> {
      const res = await authFetch(
        `/api/tenants/${encodeURIComponent(tenantId)}/inbox/conversations/${encodeURIComponent(conversationId)}/messages`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
        opts,
      )
      assertGeneration(opts)
      if (!res.ok) throw await parseError(res)
      return (await res.json()) as InboxSendResponse
    },

    async suggestAiReply(
      tenantId: string,
      conversationId: string,
      body: {
        clientRequestId: string
        parentSuggestionId?: string | null
        actorDisplayName?: string
      },
      opts?: FetchOpts,
    ): Promise<AiSuggestResponse> {
      const res = await authFetch(
        `/api/tenants/${encodeURIComponent(tenantId)}/conversations/${encodeURIComponent(conversationId)}/ai/suggest`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
        opts,
      )
      assertGeneration(opts)
      if (!res.ok) throw await parseError(res)
      const out = (await res.json()) as AiSuggestResponse
      return { ...out, suggestion: sanitizeAiSuggestion(out.suggestion) }
    },

    async getAiDraft(
      tenantId: string,
      conversationId: string,
      opts?: FetchOpts,
    ): Promise<AiDraftState> {
      const res = await authFetch(
        `/api/tenants/${encodeURIComponent(tenantId)}/conversations/${encodeURIComponent(conversationId)}/ai/draft`,
        {},
        opts,
      )
      assertGeneration(opts)
      if (!res.ok) throw await parseError(res)
      const out = (await res.json()) as AiDraftState
      return { ...out, suggestion: sanitizeAiSuggestion(out.suggestion) }
    },

    async getAiStatus(
      tenantId: string,
      opts?: FetchOpts,
    ): Promise<{ mode: string; syntheticFallback: boolean; usage: AiDailyUsage | null }> {
      const res = await authFetch(
        `/api/tenants/${encodeURIComponent(tenantId)}/ai/status`,
        {},
        opts,
      )
      assertGeneration(opts)
      if (!res.ok) throw await parseError(res)
      return (await res.json()) as { mode: string; syntheticFallback: boolean; usage: AiDailyUsage | null }
    },

    async summarizeAiConversation(
      tenantId: string,
      conversationId: string,
      body: { clientRequestId: string; actorDisplayName?: string },
      opts?: FetchOpts,
    ): Promise<AiSuggestResponse> {
      const res = await authFetch(
        `/api/tenants/${encodeURIComponent(tenantId)}/conversations/${encodeURIComponent(conversationId)}/ai/summarize`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
        opts,
      )
      assertGeneration(opts)
      if (!res.ok) throw await parseError(res)
      return (await res.json()) as AiSuggestResponse
    },

    async decideAiSuggestion(
      tenantId: string,
      suggestionId: string,
      body: {
        clientRequestId: string
        decision: 'use' | 'edit' | 'discard'
        revisedText?: string | null
        outboundMessageId?: string | null
        actorDisplayName?: string
      },
      opts?: FetchOpts,
    ): Promise<AiSuggestResponse> {
      const res = await authFetch(
        `/api/tenants/${encodeURIComponent(tenantId)}/ai/suggestions/${encodeURIComponent(suggestionId)}/decide`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
        opts,
      )
      assertGeneration(opts)
      if (!res.ok) throw await parseError(res)
      return (await res.json()) as AiSuggestResponse
    },

    async listWhatsappTemplates(
      tenantId: string,
      opts?: FetchOpts & { approvedOnly?: boolean },
    ): Promise<WhatsappTemplatesResponse> {
      const q =
        opts?.approvedOnly === false ? '?approvedOnly=0' : '?approvedOnly=1'
      const res = await authFetch(
        `/api/tenants/${encodeURIComponent(tenantId)}/whatsapp/templates${q}`,
        {},
        opts,
      )
      assertGeneration(opts)
      if (!res.ok) throw await parseError(res)
      return (await res.json()) as WhatsappTemplatesResponse
    },

    async seedInboxDemo(
      tenantId: string,
      opts?: FetchOpts & { force?: boolean },
    ): Promise<{ seeded: boolean; conversationCount: number }> {
      const res = await authFetch(
        `/api/tenants/${encodeURIComponent(tenantId)}/inbox/seed-demo`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ force: opts?.force === true }),
        },
        opts,
      )
      assertGeneration(opts)
      if (!res.ok) throw await parseError(res)
      return (await res.json()) as { seeded: boolean; conversationCount: number }
    },

    async listPipelineOpportunities(
      tenantId: string,
      query: { stage?: OpportunityStage; includeClosed?: boolean; limit?: number } = {},
      opts?: FetchOpts,
    ): Promise<PipelineListResponse> {
      const params = new URLSearchParams()
      if (query.stage) params.set('stage', query.stage)
      if (query.includeClosed) params.set('includeClosed', '1')
      if (query.limit != null) params.set('limit', String(query.limit))
      const qs = params.toString()
      const res = await authFetch(
        `/api/tenants/${encodeURIComponent(tenantId)}/pipeline/opportunities${qs ? `?${qs}` : ''}`,
        {},
        opts,
      )
      assertGeneration(opts)
      if (!res.ok) throw await parseError(res)
      return (await res.json()) as PipelineListResponse
    },

    async getPipelineOpportunity(
      tenantId: string,
      opportunityId: string,
      opts?: FetchOpts,
    ): Promise<{ opportunity: PipelineOpportunityDetail }> {
      const res = await authFetch(
        `/api/tenants/${encodeURIComponent(tenantId)}/pipeline/opportunities/${encodeURIComponent(opportunityId)}`,
        {},
        opts,
      )
      assertGeneration(opts)
      if (!res.ok) throw await parseError(res)
      return (await res.json()) as { opportunity: PipelineOpportunityDetail }
    },

    async movePipelineStage(
      tenantId: string,
      opportunityId: string,
      body: {
        toStage: OpportunityStage
        expectedUpdatedAt?: number | null
        note?: string | null
      },
      opts?: FetchOpts,
    ): Promise<{ opportunity: PipelineOpportunityDetail }> {
      const res = await authFetch(
        `/api/tenants/${encodeURIComponent(tenantId)}/pipeline/opportunities/${encodeURIComponent(opportunityId)}/move`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
        opts,
      )
      assertGeneration(opts)
      if (!res.ok) throw await parseError(res)
      return (await res.json()) as { opportunity: PipelineOpportunityDetail }
    },

    async seedPipelineDemo(
      tenantId: string,
      opts?: FetchOpts & { force?: boolean },
    ): Promise<{
      seeded: boolean
      opportunityCount: number
      val02Fixtures: { hypothesis: string }
    }> {
      const res = await authFetch(
        `/api/tenants/${encodeURIComponent(tenantId)}/pipeline/seed-demo`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ force: opts?.force === true }),
        },
        opts,
      )
      assertGeneration(opts)
      if (!res.ok) throw await parseError(res)
      return (await res.json()) as {
        seeded: boolean
        opportunityCount: number
        val02Fixtures: { hypothesis: string }
      }
    },
  }
}

export type TeamMemberLite = {
  clerkUserId: string
  role: 'owner' | 'attendant' | string
  status: string
}

export type InboxFilter = 'all' | 'new' | 'mine' | 'unassigned' | 'closed'

export type InboxContact = {
  id: string
  waId: string
  displayName: string | null
  createdAt: number
  blockedAt?: number | null
  blockedByDisplayName?: string | null
  blockedReason?: string | null
}

export type InboxConversation = {
  id: string
  tenantId: string
  contactId: string
  status: 'new' | 'open' | 'closed'
  assigneeClerkUserId: string | null
  assigneeDisplayName: string | null
  assignmentVersion: number
  lastMessageAt: number | null
  lastMessagePreview: string | null
  lastMessageDirection: 'inbound' | 'outbound' | 'system' | null
  unreadCount: number
  createdAt: number
  updatedAt: number
  contact: InboxContact
}

export type InboxMessage = {
  id: string
  tenantId: string
  conversationId: string
  direction: 'inbound' | 'outbound' | 'system'
  body: string
  externalMessageId: string | null
  deliveryState: string
  authorClerkUserId: string | null
  authorDisplayName: string | null
  createdAt: number
  /** Mensagem da cliente lida pela equipa («Lida por Ana · 17:40»). */
  readByDisplayName?: string | null
  readAt?: number | null
}

/** Sugestão IA assistiva (#41) — nunca é mensagem enviada sem clique humano. */
export type AiSuggestion = {
  id: string
  conversationId: string
  kind: 'reply' | 'summary'
  status: string
  provider: string
  model: string
  suggestedText: string
  warningCodes: string[]
  warningLabels: string[]
  sourceRefs: Array<{ serviceName: string; kind: string; label: string }>
  requestMeta: {
    latencyMs: number
    inputTokens: number | null
    outputTokens: number | null
    messageCount: number
    mode: string
  }
  errorCode: string | null
  createdAt: number
  messageSent: false
  /** Mensagem a que responde (rascunho automático). */
  replyToMessageId?: string | null
  origin?: 'manual' | 'auto'
  /** Notas internas para a atendente — nunca entram no texto a enviar. */
  internalNotes?: string | null
}

export type AiDailyUsage = {
  day: string
  drafts: number
  cap: number
  capReached: boolean
  capReachedAt: number | null
}

export type AiDraftState = {
  job: { state: 'queued' | 'generating'; messageId: string; dueAt: number } | null
  suggestion: AiSuggestion | null
  usage?: AiDailyUsage | null
  syntheticFallback?: boolean
  mode?: string
}

export type AiSuggestResponse = {
  suggestion: AiSuggestion
  duplicate: boolean
  messageSent: false
}

export type InboxCounts = {
  all: number
  new: number
  mine: number
  unassigned: number
  /** Conversas com não lidas (badge). */
  unread?: number
  closed: number
}

export type InboxListResponse = {
  conversations: InboxConversation[]
  nextBefore: number | null
  counts: InboxCounts
}

export type MessagingWindow = {
  open: boolean
  lastInboundAt: number | null
  closesAt: number | null
  remainingMs: number | null
}

export type InboxActiveProposal = {
  id: string
  version: number
  state: string
  serviceName: string
  startsAt: number
  endsAt: number
  expiresAt: number | null
  resultKind: string | null
  sendProviderMessageId: string | null
}

export type InboxPendingCommunication = {
  id: string
  kind: string
  status: string
  startedAt: number
  alertAfterAt: number
  alertedAt: number | null
  detailText: string
  proposalId: string | null
}

export type InboxConversationDetail = InboxConversation & {
  messages: InboxMessage[]
  messagesHasMore: boolean
  messagesNextBefore: number | null
  messagingWindow: MessagingWindow
  /** Contato tem Pix pendente (o bloqueio não cancela o Pix). */
  contactHasPendingPix?: boolean
  /** Oportunidade aberta da conversa (DEC-062); `null` ou ausente sem oportunidade. */
  opportunity?: { id: string; stage: string; label: string; updatedAt: number } | null
  /** S4 / #175 — proposta versionada (membros autorizados). */
  activeProposal?: InboxActiveProposal | null
  /** S4 / H7 — comunicação pendente visível na conversa. */
  pendingCommunications?: InboxPendingCommunication[]
}

export type WhatsappTemplateItem = {
  name: string
  language: string
  status: string
  category: string
  bodyPreview: string
  paramKeys: string[]
  pricingCategory: string | null
  pricingNote: string
  syncedAt: number
}

export type WhatsappTemplatesResponse = {
  items: WhatsappTemplateItem[]
  source: string
  note: string
}

export type InboxContactDetail = {
  contact: InboxContact
  conversations: InboxConversation[]
  /** Contato tem Pix pendente (o bloqueio não cancela o Pix). */
  hasPendingPix?: boolean
}

/** Resposta de DELETE contato — sem nome, telefone ou wa_id. */
export type DeleteContactResponse = {
  deleted: boolean
  contactId: string
  deletedMessageCount: number
  deletedAttachmentCount: number
  r2Deleted: number
  anonymizedAppointmentCount: number
  auditId: string
}

export type InboxAssignResponse = {
  conversation: InboxConversation
  systemMessage: InboxMessage
  versionMatched?: boolean
}

export type InboxSendResponse = {
  conversation: InboxConversation
  message: InboxMessage
  duplicate: boolean
}

export type OpportunityStage =
  | 'novo_contato'
  | 'em_atendimento'
  | 'horario_proposto'
  | 'agendado'
  | 'concluido'
  | 'perdido'

export type PipelineContact = {
  id: string
  waId: string
  displayName: string | null
  createdAt: number
}

export type PipelineLinkedAppointment = {
  id: string
  startsAt: number
  endsAt: number
  status: 'confirmed' | 'cancelled'
  contactLabel: string | null
  serviceId: string
  professionalId: string
}

export type PipelineOpportunity = {
  id: string
  tenantId: string
  contactId: string
  conversationId: string
  stage: OpportunityStage
  status: 'open' | 'closed'
  cycleNumber: number
  assigneeClerkUserId: string | null
  assigneeDisplayName: string | null
  lastInteractionAt: number | null
  linkedAppointmentId: string | null
  createdAt: number
  updatedAt: number
  contact: PipelineContact
  missingAppointment: boolean
  linkedAppointment: PipelineLinkedAppointment | null
  /** Reserva por bloco em aberto (activa ou vencida sem hora). */
}

export type PipelineStageHistory = {
  id: string
  fromStage: OpportunityStage | null
  toStage: OpportunityStage
  actorClerkUserId: string | null
  actorDisplayName: string | null
  note: string | null
  createdAt: number
}

export type PipelineOpportunityDetail = PipelineOpportunity & {
  history: PipelineStageHistory[]
}

export type PipelineStageCount = {
  stage: OpportunityStage
  label: string
  count: number
}

export type PipelineListResponse = {
  opportunities: PipelineOpportunity[]
  counts: PipelineStageCount[]
}

export type RoomRequirementDto =
  | { mode: 'none' }
  | { mode: 'any' }
  | { mode: 'category'; category: string }
  | { mode: 'resource'; resourceId: string }

export type ServiceWeeklyWindowSpec = {
  dayOfWeek: number
  startMinute: number
  endMinute: number
}

export type ClinicService = {
  id: string
  name: string
  durationMinutes: number
  bufferMinutes: number
  occupiedMinutes: number
  priceCents: number | null
  clientExplanation: string | null
  active: boolean
  requiresSignal: boolean
  signalKind: 'fixed' | 'percent' | null
  signalFixedCents: number | null
  signalPercent: number | null
  /** DEC-051 — duração ajustável no Agendar (owner). */
  durationAdjustable?: boolean
  durationMinMinutes?: number | null
  durationMaxMinutes?: number | null
  professionalIds: string[]
  roomRequirement: RoomRequirementDto
  /** Horário de oferta do serviço; vazio = qualquer horário no expediente da profissional. */
  weeklyWindows?: ServiceWeeklyWindowSpec[]
  /** Nunca teve marcação, Pix ou proposta: pode ser apagado. */
  deletable?: boolean
  createdAt: number
  updatedAt: number
}

export type ClinicResource = {
  id: string
  kind: 'professional' | 'room' | 'equipment'
  name: string
  category: string | null
  active: boolean
  /** Pessoas ao mesmo tempo (só sala; 1 nas demais). */
  capacity?: number
  sharedSpaceNotice?: string | null
  /** Profissional: segue o horário da clínica ou tem o próprio. */
  hoursMode?: 'clinic' | 'own'
  /** Horários acima da nova capacidade (só na resposta de editar). */
  overCapacity?: Array<{ startsAt: number; endsAt: number; count: number }>
  futureAppointmentCount: number
  /** Já teve compromisso (passado ou futuro): só pode ser desativado. */
  hasAppointmentHistory?: boolean
  servicesWithoutResource?: string[]
  createdAt: number
  updatedAt: number
}

export type ResourceFutureAppointment = {
  appointmentId: string
  serviceId: string
  serviceName: string | null
  contactLabel: string | null
  startsAt: number
  endsAt: number
  professionalId: string
  roomResourceId: string | null
  version: number
  candidates: Array<{ id: string; name: string }>
  suggestedResourceId: string | null
}

export type ResourceReassignmentInput = {
  appointmentId: string
  targetResourceId: string
  expectedVersion?: number
}

export type DeactivateResourceResponse = ClinicResource & {
  reassigned: Array<{ appointmentId: string; fromResourceId: string; toResourceId: string }>
  keptAppointmentIds: string[]
}

export type ClinicWeeklyWindow = {
  id: string
  resourceId: string
  dayOfWeek: number
  startMinute: number
  endMinute: number
}

export type ClinicBlock = {
  id: string
  resourceId: string
  startsAt: number
  endsAt: number
  reason: string
  note: string | null
  createdAt: number
}

export type ClinicConfigReadiness = {
  agendaConfigured: boolean
  readyToServe: boolean
  schedulingAllowed: boolean
  missing: string[]
  timezone: string
  counts: {
    servicesActive: number
    professionalsActive: number
    roomsActive: number
    resourcesWithWeekly: number
  }
}

export type ClinicConfigSnapshot = {
  settings: {
    tenantId: string
    timezone: string
    signalDeadlineSeconds?: number
    signalCancellationPolicy?: string
    /** Opt-in de IA da clínica (default false). */
    aiAssistEnabled?: boolean
    clinicAddress?: string | null
    googleBusinessUrl?: string | null
    reschedulePolicy?: string | null
    updatedAt: number
  }
  services: ClinicService[]
  resources: ClinicResource[]
  weeklyWindows: ClinicWeeklyWindow[]
  blocks: ClinicBlock[]
  readiness: ClinicConfigReadiness
}

export type ServiceUpsertBody = {
  name: string
  durationMinutes: number
  bufferMinutes: number
  priceCents?: number | null
  clientExplanation?: string | null
  active?: boolean
  professionalIds: string[]
  roomRequirement?: RoomRequirementDto
  requiresSignal?: boolean
  signalKind?: 'fixed' | 'percent' | null
  signalFixedCents?: number | null
  signalPercent?: number | null
  durationAdjustable?: boolean
  durationMinMinutes?: number | null
  durationMaxMinutes?: number | null
  /** Omitido na atualização mantém faixas; array vazio remove filtro. */
  weeklyWindows?: ServiceWeeklyWindowSpec[]
}

export type PixAccountPublic = {
  provider: 'woovi'
  status: 'disconnected' | 'connected' | 'revoked'
  accountId: string | null
  appIdHint: string | null
  environment: 'synthetic' | 'sandbox' | 'live'
  credentialVersion: number
  connectedAt: number | null
  connectedByClerkUserId: string | null
  disconnectedAt: number | null
  revokedAt: number | null
  revokeReason: string | null
  updatedAt: number
  canCreateCharge: boolean
}

export type PixSignalSettings = {
  deadlineSeconds: number
  cancellationPolicy: string
  updatedAt: number
}

export type PixSnapshot = {
  account: PixAccountPublic
  signalSettings: PixSignalSettings
}

export type PixChargeDetail = {
  id: string
  accountId: string
  provider: string
  providerChargeId: string | null
  externalReference: string
  amountCents: number
  status: string
  /** UI: `paid_without_slot` quando pago sem compromisso (#39). */
  displayStatus?: string
  paymentResolution?: string | null
  appointmentId?: string | null
  paidWithoutSlotReason?: string | null
  signalDisposition?: string | null
  signalDispositionBy?: string | null
  signalDispositionAt?: number | null
  refundRequestedAt?: number | null
  refundCompletedAt?: number | null
  refundFailureReason?: string | null
  expiresAt: number | null
  paidAt: number | null
  cancelledAt: number | null
  serviceId: string | null
  schedulingIntentId: string | null
  conversationId: string | null
  contactId: string | null
  opportunityId: string | null
  messageId: string | null
  professionalId: string | null
  roomResourceId: string | null
  startsAt: number | null
  endsAt: number | null
  timezone: string | null
  deadlineSecondsSnapshot: number | null
  cancellationPolicySnapshot: string | null
  providerCreateState: string
  whatsappSendError: string | null
  pixCopyPaste?: string | null
  createdAt: number
  updatedAt: number
}

export type PixPaymentAlert = {
  id: string
  chargeId: string
  conversationId: string | null
  contactId: string | null
  opportunityId: string | null
  reason: string
  status: string
  createdAt: number
  updatedAt: number
  resolvedAt: number | null
  resolutionKind?: string | null
  resolvedByClerkUserId?: string | null
  resolvedAppointmentId?: string | null
}

export type SchedulingIntentView = {
  id: string
  conversationId: string
  contactId: string
  opportunityId: string | null
  serviceId: string
  professionalId: string
  roomResourceId: string | null
  startsAt: number
  endsAt: number
  occupiesUntil: number
  timezone: string
  status: string
  activeChargeId: string | null
  waivedReason: string | null
  waivedByClerkUserId: string | null
  waivedAt: number | null
  appointmentId: string | null
  createdAt: number
  updatedAt: number
}

export type PixChargeCreateResponse = {
  charge: PixChargeDetail
  intent: SchedulingIntentView
  messageId: string | null
  whatsappSendError: string | null
  idempotentReplay: boolean
}

export type ConfirmWithoutSignalResponse = {
  appointmentId: string
  supersededChargeId: string | null
  intent: SchedulingIntentView | null
  appointment: AppointmentDetailResponse
  idempotentReplay: boolean
}

export type ResourceUpsertBody = {
  kind: 'professional' | 'room' | 'equipment'
  name: string
  category?: string | null
  active?: boolean
  capacity?: number
  sharedSpaceNotice?: string | null
  hoursMode?: 'clinic' | 'own'
}

export type WeeklyWindowInput = {
  dayOfWeek: number
  startMinute: number
  endMinute: number
}

export type CreateBlockBody = {
  resourceId: string
  startsAt: number
  endsAt: number
  reason: 'folga' | 'ferias' | 'feriado' | 'manutencao' | 'outro'
  note?: string | null
  dryRun?: boolean
}

export type CreateBlockResponse = {
  created: boolean
  block: ClinicBlock | null
  affectedAppointments: Array<{
    id: string
    contactLabel: string | null
    startsAt: number
    endsAt: number
    status: string
  }>
}

export type AvailabilitySlot = {
  startsAt: number
  endsAt: number
  occupiesUntil: number
  professionalId: string
  professionalName: string
  roomResourceId: string | null
  roomResourceName: string | null
  /** Frase fixa da sala (DEC-053); nunca diz quantas vagas restam. */
  roomSharedNotice?: string | null
  /** Sala compartilhada: capacidade e lugares livres (exibição). */
  roomCapacity?: number | null
  roomSeatsFree?: number | null
}

export type AvailabilityResponse = {
  tenantId: string
  timezone: string
  serviceId: string
  serviceName: string
  durationMinutes: number
  bufferMinutes: number
  occupiedMinutes: number
  date: string
  dayOfWeek: number
  dayStartsAt: number
  dayEndsAt: number
  schedulingAllowed: boolean
  asOf: number
  createdReservation: false
  slots: AvailabilitySlot[]
}

export type AvailabilityCheckResponse = {
  available: boolean
  reasons: string[]
  asOf: number
  createdReservation: false
  slot: AvailabilitySlot | null
}

export type AgendaAppointmentItem = {
  id: string
  serviceId: string
  serviceName: string
  professionalId: string
  professionalName: string
  roomResourceId: string | null
  roomResourceName: string | null
  startsAt: number
  endsAt: number
  occupiesUntil: number
  status: 'confirmed' | 'cancelled'
  contactLabel: string | null
  contactId: string | null
  conversationId: string | null
  opportunityId: string | null
  version: number
  changeReason: string | null
  /** DEC-051(i): rótulo «duração ajustada». */
  durationAdjusted?: boolean
  /** Criado pela IA após confirmação explícita da cliente. */
  bookedByAi?: boolean
}

export type AgendaViewResponse = {
  tenantId: string
  timezone: string
  view: 'day' | 'week'
  date: string
  rangeStartsAt: number
  rangeEndsAt: number
  asOf: number
  appointments: AgendaAppointmentItem[]
  /** Reservas por bloco activas (faixa «hora a definir»). */
  holds?: ScheduleHold[]
}

export type ScheduleHoldStatus = 'active' | 'resolved' | 'expired' | 'cancelled'

export type ScheduleHold = {
  id: string
  status: ScheduleHoldStatus
  opportunityId: string | null
  conversationId: string
  contactId: string
  contactName: string | null
  serviceId: string
  serviceName: string
  professionalId: string
  professionalName: string
  durationMinutes: number
  windowStartsAt: number
  windowEndsAt: number
  confirmBy: number | null
  appointmentId: string | null
  responsibleClerkUserId: string | null
  responsibleDisplayName: string | null
  createdAt: number
  updatedAt: number
  resolvedAt: number | null
  expiredAt: number | null
  cancelledAt: number | null
  alertDismissedAt: number | null
}


export type AppointmentReasonOption = { code: string; label: string }

export type AppointmentDetailResponse = {
  id: string
  tenantId: string
  serviceId: string
  serviceName: string
  professionalId: string
  professionalName: string
  roomResourceId: string | null
  roomResourceName: string | null
  startsAt: number
  endsAt: number
  occupiesUntil: number | null
  defaultDurationMinutes?: number | null
  appliedDurationMinutes?: number | null
  status: 'confirmed' | 'cancelled'
  contactLabel: string | null
  contactId: string | null
  conversationId: string | null
  opportunityId: string | null
  version: number
  updatedAt: number | null
  confirmedBy: string | null
  confirmedAt: number | null
  changeReason: string | null
  cancelledBy: string | null
  cancelledAt: number | null
  createdAt: number
  events: Array<{
    id: string
    operation: 'confirmed' | 'cancelled' | 'rescheduled'
    actorId: string | null
    reason: string | null
    previousJson: string | null
    newJson: string | null
    occurredAt: number
  }>
}

export type WhatsappSignupPurpose = 'connect' | 'reconnect' | 'replace'

export type WhatsappConnection = {
  status: 'disconnected' | 'connected' | 'interrupted'
  phoneNumberId: string | null
  wabaId: string | null
  displayPhone: string | null
  displayName: string | null
  connectedAt: number | null
  connectedByClerkUserId: string | null
  interruptedAt: number | null
  interruptReason: string | null
  lastInboundAt: number | null
  messageTemplates: Array<{ name: string; status: string }>
  history: Array<{
    id: string
    action: string
    actorClerkUserId: string | null
    phoneNumberId: string | null
    occurredAt: number
    detail: Record<string, unknown> | null
  }>
  metaMode: 'synthetic' | 'live'
}

export type WhatsappSignupSession = {
  sessionId: string
  state: string
  purpose: WhatsappSignupPurpose
  expiresAt: number
  metaMode: 'synthetic' | 'live'
  metaAppId: string | null
  metaConfigId: string | null
  graphApiVersion: string
}

export type WhatsappCompleteBody = {
  state: string
  code: string
  phoneNumberId: string
  wabaId: string
  displayPhone?: string | null
  displayName?: string | null
}

export type PanelApi = ReturnType<typeof createPanelApi>
